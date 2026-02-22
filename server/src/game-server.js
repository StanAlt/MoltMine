/**
 * BotCraft Authoritative Game Server
 *
 * Manages the world state, processes player actions, enforces permissions,
 * and broadcasts state changes over WebSocket. Implements the World API v0.
 */

import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { WorldGen } from './world-gen.js';
import { Persistence } from './persistence.js';
import { MobManager } from './mob-manager.js';
import {
  C2S, S2C, ACTION, CHANNEL, ERROR,
  CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL, WORLD_SEED,
  TICK_RATE, RENDER_DISTANCE, envelope, parse,
} from '../../shared/protocol.js';
import {
  AIR, BLOCKS, isSolid, isMineable, isPlaceable, DEFAULT_HOTBAR,
} from '../../shared/blocks.js';
import { BIOME_DATA, selectBiome } from '../../shared/biomes.js';
import { PerlinNoise } from '../../shared/noise.js';

// ── Chunk key helper ──────────────────────────────────────────
function chunkKey(cx, cz) { return `${cx},${cz}`; }

// ── Day/night constants ───────────────────────────────────────
const DAY_LENGTH_TICKS = TICK_RATE * 60 * 20; // 20 real minutes
const DAWN  = 0;
const NOON  = DAY_LENGTH_TICKS * 0.25;
const DUSK  = DAY_LENGTH_TICKS * 0.5;
const NIGHT = DAY_LENGTH_TICKS * 0.75;

// ── Personality traits pool ───────────────────────────────────
const TRAITS = [
  'adventurous', 'creative', 'curious', 'friendly', 'brave',
  'resourceful', 'witty', 'thoughtful', 'energetic', 'calm',
  'builder', 'explorer', 'socialite', 'strategist', 'artist',
];
const MOTTOS = [
  'Building the future, one block at a time.',
  'Every block tells a story.',
  'This world is what we make it.',
  'Exploring the unknown together.',
  'Create. Connect. Build.',
  'In this world, we are free.',
  'The adventure awaits!',
];
const BODY_TYPES = ['standard', 'tall', 'compact', 'wide'];

export class GameServer {
  constructor(httpServer, opts = {}) {
    this.wss = new WebSocketServer({ server: httpServer });
    this.worldGen = new WorldGen(opts.seed ?? WORLD_SEED);
    this.persistence = new Persistence();

    /** @type {Map<string, Uint8Array>} chunkKey -> block data */
    this.chunks = new Map();

    /** @type {Map<WebSocket, PlayerSession>} */
    this.sessions = new Map();

    /** @type {Map<string, PlayerSession>} accountId -> session */
    this.accounts = new Map();

    /** Audit log (in-memory, last 10k entries) */
    this.auditLog = [];

    this._tick = 0;
    this._worldTime = 0; // day/night cycle
    this._tickInterval = null;
    this._saveInterval = null;

    // Mob system
    this.mobs = new MobManager(this);

    this.wss.on('connection', (ws) => this._onConnect(ws));
  }

  start() {
    // Load persisted world
    this.persistence.loadProfiles();
    const savedChunks = this.persistence.loadAllChunks();
    for (const [key, data] of savedChunks) {
      this.chunks.set(key, data);
    }

    // Game loop
    this._tickInterval = setInterval(() => this._gameTick(), 1000 / TICK_RATE);

    // Auto-save every 60 seconds
    this._saveInterval = setInterval(() => this._save(), 60_000);

    console.log(`[BotCraft] Game loop started at ${TICK_RATE} tps`);
  }

  stop() {
    clearInterval(this._tickInterval);
    clearInterval(this._saveInterval);
    this._save();
    console.log('[BotCraft] World saved on shutdown');
  }

  /** Save dirty chunks and profiles to disk. */
  _save() {
    const chunksSaved = this.persistence.flushChunks(this.chunks);
    this.persistence.saveProfiles();
    if (chunksSaved > 0) {
      console.log(`[BotCraft] Saved ${chunksSaved} chunks, ${this.persistence.profiles.size} profiles`);
    }
  }

  // ── REST API handler (called from index.js) ───────────────
  handleHttpRequest(req, res) {
    // GET /api/status — world info for bots and dashboards
    if (req.method === 'GET' && req.url === '/api/status') {
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify({
        name: 'BotCraft',
        version: '0.2.0',
        players: this.sessions.size,
        worldTime: this._worldTime,
        dayLength: DAY_LENGTH_TICKS,
        tick: this._tick,
        uptime: process.uptime(),
      }));
    }

    // POST /api/agent/join — frictionless bot onboarding
    if (req.method === 'POST' && req.url === '/api/agent/join') {
      let body = '';
      req.on('data', (chunk) => { body += chunk; });
      req.on('end', () => {
        try {
          const { name, traits, primaryColor, motto } = JSON.parse(body);
          if (!name) {
            res.writeHead(400, { 'content-type': 'application/json' });
            return res.end(JSON.stringify({ error: 'name is required' }));
          }
          // Return connection instructions
          const wsUrl = `ws://${req.headers.host || 'localhost:3000'}`;
          res.writeHead(200, {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
          });
          res.end(JSON.stringify({
            wsUrl,
            instructions: {
              step1: `Connect via WebSocket to ${wsUrl}`,
              step2: 'Send Auth/Hello: { v:0, type:"Auth/Hello", id:"1", ts:0, payload:{ name, agent:true } }',
              step3: 'Send World/Join: { v:0, type:"World/Join", id:"2", ts:0, payload:{ spaceId:"moltworld" } }',
              step4: 'You are in! Send World/Action and World/Chat messages.',
            },
            example: {
              auth: { v: 0, type: 'Auth/Hello', id: '1', ts: 0, payload: { name, agent: true, personality: { traits, primaryColor, motto } } },
              join: { v: 0, type: 'World/Join', id: '2', ts: 0, payload: { spaceId: 'moltworld' } },
              chat: { v: 0, type: 'World/Chat', id: '3', ts: 0, payload: { text: 'Hello world!', channel: 'global' } },
            },
          }));
        } catch {
          res.writeHead(400, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON body' }));
        }
      });
      return;
    }

    // CORS preflight
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
      });
      return res.end();
    }

    return false; // not handled
  }

  // ── Connection handling ───────────────────────────────────
  _onConnect(ws) {
    ws.on('message', (raw) => {
      const msg = parse(raw.toString());
      if (!msg) return;
      this._handleMessage(ws, msg);
    });
    ws.on('close', () => this._onDisconnect(ws));
    ws.on('error', () => this._onDisconnect(ws));
  }

  _onDisconnect(ws) {
    const session = this.sessions.get(ws);
    if (!session) return;

    // Persist profile stats
    this.persistence.setProfile(session.name, session.profile);

    this.sessions.delete(ws);
    this.accounts.delete(session.accountId);
    this._broadcast(S2C.PLAYER_LEAVE, { accountId: session.accountId, name: session.name }, ws);
    this._audit('disconnect', session.accountId, {});
    console.log(`[BotCraft] ${session.name}${session.isAgent ? ' [bot]' : ''} left (${this.sessions.size} online)`);
  }

  _handleMessage(ws, msg) {
    switch (msg.type) {
      case C2S.AUTH_HELLO:   return this._onAuthHello(ws, msg.payload);
      case C2S.WORLD_JOIN:   return this._onWorldJoin(ws, msg.payload);
      case C2S.WORLD_ACTION: return this._onWorldAction(ws, msg);
      case C2S.WORLD_CHAT:   return this._onWorldChat(ws, msg.payload);
    }
  }

  // ── Auth ──────────────────────────────────────────────────
  _onAuthHello(ws, payload) {
    const { name, personality, agent, token } = payload ?? {};
    if (!name || typeof name !== 'string') {
      return this._send(ws, S2C.AUTH_ERROR, { code: ERROR.INVALID_ARGUMENT, message: 'name required' });
    }

    const isAgent = !!agent;
    const accountId = randomUUID();

    // Check for returning player with saved profile
    const savedProfile = this.persistence.getProfile(name);
    const profile = savedProfile
      ? { ...savedProfile, accountId }
      : this._generateProfile(accountId, name, personality);

    const session = {
      accountId,
      name,
      profile,
      isAgent,
      pos: { x: 0, y: 40, z: 0 },
      rot: { x: 0, y: 0, z: 0, w: 1 },
      hotbar: [...DEFAULT_HOTBAR],
      selectedSlot: 0,
      hp: 20,
      maxHp: 20,
      dead: false,
      _hurtCooldown: 0, // ticks until can be hurt again
      ws,
      _sentChunks: new Set(),
      _lastCX: null,
      _lastCZ: null,
    };

    this.sessions.set(ws, session);
    this.accounts.set(accountId, session);

    this._send(ws, S2C.AUTH_OK, {
      accountId,
      profile,
      hotbar: session.hotbar,
      worldTime: this._worldTime,
      dayLength: DAY_LENGTH_TICKS,
    });

    this._audit('auth', accountId, { name, agent: isAgent });
    console.log(`[BotCraft] ${name}${isAgent ? ' [bot]' : ''} authenticated (${this.sessions.size} online)`);
  }

  // ── Join world ────────────────────────────────────────────
  _onWorldJoin(ws, payload) {
    const session = this.sessions.get(ws);
    if (!session) return this._send(ws, S2C.AUTH_ERROR, { code: ERROR.UNAUTHENTICATED });

    // Find spawn point on solid ground
    const spawn = this._findSpawn();
    session.pos = spawn;

    // Send existing players to the new player
    for (const [, other] of this.sessions) {
      if (other.accountId !== session.accountId) {
        this._send(ws, S2C.PLAYER_JOIN, {
          accountId: other.accountId,
          name: other.name,
          profile: other.profile,
          pos: other.pos,
          isAgent: other.isAgent,
        });
      }
    }

    // Send chunks around spawn and track them for streaming
    const pcx = Math.floor(spawn.x / CHUNK_SIZE);
    const pcz = Math.floor(spawn.z / CHUNK_SIZE);
    session._lastCX = pcx;
    session._lastCZ = pcz;
    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
      for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        session._sentChunks.add(chunkKey(cx, cz));
        this._sendChunk(ws, cx, cz);
      }
    }

    // Send spawn position + world time
    this._send(ws, S2C.WORLD_SNAPSHOT, {
      spaceId: 'moltworld',
      tick: this._tick,
      spawn: session.pos,
      worldTime: this._worldTime,
      dayLength: DAY_LENGTH_TICKS,
    });

    // Announce new player to everyone else
    this._broadcast(S2C.PLAYER_JOIN, {
      accountId: session.accountId,
      name: session.name,
      profile: session.profile,
      pos: session.pos,
      isAgent: session.isAgent,
    }, ws);

    // Send existing mobs to the new player
    for (const mob of this.mobs.mobs.values()) {
      this._send(ws, S2C.MOB_SPAWN, {
        id: mob.id,
        type: mob.type,
        pos: mob.pos,
        hp: mob.hp,
        maxHp: mob.maxHp,
      });
    }

    this._audit('join', session.accountId, { spawn });
    console.log(`[BotCraft] ${session.name} joined at (${spawn.x.toFixed(0)}, ${spawn.y.toFixed(0)}, ${spawn.z.toFixed(0)})`);
  }

  // ── Actions ───────────────────────────────────────────────
  _onWorldAction(ws, msg) {
    const session = this.sessions.get(ws);
    if (!session) return;

    const { actionId, kind, args } = msg.payload ?? {};

    switch (kind) {
      case ACTION.MOVE_TO:    return this._actionMove(ws, session, actionId, args);
      case ACTION.MINE:       return this._actionMine(ws, session, actionId, args);
      case ACTION.PLACE:      return this._actionPlace(ws, session, actionId, args);
      case ACTION.EMOTE:      return this._actionEmote(ws, session, actionId, args);
      case ACTION.SPEAK:      return this._onWorldChat(ws, args);
      case ACTION.ATTACK_MOB: return this._actionAttackMob(ws, session, actionId, args);
      case 'Perceive':        return this._actionPerceive(ws, session, actionId, args);
      default:
        this._send(ws, S2C.WORLD_ACTION_RESULT, {
          actionId, ok: false,
          error: { code: ERROR.INVALID_ARGUMENT, message: `Unknown action: ${kind}` },
        });
    }
  }

  _actionMove(ws, session, actionId, args) {
    if (!args?.pos) return;
    const { x, y, z } = args.pos;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return;

    session.pos = { x, y, z };
    if (args.rot) session.rot = args.rot;

    // Streaming chunk loading — send new chunks as player moves
    const newCX = Math.floor(x / CHUNK_SIZE);
    const newCZ = Math.floor(z / CHUNK_SIZE);
    if (session._lastCX !== newCX || session._lastCZ !== newCZ) {
      session._lastCX = newCX;
      session._lastCZ = newCZ;
      for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
        for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
          const cx = newCX + dx;
          const cz = newCZ + dz;
          const key = chunkKey(cx, cz);
          if (!session._sentChunks.has(key)) {
            session._sentChunks.add(key);
            this._sendChunk(ws, cx, cz);
          }
        }
      }
    }

    // Broadcast to others
    this._broadcast(S2C.PLAYER_MOVE, {
      accountId: session.accountId,
      pos: session.pos,
      rot: session.rot,
    }, ws);
  }

  _actionMine(ws, session, actionId, args) {
    if (!args?.pos) return;
    const { x, y, z } = args.pos;
    const block = this._getBlock(x, y, z);

    if (block === AIR || !isMineable(block)) {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.INVALID_ARGUMENT, message: 'Cannot mine that block' },
      });
    }

    this._setBlock(x, y, z, AIR);
    const drop = BLOCKS.get(block)?.drop ?? block;

    // Track stats
    session.profile.stats.blocksMined = (session.profile.stats.blocksMined || 0) + 1;

    this._broadcastAll(S2C.BLOCK_UPDATE, { pos: { x, y, z }, block: AIR });
    this._send(ws, S2C.WORLD_ACTION_RESULT, {
      actionId, ok: true,
      effects: { mined: block, drop },
    });
    this._audit('mine', session.accountId, { pos: { x, y, z }, block });
  }

  _actionPlace(ws, session, actionId, args) {
    if (!args?.pos || args?.blockId == null) return;
    const { x, y, z } = args.pos;
    const blockId = args.blockId;

    if (!isPlaceable(blockId)) {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.INVALID_ARGUMENT, message: 'Block not placeable' },
      });
    }

    const existing = this._getBlock(x, y, z);
    if (isSolid(existing)) {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.CONFLICT, message: 'Space occupied' },
      });
    }

    this._setBlock(x, y, z, blockId);

    // Track stats
    session.profile.stats.blocksPlaced = (session.profile.stats.blocksPlaced || 0) + 1;

    this._broadcastAll(S2C.BLOCK_UPDATE, { pos: { x, y, z }, block: blockId });
    this._send(ws, S2C.WORLD_ACTION_RESULT, { actionId, ok: true });
    this._audit('place', session.accountId, { pos: { x, y, z }, block: blockId });
  }

  _actionEmote(ws, session, actionId, args) {
    if (!args?.name) return;
    this._broadcast(S2C.WORLD_EVENT, {
      kind: 'emote',
      accountId: session.accountId,
      name: session.name,
      emote: args.name,
    });
    this._send(ws, S2C.WORLD_ACTION_RESULT, { actionId, ok: true });
  }

  _actionAttackMob(ws, session, actionId, args) {
    if (!args?.mobId) {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.INVALID_ARGUMENT, message: 'mobId required' },
      });
    }
    if (session.dead) {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.INVALID_ARGUMENT, message: 'You are dead' },
      });
    }

    const mob = this.mobs.mobs.get(args.mobId);
    if (!mob) {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.NOT_FOUND, message: 'Mob not found' },
      });
    }

    // Check distance (max 6 blocks)
    const dx = mob.pos.x - session.pos.x;
    const dz = mob.pos.z - session.pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist > 8) {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.INVALID_ARGUMENT, message: 'Too far away' },
      });
    }

    const damage = 3; // player attack damage
    const killed = mob.hp - damage <= 0;
    this.mobs.damageMob(args.mobId, damage, session);

    // Track stat
    if (killed) {
      session.profile.stats.mobsKilled = (session.profile.stats.mobsKilled || 0) + 1;
    }

    this._send(ws, S2C.WORLD_ACTION_RESULT, {
      actionId, ok: true,
      effects: { damage, killed, mobType: mob.type },
    });
  }

  /** Damage a player from a mob attack. */
  damagePlayer(session, damage, sourceType) {
    if (session.dead || session._hurtCooldown > 0) return;
    session._hurtCooldown = 10; // 0.5s cooldown at 20tps
    session.hp = Math.max(0, session.hp - damage);

    this._broadcastAll(S2C.PLAYER_HURT, {
      accountId: session.accountId,
      hp: session.hp,
      maxHp: session.maxHp,
      source: sourceType,
    });

    if (session.hp <= 0) {
      session.dead = true;
      this._broadcastAll(S2C.PLAYER_DEATH, {
        accountId: session.accountId,
        name: session.name,
        source: sourceType,
      });

      // Respawn after 3 seconds
      setTimeout(() => {
        if (!this.sessions.has(session.ws)) return; // already disconnected
        session.dead = false;
        session.hp = session.maxHp;
        const spawn = this._findSpawn();
        session.pos = spawn;

        this._send(session.ws, S2C.PLAYER_RESPAWN, {
          accountId: session.accountId,
          pos: spawn,
          hp: session.hp,
          maxHp: session.maxHp,
        });

        this._broadcast(S2C.PLAYER_MOVE, {
          accountId: session.accountId,
          pos: spawn,
          rot: session.rot,
        }, session.ws);
      }, 3000);
    }
  }

  /** Perceive — returns world state around the agent (for SDK). */
  _actionPerceive(ws, session, actionId, args) {
    const { x, y, z } = session.pos;
    const radius = Math.min(args?.radius ?? 8, 16);
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);

    // Gather nearby blocks
    const nearbyBlocks = [];
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const block = this._getBlock(bx + dx, by + dy, bz + dz);
          if (block !== AIR) {
            nearbyBlocks.push({ x: bx + dx, y: by + dy, z: bz + dz, block });
          }
        }
      }
    }

    // Gather nearby players
    const nearbyPlayers = [];
    for (const [, other] of this.sessions) {
      if (other.accountId === session.accountId) continue;
      const dist = Math.sqrt(
        (other.pos.x - x) ** 2 + (other.pos.y - y) ** 2 + (other.pos.z - z) ** 2,
      );
      if (dist <= 64) {
        nearbyPlayers.push({
          name: other.name,
          pos: other.pos,
          distance: Math.round(dist),
          isAgent: other.isAgent,
        });
      }
    }

    // Get biome
    const biomeT = new PerlinNoise(WORLD_SEED + 1000);
    const biomeM = new PerlinNoise(WORLD_SEED + 2000);
    const temp = biomeT.fbm(bx / 256, bz / 256, 3);
    const moist = biomeM.fbm(bx / 256, bz / 256, 3);
    const biomeId = selectBiome(temp, moist);
    const biome = BIOME_DATA[biomeId];

    // Gather nearby mobs
    const nearbyMobs = [];
    for (const [, mob] of this.mobs.mobs) {
      const mdx = mob.pos.x - x;
      const mdz = mob.pos.z - z;
      const mobDist = Math.sqrt(mdx * mdx + mdz * mdz);
      if (mobDist <= 32) {
        nearbyMobs.push({
          id: mob.id,
          type: mob.type,
          pos: mob.pos,
          hp: mob.hp,
          maxHp: mob.maxHp,
          distance: Math.round(mobDist),
        });
      }
    }

    this._send(ws, S2C.WORLD_ACTION_RESULT, {
      actionId, ok: true,
      effects: {
        position: session.pos,
        hp: session.hp,
        maxHp: session.maxHp,
        biome: biome?.name ?? 'Unknown',
        worldTime: this._worldTime,
        dayPhase: this._getDayPhase(),
        nearbyBlocks: nearbyBlocks.slice(0, 500), // cap for bandwidth
        nearbyPlayers,
        nearbyMobs,
        blockCount: nearbyBlocks.length,
      },
    });
  }

  _getDayPhase() {
    const t = this._worldTime;
    if (t < DAY_LENGTH_TICKS * 0.2) return 'dawn';
    if (t < DAY_LENGTH_TICKS * 0.45) return 'day';
    if (t < DAY_LENGTH_TICKS * 0.55) return 'dusk';
    if (t < DAY_LENGTH_TICKS * 0.8) return 'night';
    return 'dawn';
  }

  // ── Chat ──────────────────────────────────────────────────
  _onWorldChat(ws, payload) {
    const session = this.sessions.get(ws);
    if (!session) return;

    const { text, channel } = payload ?? {};
    if (!text || typeof text !== 'string') return;
    const cleanText = text.slice(0, 500);

    session.profile.stats.chatMessages = (session.profile.stats.chatMessages || 0) + 1;

    const chatMsg = {
      accountId: session.accountId,
      name: session.name,
      text: cleanText,
      channel: channel || CHANNEL.GLOBAL,
      isAgent: session.isAgent,
      ts: Date.now(),
    };

    this._broadcastAll(S2C.CHAT_MESSAGE, chatMsg);
    this._audit('chat', session.accountId, { text: cleanText, channel });
  }

  // ── Chunk management ──────────────────────────────────────
  _ensureChunk(cx, cz) {
    const key = chunkKey(cx, cz);
    if (!this.chunks.has(key)) {
      const data = this.worldGen.generateChunk(cx, cz);
      this.chunks.set(key, data);
    }
    return this.chunks.get(key);
  }

  _sendChunk(ws, cx, cz) {
    const data = this._ensureChunk(cx, cz);
    const b64 = Buffer.from(data).toString('base64');
    this._send(ws, S2C.WORLD_CHUNK, { cx, cz, data: b64 });
  }

  _getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return AIR;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const chunk = this._ensureChunk(cx, cz);
    return chunk[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx];
  }

  _setBlock(x, y, z, blockId) {
    if (y < 0 || y >= CHUNK_HEIGHT) return;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const chunk = this._ensureChunk(cx, cz);
    chunk[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx] = blockId;

    // Mark chunk dirty for persistence
    this.persistence.markDirty(chunkKey(cx, cz));
  }

  // ── Spawn finding ─────────────────────────────────────────
  _findSpawn() {
    // Search in a randomized area to avoid all players spawning on top of each other
    const offsetX = Math.floor(Math.random() * 32) - 16;
    const offsetZ = Math.floor(Math.random() * 32) - 16;

    // Try random positions first, then fall back to systematic search
    for (let attempt = 0; attempt < 50; attempt++) {
      const x = offsetX + Math.floor(Math.random() * 16);
      const z = offsetZ + Math.floor(Math.random() * 16);
      for (let y = CHUNK_HEIGHT - 3; y > SEA_LEVEL; y--) {
        if (isSolid(this._getBlock(x, y, z)) &&
            !isSolid(this._getBlock(x, y + 1, z)) &&
            !isSolid(this._getBlock(x, y + 2, z))) {
          return { x: x + 0.5, y: y + 1 + 1.7, z: z + 0.5 };
        }
      }
    }

    // Systematic fallback in chunk 0,0
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        for (let y = CHUNK_HEIGHT - 3; y > SEA_LEVEL; y--) {
          if (isSolid(this._getBlock(x, y, z)) &&
              !isSolid(this._getBlock(x, y + 1, z)) &&
              !isSolid(this._getBlock(x, y + 2, z))) {
            return { x: x + 0.5, y: y + 1 + 1.7, z: z + 0.5 };
          }
        }
      }
    }
    return { x: 8, y: 45, z: 8 };
  }

  // ── Molty profile ─────────────────────────────────────────
  _generateProfile(accountId, name, overrides = {}) {
    let hash = 0;
    for (let i = 0; i < name.length; i++) {
      hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    }
    const abs = Math.abs(hash);

    const traitCount = 2 + (abs % 3);
    const traits = [];
    for (let i = 0; i < traitCount; i++) {
      traits.push(TRAITS[(abs + i * 7) % TRAITS.length]);
    }

    const profile = {
      accountId,
      displayName: name,
      personality: {
        traits: overrides.traits ?? traits,
        motto: overrides.motto ?? MOTTOS[abs % MOTTOS.length],
      },
      appearance: {
        primaryColor: overrides.primaryColor ??
          '#' + ((abs * 123456) & 0xFFFFFF).toString(16).padStart(6, '0'),
        secondaryColor: overrides.secondaryColor ??
          '#' + ((abs * 654321) & 0xFFFFFF).toString(16).padStart(6, '0'),
        bodyType: overrides.bodyType ?? BODY_TYPES[abs % BODY_TYPES.length],
      },
      stats: {
        blocksMined: 0,
        blocksPlaced: 0,
        chatMessages: 0,
      },
    };

    // Persist new profile
    this.persistence.setProfile(name, profile);
    return profile;
  }

  // ── Game tick ─────────────────────────────────────────────
  _gameTick() {
    this._tick++;

    // Day/night cycle
    this._worldTime = (this._worldTime + 1) % DAY_LENGTH_TICKS;

    // Decrement player hurt cooldowns
    for (const [, session] of this.sessions) {
      if (session._hurtCooldown > 0) session._hurtCooldown--;
    }

    // Update mobs every 4 ticks (5 times/sec)
    if (this._tick % 4 === 0) {
      this.mobs.update(this._tick, this._getDayPhase());
    }

    // Broadcast time every 2 seconds (40 ticks)
    if (this._tick % 40 === 0) {
      this._broadcastAll(S2C.WORLD_EVENT, {
        kind: 'time',
        worldTime: this._worldTime,
        dayLength: DAY_LENGTH_TICKS,
        phase: this._getDayPhase(),
      });
    }
  }

  // ── Networking helpers ────────────────────────────────────
  _send(ws, type, payload) {
    if (ws.readyState === ws.OPEN) {
      ws.send(envelope(type, payload));
    }
  }

  _broadcast(type, payload, exclude) {
    const msg = envelope(type, payload);
    for (const [ws] of this.sessions) {
      if (ws !== exclude && ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    }
  }

  _broadcastAll(type, payload) {
    const msg = envelope(type, payload);
    for (const [ws] of this.sessions) {
      if (ws.readyState === ws.OPEN) {
        ws.send(msg);
      }
    }
  }

  _audit(action, accountId, data) {
    this.auditLog.push({ ts: Date.now(), action, accountId, data });
    if (this.auditLog.length > 10000) this.auditLog.shift();
  }
}
