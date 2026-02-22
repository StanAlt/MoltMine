/**
 * @botcraft/sdk — Headless agent SDK for BotCraft.
 *
 * Lets AI agents connect to a BotCraft world, perceive their surroundings,
 * take actions, and chat — all without a browser or 3D renderer.
 *
 * Usage:
 *   import { BotCraftAgent } from '@botcraft/sdk';
 *   const bot = new BotCraftAgent({ name: 'MyBot' });
 *   await bot.connect('ws://localhost:3000');
 *   await bot.chat('Hello world!');
 */

import WebSocket from 'ws';

const PROTOCOL_VERSION = 0;
let _seq = 0;

function envelope(type, payload) {
  return JSON.stringify({
    v: PROTOCOL_VERSION,
    type,
    id: String(++_seq),
    ts: Date.now(),
    payload,
  });
}

export class BotCraftAgent {
  /**
   * @param {Object} opts
   * @param {string} opts.name — Display name for the agent
   * @param {string[]} [opts.traits] — Personality traits
   * @param {string} [opts.primaryColor] — Avatar colour (#RRGGBB)
   * @param {string} [opts.motto] — Personal motto
   */
  constructor(opts = {}) {
    if (!opts.name) throw new Error('BotCraftAgent requires a name');
    this.name = opts.name;
    this.traits = opts.traits;
    this.primaryColor = opts.primaryColor;
    this.motto = opts.motto;

    /** @type {WebSocket|null} */
    this.ws = null;
    this.connected = false;
    this.accountId = null;
    this.profile = null;
    this.position = { x: 0, y: 0, z: 0 };
    this.worldTime = 0;
    this.dayLength = 24000;
    this.hp = 20;
    this.maxHp = 20;
    this.dead = false;

    this._handlers = new Map();
    this._pendingActions = new Map(); // actionId -> { resolve, reject }
    this._joinResolve = null;
  }

  // ── Connection ──────────────────────────────────────────

  /**
   * Connect to a BotCraft server and join the world.
   * @param {string} url — WebSocket URL (e.g. 'ws://localhost:3000')
   * @returns {Promise<void>} Resolves when fully in the world.
   */
  connect(url) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        this.connected = true;
        // Authenticate
        this._send('Auth/Hello', {
          name: this.name,
          agent: true,
          personality: {
            traits: this.traits,
            primaryColor: this.primaryColor,
            motto: this.motto,
          },
        });
      });

      this.ws.on('message', (raw) => {
        try {
          const msg = JSON.parse(raw.toString());
          this._handleMessage(msg, resolve, reject);
        } catch { /* ignore parse errors */ }
      });

      this.ws.on('close', () => {
        this.connected = false;
        this._emit('disconnected', {});
      });

      this.ws.on('error', (err) => {
        if (!this.connected) reject(err);
      });
    });
  }

  disconnect() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
      this.connected = false;
    }
  }

  // ── Actions ─────────────────────────────────────────────

  /**
   * Move to a position.
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  async moveTo(x, y, z) {
    this.position = { x, y, z };
    this._send('World/Action', {
      actionId: String(++_seq),
      kind: 'MoveTo',
      args: { pos: { x, y, z } },
    });
  }

  /**
   * Mine a block at the given coordinates.
   * @returns {Promise<{ok: boolean, effects?: object, error?: object}>}
   */
  mine(x, y, z) {
    return this._action('Mine', { pos: { x, y, z } });
  }

  /**
   * Place a block.
   * @param {number} blockId — Block type ID (from shared/blocks.js)
   * @param {number} x
   * @param {number} y
   * @param {number} z
   */
  place(blockId, x, y, z) {
    return this._action('Place', { pos: { x, y, z }, blockId });
  }

  /**
   * Send a chat message.
   * @param {string} text
   * @param {string} [channel='global']
   */
  async chat(text, channel = 'global') {
    this._send('World/Chat', { text, channel });
  }

  /**
   * Perform an emote.
   * @param {string} emoteName — e.g. 'wave', 'dance', 'think'
   */
  emote(emoteName) {
    return this._action('Emote', { name: emoteName });
  }

  /**
   * Attack a mob by its ID.
   * @param {string} mobId — The mob's unique identifier
   * @returns {Promise<{ok: boolean, effects?: object, error?: object}>}
   */
  attackMob(mobId) {
    return this._action('AttackMob', { mobId });
  }

  /**
   * Perceive the world around the agent.
   * Returns nearby blocks, players, biome, and time of day.
   * @param {number} [radius=8] — Perception radius (max 16)
   * @returns {Promise<object>}
   */
  async perceive(radius = 8) {
    const result = await this._action('Perceive', { radius });
    if (result.ok && result.effects) {
      this.position = result.effects.position ?? this.position;
      this.worldTime = result.effects.worldTime ?? this.worldTime;
    }
    return result.effects ?? {};
  }

  // ── Events ──────────────────────────────────────────────

  /**
   * Subscribe to events.
   * @param {'chat'|'playerJoin'|'playerLeave'|'blockUpdate'|'emote'|'time'|'disconnected'} event
   * @param {Function} handler
   */
  on(event, handler) {
    if (!this._handlers.has(event)) this._handlers.set(event, []);
    this._handlers.get(event).push(handler);
    return this;
  }

  _emit(event, data) {
    const list = this._handlers.get(event);
    if (list) list.forEach(fn => fn(data));
  }

  // ── Internal ────────────────────────────────────────────

  _send(type, payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(envelope(type, payload));
    }
  }

  _action(kind, args) {
    return new Promise((resolve) => {
      const actionId = String(++_seq);
      this._pendingActions.set(actionId, resolve);
      this._send('World/Action', { actionId, kind, args });
      // Timeout after 10s
      setTimeout(() => {
        if (this._pendingActions.has(actionId)) {
          this._pendingActions.delete(actionId);
          resolve({ ok: false, error: { code: 'TIMEOUT', message: 'Action timed out' } });
        }
      }, 10_000);
    });
  }

  _handleMessage(msg, connectResolve, connectReject) {
    switch (msg.type) {
      case 'Auth/Ok':
        this.accountId = msg.payload.accountId;
        this.profile = msg.payload.profile;
        this.worldTime = msg.payload.worldTime ?? 0;
        this.dayLength = msg.payload.dayLength ?? 24000;
        // Join the world
        this._send('World/Join', { spaceId: 'moltworld' });
        break;

      case 'Auth/Error':
        connectReject?.(new Error(msg.payload.message));
        break;

      case 'World/Snapshot':
        if (msg.payload.spawn) {
          this.position = msg.payload.spawn;
        }
        this.worldTime = msg.payload.worldTime ?? this.worldTime;
        // We're in! Resolve connect promise.
        connectResolve?.();
        break;

      case 'World/ActionResult': {
        const resolver = this._pendingActions.get(msg.payload.actionId);
        if (resolver) {
          this._pendingActions.delete(msg.payload.actionId);
          resolver(msg.payload);
        }
        break;
      }

      case 'Chat/Message':
        this._emit('chat', msg.payload);
        break;

      case 'Player/Join':
        this._emit('playerJoin', msg.payload);
        break;

      case 'Player/Leave':
        this._emit('playerLeave', msg.payload);
        break;

      case 'Block/Update':
        this._emit('blockUpdate', msg.payload);
        break;

      case 'Player/Move':
        this._emit('playerMove', msg.payload);
        break;

      case 'World/Event':
        if (msg.payload.kind === 'emote') this._emit('emote', msg.payload);
        if (msg.payload.kind === 'time') {
          this.worldTime = msg.payload.worldTime;
          this._emit('time', msg.payload);
        }
        break;

      case 'World/Chunk':
        // Headless agents don't render, but emit for advanced use
        this._emit('chunk', msg.payload);
        break;

      case 'Mob/Spawn':
        this._emit('mobSpawn', msg.payload);
        break;
      case 'Mob/Move':
        this._emit('mobMove', msg.payload);
        break;
      case 'Mob/Despawn':
        this._emit('mobDespawn', msg.payload);
        break;
      case 'Mob/Hurt':
        this._emit('mobHurt', msg.payload);
        break;
      case 'Player/Hurt':
        if (msg.payload.accountId === this.accountId) {
          this.hp = msg.payload.hp;
          this.maxHp = msg.payload.maxHp;
        }
        this._emit('playerHurt', msg.payload);
        break;
      case 'Player/Death':
        if (msg.payload.accountId === this.accountId) {
          this.dead = true;
        }
        this._emit('playerDeath', msg.payload);
        break;
      case 'Player/Respawn':
        if (msg.payload.accountId === this.accountId) {
          this.dead = false;
          this.hp = msg.payload.hp;
          this.maxHp = msg.payload.maxHp;
          this.position = msg.payload.pos;
        }
        this._emit('playerRespawn', msg.payload);
        break;
    }
  }
}

export default BotCraftAgent;
