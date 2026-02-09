/**
 * MoltMine Authoritative Game Server
 *
 * Manages the world state, processes player actions, enforces permissions,
 * and broadcasts state changes over WebSocket. Implements the World API v0.
 */

import { WebSocketServer } from 'ws';
import { randomUUID } from 'crypto';
import { WorldGen } from './world-gen.js';
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

// ── Personality traits pool ───────────────────────────────────
const TRAITS = [
  'adventurous', 'creative', 'curious', 'friendly', 'brave',
  'resourceful', 'witty', 'thoughtful', 'energetic', 'calm',
  'builder', 'explorer', 'socialite', 'strategist', 'artist',
];
const MOTTOS = [
  'Building the future, one block at a time.',
  'Every block tells a story.',
  'MoltWorld is what we make it.',
  'Exploring the unknown together.',
  'Create. Connect. Conquer.',
  'In MoltWorld, we are free.',
  'The MoltiVerse awaits!',
];
const BODY_TYPES = ['standard', 'tall', 'compact', 'wide'];

export class GameServer {
  constructor(httpServer, opts = {}) {
    this.wss = new WebSocketServer({ server: httpServer });
    this.worldGen = new WorldGen(opts.seed ?? WORLD_SEED);

    /** @type {Map<string, Uint8Array>} chunkKey -> block data */
    this.chunks = new Map();

    /** @type {Map<WebSocket, PlayerSession>} */
    this.sessions = new Map();

    /** @type {Map<string, PlayerSession>} accountId -> session */
    this.accounts = new Map();

    /** Audit log (in-memory for MVP, write to file later) */
    this.auditLog = [];

    this._tick = 0;
    this._tickInterval = null;

    this.wss.on('connection', (ws) => this._onConnect(ws));
  }

  start() {
    this._tickInterval = setInterval(() => this._gameTick(), 1000 / TICK_RATE);
    console.log(`[MoltMine] Game loop started at ${TICK_RATE} tps`);
  }

  stop() {
    clearInterval(this._tickInterval);
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
    this.sessions.delete(ws);
    this.accounts.delete(session.accountId);
    this._broadcast(S2C.PLAYER_LEAVE, { accountId: session.accountId, name: session.name }, ws);
    this._audit('disconnect', session.accountId, {});
    console.log(`[MoltMine] ${session.name} left (${this.sessions.size} online)`);
  }

  _handleMessage(ws, msg) {
    switch (msg.type) {
      case C2S.AUTH_HELLO:  return this._onAuthHello(ws, msg.payload);
      case C2S.WORLD_JOIN:  return this._onWorldJoin(ws, msg.payload);
      case C2S.WORLD_ACTION: return this._onWorldAction(ws, msg);
      case C2S.WORLD_CHAT:  return this._onWorldChat(ws, msg.payload);
    }
  }

  // ── Auth ──────────────────────────────────────────────────
  _onAuthHello(ws, payload) {
    const { name, personality } = payload ?? {};
    if (!name || typeof name !== 'string') {
      return this._send(ws, S2C.AUTH_ERROR, { code: ERROR.INVALID_ARGUMENT, message: 'name required' });
    }

    const accountId = randomUUID();
    const profile = this._generateProfile(accountId, name, personality);
    const session = {
      accountId,
      name,
      profile,
      pos: { x: 0, y: 40, z: 0 },
      rot: { x: 0, y: 0, z: 0, w: 1 },
      hotbar: [...DEFAULT_HOTBAR],
      selectedSlot: 0,
      ws,
    };

    this.sessions.set(ws, session);
    this.accounts.set(accountId, session);

    this._send(ws, S2C.AUTH_OK, {
      accountId,
      profile,
      hotbar: session.hotbar,
    });

    this._audit('auth', accountId, { name });
    console.log(`[MoltMine] ${name} authenticated (${this.sessions.size} online)`);
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
        });
      }
    }

    // Send chunks around spawn
    const pcx = Math.floor(spawn.x / CHUNK_SIZE);
    const pcz = Math.floor(spawn.z / CHUNK_SIZE);
    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
      for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
        this._sendChunk(ws, pcx + dx, pcz + dz);
      }
    }

    // Send spawn position
    this._send(ws, S2C.WORLD_SNAPSHOT, {
      spaceId: 'moltworld',
      tick: this._tick,
      spawn: session.pos,
    });

    // Announce new player to everyone else
    this._broadcast(S2C.PLAYER_JOIN, {
      accountId: session.accountId,
      name: session.name,
      profile: session.profile,
      pos: session.pos,
    }, ws);

    this._audit('join', session.accountId, { spawn });
    console.log(`[MoltMine] ${session.name} joined at (${spawn.x}, ${spawn.y}, ${spawn.z})`);
  }

  // ── Actions ───────────────────────────────────────────────
  _onWorldAction(ws, msg) {
    const session = this.sessions.get(ws);
    if (!session) return;

    const { actionId, kind, args } = msg.payload ?? {};

    switch (kind) {
      case ACTION.MOVE_TO: return this._actionMove(ws, session, actionId, args);
      case ACTION.MINE:    return this._actionMine(ws, session, actionId, args);
      case ACTION.PLACE:   return this._actionPlace(ws, session, actionId, args);
      case ACTION.EMOTE:   return this._actionEmote(ws, session, actionId, args);
      case ACTION.SPEAK:   return this._onWorldChat(ws, args);
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

    // Broadcast to others
    this._broadcast(S2C.PLAYER_MOVE, {
      accountId: session.accountId,
      pos: session.pos,
      rot: session.rot,
    }, ws);

    // Send new chunks if needed
    const pcx = Math.floor(x / CHUNK_SIZE);
    const pcz = Math.floor(z / CHUNK_SIZE);
    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
      for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
        const key = chunkKey(pcx + dx, pcz + dz);
        // The client will request chunks it doesn't have;
        // for now, we eagerly send all nearby chunks
        // (the client deduplicates)
      }
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

    // Broadcast block update
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

  // ── Chat ──────────────────────────────────────────────────
  _onWorldChat(ws, payload) {
    const session = this.sessions.get(ws);
    if (!session) return;

    const { text, channel } = payload ?? {};
    if (!text || typeof text !== 'string') return;
    const cleanText = text.slice(0, 500); // basic length limit

    const chatMsg = {
      accountId: session.accountId,
      name: session.name,
      text: cleanText,
      channel: channel || CHANNEL.GLOBAL,
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
    // Send chunk as base64 to keep JSON transport simple
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
  }

  // ── Spawn finding ─────────────────────────────────────────
  _findSpawn() {
    // Look for a solid surface near origin
    for (let x = 0; x < 16; x++) {
      for (let z = 0; z < 16; z++) {
        for (let y = CHUNK_HEIGHT - 2; y > SEA_LEVEL; y--) {
          if (isSolid(this._getBlock(x, y, z)) && !isSolid(this._getBlock(x, y + 1, z))) {
            return { x: x + 0.5, y: y + 1.5, z: z + 0.5 };
          }
        }
      }
    }
    return { x: 8, y: 40, z: 8 };
  }

  // ── Molty profile ─────────────────────────────────────────
  _generateProfile(accountId, name, overrides = {}) {
    // Deterministic-ish defaults from name hash
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

    return {
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
  }

  // ── Game tick ─────────────────────────────────────────────
  _gameTick() {
    this._tick++;
    // Future: physics updates, NPC AI, day/night cycle, etc.
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
    // Keep last 10k entries in memory
    if (this.auditLog.length > 10000) this.auditLog.shift();
  }
}
