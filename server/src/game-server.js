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
import { ItemManager } from './item-manager.js';
import {
  C2S, S2C, ACTION, CHANNEL, ERROR,
  PROTOCOL_VERSION, SERVER_BUILD,
  CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL, WORLD_SEED,
  TICK_RATE, RENDER_DISTANCE, envelope, parse,
} from '../../shared/protocol.js';
import {
  AIR, BLOCKS, isSolid, isMineable, isPlaceable, DEFAULT_HOTBAR,
} from '../../shared/blocks.js';
import { ITEMS, getItem, RARITY_NAMES, CATEGORY, SLOT } from '../../shared/items.js';
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

    // Item system
    this.items = new ItemManager(this);

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
      const playerList = [];
      for (const [, s] of this.sessions) {
        playerList.push({ name: s.name, isAgent: s.isAgent });
      }
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify({
        name: 'BotCraft',
        version: SERVER_BUILD,
        protocolVersion: PROTOCOL_VERSION,
        players: this.sessions.size,
        playerList,
        mobs: this.mobs.mobs.size,
        worldTime: this._worldTime,
        dayLength: DAY_LENGTH_TICKS,
        dayPhase: this._getDayPhase(),
        tick: this._tick,
        uptime: process.uptime(),
        wsUrl: 'wss://botcraft.app/ws',
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
          // Determine the correct WebSocket URL from the incoming request
          const host = req.headers.host || 'localhost:3000';
          const isSecure = req.headers['x-forwarded-proto'] === 'https' || host.includes('botcraft.app');
          const wsUrl = `${isSecure ? 'wss' : 'ws'}://${host}/ws`;

          res.writeHead(200, {
            'content-type': 'application/json',
            'access-control-allow-origin': '*',
          });
          res.end(JSON.stringify({
            wsUrl,
            protocolVersion: PROTOCOL_VERSION,
            serverBuild: SERVER_BUILD,
            instructions: {
              step1: `Connect via WebSocket to ${wsUrl}`,
              step2: 'Send Auth/Hello: { v:0, type:"Auth/Hello", id:"1", ts:0, payload:{ name:"YourBot", agent:true } }',
              step3: 'Send World/Join: { v:0, type:"World/Join", id:"2", ts:0, payload:{ spaceId:"moltworld" } }',
              step4: 'You will receive Auth/Ok (with capabilities) then World/Snapshot.',
              step5: 'Send World/Action messages. Every action returns World/ActionResult.',
              step6: 'Use World/Subscribe to choose which streams you receive.',
            },
            example: {
              auth: { v: 0, type: 'Auth/Hello', id: '1', ts: 0, payload: { name, agent: true, personality: { traits, primaryColor, motto } } },
              join: { v: 0, type: 'World/Join', id: '2', ts: 0, payload: { spaceId: 'moltworld' } },
              move: { v: 0, type: 'World/Action', id: '3', ts: 0, payload: { actionId: '3', kind: 'MoveTo', args: { pos: { x: 10, y: 30, z: 10 } } } },
              mine: { v: 0, type: 'World/Action', id: '4', ts: 0, payload: { actionId: '4', kind: 'Mine', args: { pos: { x: 5, y: 25, z: 5 } } } },
              chat: { v: 0, type: 'World/Chat', id: '5', ts: 0, payload: { text: 'Hello world!', channel: 'global' } },
              perceive: { v: 0, type: 'World/Action', id: '6', ts: 0, payload: { actionId: '6', kind: 'Perceive', args: { radius: 8 } } },
              subscribe: { v: 0, type: 'World/Subscribe', id: '7', ts: 0, payload: { streams: { chunks: false, mobs: true, items: true, chat: true, blocks: true, players: true } } },
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
      case C2S.AUTH_HELLO:      return this._onAuthHello(ws, msg.payload);
      case C2S.WORLD_JOIN:      return this._onWorldJoin(ws, msg.payload);
      case C2S.WORLD_ACTION:    return this._onWorldAction(ws, msg);
      case C2S.WORLD_CHAT:      return this._onWorldChat(ws, msg.payload);
      case C2S.WORLD_SUBSCRIBE: return this._onWorldSubscribe(ws, msg.payload);
      case C2S.PERCEPT_QUERY:   return this._onPerceptQuery(ws, msg);
      case C2S.WORLD_RAYCAST:   return this._onWorldRaycast(ws, msg);
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
      // Subscription streams — agents can toggle these
      _streams: {
        chunks: !isAgent,  // off by default for bots
        mobs: true,
        items: true,
        chat: true,
        blocks: true,
        players: true,
      },
    };

    this.sessions.set(ws, session);
    this.accounts.set(accountId, session);

    // Build hotbar resolved (name + info for each slot)
    const hotbarResolved = session.hotbar.map(id => {
      const b = BLOCKS.get(id);
      return b ? { id: b.id, name: b.name, color: b.color, placeable: !!(b.flags & 0x20) } : null;
    });

    // Build item registry summary for bots
    const itemRegistry = [...ITEMS.values()].map(it => ({
      id: it.id, name: it.name, category: it.category,
      rarity: it.rarity, slot: it.slot, color: it.color,
    }));

    // Capabilities handshake
    const capabilities = {
      protocolVersion: PROTOCOL_VERSION,
      serverBuild: SERVER_BUILD,
      actions: [
        { kind: 'MoveTo',      args: { pos: '{x,y,z}', rot: '{x,y,z,w}?' },        desc: 'Move to position' },
        { kind: 'Mine',        args: { pos: '{x,y,z}' },                            desc: 'Mine block at position' },
        { kind: 'Place',       args: { pos: '{x,y,z}', blockId: 'number' },         desc: 'Place block' },
        { kind: 'Emote',       args: { name: 'string' },                            desc: 'Play emote (wave, dance, think)' },
        { kind: 'AttackMob',   args: { mobId: 'string' },                           desc: 'Attack a mob' },
        { kind: 'PickUpItem',  args: { worldItemId: 'string' },                     desc: 'Pick up world item' },
        { kind: 'DropItem',    args: { inventoryIndex: 'number' },                  desc: 'Drop inventory item' },
        { kind: 'EquipItem',   args: { inventoryIndex: 'number' },                  desc: 'Equip inventory item' },
        { kind: 'UnequipItem', args: { slot: 'head|body|legs|feet|mainHand|offHand' }, desc: 'Unequip slot' },
        { kind: 'TradeOffer',  args: { toName: 'string', inventoryIndex: 'number' }, desc: 'Trade item to player' },
        { kind: 'Perceive',    args: { radius: 'number? (max 16, default 8)' },     desc: 'Perceive surroundings' },
      ],
      channels: Object.values(CHANNEL),
      rateLimit: { actionsPerSecond: 20, chatPerSecond: 2 },
      subscriptionStreams: ['chunks', 'mobs', 'items', 'chat', 'blocks', 'players'],
      messageTypes: {
        perceptQuery: 'Percept/Query — lightweight semantic perception without raw chunks',
        worldRaycast: 'World/Raycast — find block the agent is facing',
        worldSubscribe: 'World/Subscribe — toggle which streams are sent',
      },
    };

    this._send(ws, S2C.AUTH_OK, {
      accountId,
      profile,
      hotbar: session.hotbar,
      hotbarResolved,
      worldTime: this._worldTime,
      dayLength: DAY_LENGTH_TICKS,
      capabilities,
      itemRegistry: isAgent ? itemRegistry : undefined, // only send to bots to save bandwidth
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

    // Initialize inventory and send items
    this.items.initPlayer(session.accountId);
    this.items.sendInitialState(ws, session);

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
      case ACTION.ATTACK_MOB:   return this._actionAttackMob(ws, session, actionId, args);
      case ACTION.PICK_UP_ITEM: return this._actionPickUpItem(ws, session, actionId, args);
      case ACTION.DROP_ITEM:    return this._actionDropItem(ws, session, actionId, args);
      case ACTION.EQUIP_ITEM:   return this._actionEquipItem(ws, session, actionId, args);
      case ACTION.UNEQUIP_ITEM: return this._actionUnequipItem(ws, session, actionId, args);
      case ACTION.TRADE_OFFER:  return this._actionTradeOffer(ws, session, actionId, args);
      case ACTION.PERCEIVE:     return this._actionPerceive(ws, session, actionId, args);
      default:
        this._send(ws, S2C.WORLD_ACTION_RESULT, {
          actionId, ok: false,
          error: { code: ERROR.INVALID_ARGUMENT, message: `Unknown action: ${kind}` },
        });
    }
  }

  _actionMove(ws, session, actionId, args) {
    if (!args?.pos) {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.INVALID_ARGUMENT, message: 'pos {x,y,z} required' },
      });
    }
    const { x, y, z } = args.pos;
    if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.INVALID_ARGUMENT, message: 'pos must have numeric x, y, z' },
      });
    }

    session.pos = { x, y, z };
    if (args.rot) session.rot = args.rot;

    // Streaming chunk loading — send new chunks as player moves
    const newCX = Math.floor(x / CHUNK_SIZE);
    const newCZ = Math.floor(z / CHUNK_SIZE);
    if (session._lastCX !== newCX || session._lastCZ !== newCZ) {
      session._lastCX = newCX;
      session._lastCZ = newCZ;
      if (session._streams.chunks) {
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
    }

    // Broadcast to others (respecting their subscription)
    this._broadcastFiltered(S2C.PLAYER_MOVE, {
      accountId: session.accountId,
      pos: session.pos,
      rot: session.rot,
    }, ws, 'players');

    // Send ActionResult + Player/State back to the mover
    if (actionId) {
      this._send(ws, S2C.WORLD_ACTION_RESULT, { actionId, ok: true });
    }
    // Always send Player/State for bots (they need pos confirmation)
    if (session.isAgent) {
      this._send(ws, S2C.PLAYER_STATE, {
        accountId: session.accountId,
        pos: session.pos,
        rot: session.rot,
        hp: session.hp,
        maxHp: session.maxHp,
        selectedSlot: session.selectedSlot,
      });
    }
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

    // BlockUpdate includes oldId→newId and who did it, for bot feedback
    this._broadcastAllFiltered(S2C.BLOCK_UPDATE, {
      pos: { x, y, z },
      block: AIR,
      oldBlock: block,
      byAccountId: session.accountId,
    }, 'blocks');
    this._send(ws, S2C.WORLD_ACTION_RESULT, {
      actionId, ok: true,
      effects: { mined: block, drop, pos: { x, y, z } },
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

    this._broadcastAllFiltered(S2C.BLOCK_UPDATE, {
      pos: { x, y, z },
      block: blockId,
      oldBlock: existing,
      byAccountId: session.accountId,
    }, 'blocks');
    this._send(ws, S2C.WORLD_ACTION_RESULT, {
      actionId, ok: true,
      effects: { placed: blockId, pos: { x, y, z } },
    });
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

  // ── Item actions ──────────────────────────────────────────

  _actionPickUpItem(ws, session, actionId, args) {
    if (!args?.worldItemId) {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.INVALID_ARGUMENT, message: 'worldItemId required' },
      });
    }
    const result = this.items.pickUpItem(session, args.worldItemId);
    this._send(ws, S2C.WORLD_ACTION_RESULT, {
      actionId, ok: result.ok,
      effects: result.ok ? { item: result.item } : undefined,
      error: result.ok ? undefined : { code: ERROR.INVALID_ARGUMENT, message: result.error },
    });
  }

  _actionDropItem(ws, session, actionId, args) {
    if (args?.inventoryIndex == null) {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.INVALID_ARGUMENT, message: 'inventoryIndex required' },
      });
    }
    const result = this.items.dropItem(session, args.inventoryIndex);
    this._send(ws, S2C.WORLD_ACTION_RESULT, {
      actionId, ok: result.ok,
      effects: result.ok ? { item: result.item } : undefined,
      error: result.ok ? undefined : { code: ERROR.INVALID_ARGUMENT, message: result.error },
    });
  }

  _actionEquipItem(ws, session, actionId, args) {
    if (args?.inventoryIndex == null) {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.INVALID_ARGUMENT, message: 'inventoryIndex required' },
      });
    }
    const result = this.items.equipItem(session, args.inventoryIndex);
    this._send(ws, S2C.WORLD_ACTION_RESULT, {
      actionId, ok: result.ok,
      effects: result.ok ? { item: result.item, slot: result.slot } : undefined,
      error: result.ok ? undefined : { code: ERROR.INVALID_ARGUMENT, message: result.error },
    });
  }

  _actionUnequipItem(ws, session, actionId, args) {
    if (!args?.slot) {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.INVALID_ARGUMENT, message: 'slot required' },
      });
    }
    const result = this.items.unequipItem(session, args.slot);
    this._send(ws, S2C.WORLD_ACTION_RESULT, {
      actionId, ok: result.ok,
      effects: result.ok ? { item: result.item, slot: result.slot } : undefined,
      error: result.ok ? undefined : { code: ERROR.INVALID_ARGUMENT, message: result.error },
    });
  }

  _actionTradeOffer(ws, session, actionId, args) {
    if (!args?.toName || args?.inventoryIndex == null) {
      return this._send(ws, S2C.WORLD_ACTION_RESULT, {
        actionId, ok: false,
        error: { code: ERROR.INVALID_ARGUMENT, message: 'toName and inventoryIndex required' },
      });
    }
    const result = this.items.tradeOffer(session, args.toName, args.inventoryIndex);
    this._send(ws, S2C.WORLD_ACTION_RESULT, {
      actionId, ok: result.ok,
      effects: result.ok ? { item: result.item, to: result.to } : undefined,
      error: result.ok ? undefined : { code: ERROR.INVALID_ARGUMENT, message: result.error },
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

    // Gather nearby items on ground
    const nearbyItems = this.items.getNearbyItems(session.pos, 32);

    // Own inventory and equipment
    const inventory = this.items.getInventoryForPerception(session.accountId);
    const equipment = this.items.getEquipmentForPerception(session.accountId);

    this._send(ws, S2C.WORLD_ACTION_RESULT, {
      actionId, ok: true,
      effects: {
        position: session.pos,
        hp: session.hp,
        maxHp: session.maxHp,
        biome: biome?.name ?? 'Unknown',
        worldTime: this._worldTime,
        dayPhase: this._getDayPhase(),
        nearbyBlocks: nearbyBlocks.slice(0, 500),
        nearbyPlayers,
        nearbyMobs,
        nearbyItems,
        inventory,
        equipment,
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

  // ── World/Subscribe ────────────────────────────────────────
  _onWorldSubscribe(ws, payload) {
    const session = this.sessions.get(ws);
    if (!session) return;
    const { streams } = payload ?? {};
    if (!streams || typeof streams !== 'object') return;
    // Merge provided keys into session streams (only known keys)
    for (const key of ['chunks', 'mobs', 'items', 'chat', 'blocks', 'players']) {
      if (key in streams) {
        session._streams[key] = !!streams[key];
      }
    }
  }

  // ── Percept/Query — lightweight semantic perception ────────
  _onPerceptQuery(ws, msg) {
    const session = this.sessions.get(ws);
    if (!session) return;

    const id = msg.payload?.id ?? msg.id;
    const args = msg.payload ?? {};
    const { x, y, z } = session.pos;
    const radius = Math.min(args.radius ?? 8, 16);
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);

    // Summarized block info: counts by type within radius (no raw data)
    const blockCounts = {};
    for (let dx = -radius; dx <= radius; dx++) {
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dz = -radius; dz <= radius; dz++) {
          const block = this._getBlock(bx + dx, by + dy, bz + dz);
          if (block !== AIR) {
            const name = BLOCKS.get(block)?.name ?? 'Unknown';
            blockCounts[name] = (blockCounts[name] || 0) + 1;
          }
        }
      }
    }

    // Nearby entities (players + mobs)
    const nearbyPlayers = [];
    for (const [, other] of this.sessions) {
      if (other.accountId === session.accountId) continue;
      const dist = Math.sqrt((other.pos.x - x) ** 2 + (other.pos.y - y) ** 2 + (other.pos.z - z) ** 2);
      if (dist <= 64) {
        nearbyPlayers.push({
          name: other.name, pos: other.pos,
          distance: Math.round(dist), isAgent: other.isAgent,
        });
      }
    }

    const nearbyMobs = [];
    for (const [, mob] of this.mobs.mobs) {
      const mdist = Math.sqrt((mob.pos.x - x) ** 2 + (mob.pos.z - z) ** 2);
      if (mdist <= 32) {
        nearbyMobs.push({
          id: mob.id, type: mob.type, pos: mob.pos,
          hp: mob.hp, maxHp: mob.maxHp, distance: Math.round(mdist),
        });
      }
    }

    const nearbyItems = this.items.getNearbyItems(session.pos, 32);

    // Biome
    const biomeT = new PerlinNoise(WORLD_SEED + 1000);
    const biomeM = new PerlinNoise(WORLD_SEED + 2000);
    const biomeId = selectBiome(biomeT.fbm(bx / 256, bz / 256, 3), biomeM.fbm(bx / 256, bz / 256, 3));
    const biome = BIOME_DATA[biomeId];

    this._send(ws, S2C.PERCEPT_RESULT, {
      id,
      position: session.pos,
      hp: session.hp, maxHp: session.maxHp,
      biome: biome?.name ?? 'Unknown',
      worldTime: this._worldTime,
      dayPhase: this._getDayPhase(),
      blockSummary: blockCounts,
      nearbyPlayers,
      nearbyMobs,
      nearbyItems,
      inventory: this.items.getInventoryForPerception(session.accountId),
      equipment: this.items.getEquipmentForPerception(session.accountId),
    });
  }

  // ── World/Raycast — find block the agent is facing ─────────
  _onWorldRaycast(ws, msg) {
    const session = this.sessions.get(ws);
    if (!session) return;

    const id = msg.payload?.id ?? msg.id;
    const { x, y, z } = session.pos;
    const rot = session.rot || { x: 0, y: 0, z: 0, w: 1 };

    // Reconstruct forward direction from yaw/pitch (euler y, x)
    const yaw = rot.y ?? 0;
    const pitch = rot.x ?? 0;
    const dirX = -Math.sin(yaw) * Math.cos(pitch);
    const dirY = Math.sin(pitch);
    const dirZ = -Math.cos(yaw) * Math.cos(pitch);

    // Step along ray
    const reach = 6;
    const step = 0.1;
    let prevX = -999, prevY = -999, prevZ = -999;
    let hitBlock = null, hitPos = null, placePos = null;

    for (let d = 0; d < reach; d += step) {
      const px = x + dirX * d;
      const py = y + dirY * d;
      const pz = z + dirZ * d;
      const bx2 = Math.floor(px), by2 = Math.floor(py), bz2 = Math.floor(pz);
      if (bx2 === prevX && by2 === prevY && bz2 === prevZ) continue;

      const blockId = this._getBlock(bx2, by2, bz2);
      if (isSolid(blockId)) {
        hitBlock = { x: bx2, y: by2, z: bz2, blockId, name: BLOCKS.get(blockId)?.name };
        placePos = { x: prevX, y: prevY, z: prevZ };
        break;
      }
      prevX = bx2; prevY = by2; prevZ = bz2;
    }

    this._send(ws, S2C.RAYCAST_RESULT, {
      id,
      hit: hitBlock,
      placePos,
    });
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

    // Update items every 4 ticks
    if (this._tick % 4 === 0) {
      this.items.update(this._tick);
    }

    // Send Player/State to agents every 10 ticks (2x/sec)
    if (this._tick % 10 === 0) {
      for (const [ws, session] of this.sessions) {
        if (session.isAgent && ws.readyState === ws.OPEN) {
          this._send(ws, S2C.PLAYER_STATE, {
            accountId: session.accountId,
            pos: session.pos,
            rot: session.rot,
            hp: session.hp,
            maxHp: session.maxHp,
            dead: session.dead,
            selectedSlot: session.selectedSlot,
            tick: this._tick,
          });
        }
      }
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

  /** Broadcast to everyone except exclude, only to sessions subscribed to stream. */
  _broadcastFiltered(type, payload, exclude, stream) {
    const msg = envelope(type, payload);
    for (const [ws, session] of this.sessions) {
      if (ws !== exclude && ws.readyState === ws.OPEN && session._streams[stream]) {
        ws.send(msg);
      }
    }
  }

  /** Broadcast to all sessions subscribed to stream (including sender). */
  _broadcastAllFiltered(type, payload, stream) {
    const msg = envelope(type, payload);
    for (const [ws, session] of this.sessions) {
      if (ws.readyState === ws.OPEN && session._streams[stream]) {
        ws.send(msg);
      }
    }
  }

  _audit(action, accountId, data) {
    this.auditLog.push({ ts: Date.now(), action, accountId, data });
    if (this.auditLog.length > 10000) this.auditLog.shift();
  }
}
