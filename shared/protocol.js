/**
 * MoltMine World API Protocol — message types and helpers.
 * Implements the envelope described in spec/world-api.md (v0).
 */

// ── Client → Server ───────────────────────────────────────────
export const C2S = {
  AUTH_HELLO:   'Auth/Hello',
  WORLD_JOIN:   'World/Join',
  WORLD_ACTION: 'World/Action',
  WORLD_CHAT:   'World/Chat',
};

// ── Server → Client ───────────────────────────────────────────
export const S2C = {
  AUTH_OK:         'Auth/Ok',
  AUTH_ERROR:      'Auth/Error',
  WORLD_SNAPSHOT:  'World/Snapshot',
  WORLD_CHUNK:     'World/Chunk',
  WORLD_EVENT:     'World/Event',
  WORLD_ACTION_RESULT: 'World/ActionResult',
  PLAYER_JOIN:     'Player/Join',
  PLAYER_LEAVE:    'Player/Leave',
  PLAYER_MOVE:     'Player/Move',
  BLOCK_UPDATE:    'Block/Update',
  CHAT_MESSAGE:    'Chat/Message',
  MOB_SPAWN:       'Mob/Spawn',
  MOB_MOVE:        'Mob/Move',
  MOB_DESPAWN:     'Mob/Despawn',
  MOB_HURT:        'Mob/Hurt',
};

// ── Action kinds (World/Action.kind) ──────────────────────────
export const ACTION = {
  MOVE_TO:   'MoveTo',
  EMOTE:     'Emote',
  SPEAK:     'Speak',
  INTERACT:  'Interact',
  PICK_UP:   'PickUp',
  PLACE:     'Place',
  MINE:      'Mine',
};

// ── Chat channels ─────────────────────────────────────────────
export const CHANNEL = {
  GLOBAL:    'global',
  SPACE:     'space',
  PROXIMITY: 'proximity',
  DM:        'dm',
};

// ── Error codes ───────────────────────────────────────────────
export const ERROR = {
  UNAUTHENTICATED:  'UNAUTHENTICATED',
  UNAUTHORIZED:     'UNAUTHORIZED',
  NOT_FOUND:        'NOT_FOUND',
  INVALID_ARGUMENT: 'INVALID_ARGUMENT',
  RATE_LIMITED:     'RATE_LIMITED',
  CONFLICT:         'CONFLICT',
  INTERNAL:         'INTERNAL',
};

// ── World constants ───────────────────────────────────────────
export const CHUNK_SIZE   = 16;
export const CHUNK_HEIGHT = 64;
export const SEA_LEVEL    = 18;
export const WORLD_SEED   = 42;
export const TICK_RATE     = 20;      // ticks per second
export const RENDER_DISTANCE = 6;     // chunks

// ── Envelope helpers ──────────────────────────────────────────

let _seqId = 0;

export function envelope(type, payload) {
  return JSON.stringify({
    v: 0,
    type,
    id: String(++_seqId),
    ts: Date.now(),
    payload,
  });
}

export function parse(raw) {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
