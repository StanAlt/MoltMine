/**
 * WebSocket connection to the MoltMine server.
 * Implements the World API v0 client side.
 */

import { C2S, S2C, ACTION, envelope, parse } from '@shared/protocol.js';

export class Connection {
  constructor() {
    /** @type {WebSocket|null} */
    this.ws = null;
    this.handlers = new Map();
    this.connected = false;
  }

  connect(url) {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(url);
      this.ws.onopen = () => {
        this.connected = true;
        resolve();
      };
      this.ws.onerror = (e) => reject(e);
      this.ws.onclose = () => {
        this.connected = false;
        this._emit('disconnected', {});
      };
      this.ws.onmessage = (e) => {
        const msg = parse(e.data);
        if (msg) this._emit(msg.type, msg.payload);
      };
    });
  }

  on(type, handler) {
    if (!this.handlers.has(type)) this.handlers.set(type, []);
    this.handlers.get(type).push(handler);
  }

  _emit(type, payload) {
    const list = this.handlers.get(type);
    if (list) list.forEach(fn => fn(payload));
  }

  send(type, payload) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(envelope(type, payload));
    }
  }

  // ── High-level API ──────────────────────────────────────

  authenticate(name, personality = {}) {
    this.send(C2S.AUTH_HELLO, { name, personality });
  }

  joinWorld(spaceId = 'moltworld') {
    this.send(C2S.WORLD_JOIN, { spaceId });
  }

  sendMove(pos, rot) {
    this.send(C2S.WORLD_ACTION, {
      actionId: String(Date.now()),
      kind: ACTION.MOVE_TO,
      args: { pos, rot },
    });
  }

  sendMine(pos) {
    this.send(C2S.WORLD_ACTION, {
      actionId: String(Date.now()),
      kind: ACTION.MINE,
      args: { pos },
    });
  }

  sendPlace(pos, blockId) {
    this.send(C2S.WORLD_ACTION, {
      actionId: String(Date.now()),
      kind: ACTION.PLACE,
      args: { pos, blockId },
    });
  }

  sendChat(text, channel = 'global') {
    this.send(C2S.WORLD_CHAT, { text, channel });
  }

  sendEmote(name) {
    this.send(C2S.WORLD_ACTION, {
      actionId: String(Date.now()),
      kind: ACTION.EMOTE,
      args: { name },
    });
  }
}
