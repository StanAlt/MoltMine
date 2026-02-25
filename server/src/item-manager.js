/**
 * ItemManager — Server-side item system for BotCraft.
 *
 * Scatters items across the world surface, manages player inventories,
 * equipment slots, pickup/drop, and trading between players/bots.
 */

import { randomUUID } from 'crypto';
import {
  S2C, CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL,
} from '../../shared/protocol.js';
import { isSolid } from '../../shared/blocks.js';
import {
  ITEMS, randomItemByRarity, getItem, rarityName,
} from '../../shared/items.js';

const MAX_WORLD_ITEMS = 200;
const SPAWN_RADIUS = 60;         // blocks from a player
const DESPAWN_RADIUS = 120;
const SPAWN_INTERVAL = 60;       // ticks between spawn attempts (3s)
const INVENTORY_SIZE = 12;
const PICKUP_RANGE = 4;

export class ItemManager {
  constructor(gameServer) {
    this.server = gameServer;

    /** World items on the ground: id -> { id, itemId, pos } */
    this.worldItems = new Map();

    /** Per-account inventory: accountId -> number[] (item IDs, max INVENTORY_SIZE) */
    this.inventories = new Map();

    /** Per-account equipment: accountId -> { head, body, legs, feet, mainHand, offHand } */
    this.equipment = new Map();

    /** Pending trades: tradeId -> { from, to, offerItemId, wantItemId, ts } */
    this.pendingTrades = new Map();

    this._spawnTimer = 0;
  }

  /** Called when a player joins — initialize inventory and equipment. */
  initPlayer(accountId) {
    if (!this.inventories.has(accountId)) {
      this.inventories.set(accountId, []);
    }
    if (!this.equipment.has(accountId)) {
      this.equipment.set(accountId, {
        head: null, body: null, legs: null,
        feet: null, mainHand: null, offHand: null,
      });
    }
  }

  /** Called every N ticks from game loop. */
  update(tick) {
    this._spawnTimer++;
    if (this._spawnTimer >= SPAWN_INTERVAL) {
      this._spawnTimer = 0;
      this._trySpawnItems();
    }

    // Despawn items far from all players
    for (const [id, worldItem] of this.worldItems) {
      if (!this._isNearAnyPlayer(worldItem.pos, DESPAWN_RADIUS)) {
        this.worldItems.delete(id);
        this.server._broadcastAll(S2C.ITEM_DESPAWN, { id });
      }
    }
  }

  _trySpawnItems() {
    if (this.worldItems.size >= MAX_WORLD_ITEMS) return;
    if (this.server.sessions.size === 0) return;

    // Spawn 1-3 items per attempt
    const count = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < count && this.worldItems.size < MAX_WORLD_ITEMS; i++) {
      this._spawnOneItem();
    }
  }

  _spawnOneItem() {
    const sessions = [...this.server.sessions.values()];
    const session = sessions[Math.floor(Math.random() * sessions.length)];

    const angle = Math.random() * Math.PI * 2;
    const dist = 10 + Math.random() * (SPAWN_RADIUS - 10);
    const sx = Math.floor(session.pos.x + Math.cos(angle) * dist);
    const sz = Math.floor(session.pos.z + Math.sin(angle) * dist);

    // Find ground
    const sy = this._findGround(sx, sz);
    if (sy < 0) return;

    const itemId = randomItemByRarity();
    const id = randomUUID().slice(0, 8);
    const pos = { x: sx + 0.5, y: sy + 1.2, z: sz + 0.5 };

    this.worldItems.set(id, { id, itemId, pos });
    this.server._broadcastAll(S2C.ITEM_SPAWN, {
      id,
      itemId,
      pos,
    });
  }

  // ── Actions ────────────────────────────────────────────────

  pickUpItem(session, worldItemId) {
    const worldItem = this.worldItems.get(worldItemId);
    if (!worldItem) return { ok: false, error: 'Item not found' };

    // Check distance
    const dx = worldItem.pos.x - session.pos.x;
    const dz = worldItem.pos.z - session.pos.z;
    if (Math.sqrt(dx * dx + dz * dz) > PICKUP_RANGE) {
      return { ok: false, error: 'Too far away' };
    }

    const inv = this.inventories.get(session.accountId) || [];
    if (inv.length >= INVENTORY_SIZE) {
      return { ok: false, error: 'Inventory full' };
    }

    // Pick up
    inv.push(worldItem.itemId);
    this.inventories.set(session.accountId, inv);
    this.worldItems.delete(worldItemId);

    // Broadcast removal
    this.server._broadcastAll(S2C.ITEM_DESPAWN, { id: worldItemId });

    // Send updated inventory
    this._sendInventory(session);

    const item = getItem(worldItem.itemId);
    return { ok: true, item: item?.name ?? 'Unknown' };
  }

  dropItem(session, inventoryIndex) {
    const inv = this.inventories.get(session.accountId) || [];
    if (inventoryIndex < 0 || inventoryIndex >= inv.length) {
      return { ok: false, error: 'Invalid slot' };
    }

    const itemId = inv[inventoryIndex];
    inv.splice(inventoryIndex, 1);
    this.inventories.set(session.accountId, inv);

    // Spawn on ground near player
    const id = randomUUID().slice(0, 8);
    const pos = {
      x: session.pos.x + (Math.random() - 0.5) * 2,
      y: session.pos.y - 1,
      z: session.pos.z + (Math.random() - 0.5) * 2,
    };

    this.worldItems.set(id, { id, itemId, pos });
    this.server._broadcastAll(S2C.ITEM_SPAWN, { id, itemId, pos });
    this._sendInventory(session);

    const item = getItem(itemId);
    return { ok: true, item: item?.name ?? 'Unknown' };
  }

  equipItem(session, inventoryIndex) {
    const inv = this.inventories.get(session.accountId) || [];
    if (inventoryIndex < 0 || inventoryIndex >= inv.length) {
      return { ok: false, error: 'Invalid slot' };
    }

    const itemId = inv[inventoryIndex];
    const itemDef = getItem(itemId);
    if (!itemDef || !itemDef.slot) {
      return { ok: false, error: 'Cannot equip this item' };
    }

    const equip = this.equipment.get(session.accountId);
    const slot = itemDef.slot;

    // If something already equipped in that slot, swap to inventory
    if (equip[slot] !== null) {
      inv.push(equip[slot]);
    }

    // Equip the new item
    equip[slot] = itemId;
    inv.splice(inventoryIndex, 1);
    this.inventories.set(session.accountId, inv);

    this._sendInventory(session);
    this._sendEquipment(session);

    // Broadcast equip to all players so they can see it
    this.server._broadcastAll(S2C.EQUIP_UPDATE, {
      accountId: session.accountId,
      equipment: this._serializeEquipment(equip),
    });

    return { ok: true, item: itemDef.name, slot };
  }

  unequipItem(session, slot) {
    const equip = this.equipment.get(session.accountId);
    if (!equip || equip[slot] === null) {
      return { ok: false, error: 'Nothing equipped there' };
    }

    const inv = this.inventories.get(session.accountId) || [];
    if (inv.length >= INVENTORY_SIZE) {
      return { ok: false, error: 'Inventory full' };
    }

    const itemId = equip[slot];
    equip[slot] = null;
    inv.push(itemId);
    this.inventories.set(session.accountId, inv);

    this._sendInventory(session);
    this._sendEquipment(session);

    this.server._broadcastAll(S2C.EQUIP_UPDATE, {
      accountId: session.accountId,
      equipment: this._serializeEquipment(equip),
    });

    const item = getItem(itemId);
    return { ok: true, item: item?.name ?? 'Unknown', slot };
  }

  tradeOffer(fromSession, toName, offerIndex) {
    // Find target player
    let toSession = null;
    for (const [, s] of this.server.sessions) {
      if (s.name === toName && s.accountId !== fromSession.accountId) {
        toSession = s;
        break;
      }
    }
    if (!toSession) return { ok: false, error: 'Player not found' };

    const fromInv = this.inventories.get(fromSession.accountId) || [];
    if (offerIndex < 0 || offerIndex >= fromInv.length) {
      return { ok: false, error: 'Invalid inventory slot' };
    }

    const offerItemId = fromInv[offerIndex];
    const offerItem = getItem(offerItemId);

    // Direct gift trade — item goes from sender to receiver
    const toInv = this.inventories.get(toSession.accountId) || [];
    if (toInv.length >= INVENTORY_SIZE) {
      return { ok: false, error: `${toName}'s inventory is full` };
    }

    // Transfer
    fromInv.splice(offerIndex, 1);
    toInv.push(offerItemId);
    this.inventories.set(fromSession.accountId, fromInv);
    this.inventories.set(toSession.accountId, toInv);

    this._sendInventory(fromSession);
    this._sendInventory(toSession);

    // Announce
    this.server._broadcastAll(S2C.TRADE_COMPLETE, {
      from: fromSession.name,
      to: toSession.name,
      itemName: offerItem?.name ?? 'Unknown',
    });

    return { ok: true, item: offerItem?.name ?? 'Unknown', to: toName };
  }

  // ── Helpers ────────────────────────────────────────────────

  _sendInventory(session) {
    const inv = this.inventories.get(session.accountId) || [];
    const items = inv.map(id => {
      const def = getItem(id);
      return def ? { id: def.id, name: def.name, rarity: def.rarity, category: def.category } : null;
    }).filter(Boolean);

    this.server._send(session.ws, S2C.INVENTORY_UPDATE, { items });
  }

  _sendEquipment(session) {
    const equip = this.equipment.get(session.accountId);
    this.server._send(session.ws, S2C.EQUIP_UPDATE, {
      accountId: session.accountId,
      equipment: this._serializeEquipment(equip),
    });
  }

  _serializeEquipment(equip) {
    const result = {};
    for (const [slot, itemId] of Object.entries(equip)) {
      if (itemId !== null) {
        const def = getItem(itemId);
        result[slot] = def ? { id: def.id, name: def.name, rarity: def.rarity, color: def.color, category: def.category } : null;
      } else {
        result[slot] = null;
      }
    }
    return result;
  }

  /** Send all world items and player equipment to a newly joined player. */
  sendInitialState(ws, session) {
    // World items
    for (const item of this.worldItems.values()) {
      this.server._send(ws, S2C.ITEM_SPAWN, {
        id: item.id,
        itemId: item.itemId,
        pos: item.pos,
      });
    }

    // Own inventory + equipment
    this._sendInventory(session);
    this._sendEquipment(session);

    // Other players' equipment
    for (const [, other] of this.server.sessions) {
      if (other.accountId === session.accountId) continue;
      const equip = this.equipment.get(other.accountId);
      if (equip) {
        this.server._send(ws, S2C.EQUIP_UPDATE, {
          accountId: other.accountId,
          equipment: this._serializeEquipment(equip),
        });
      }
    }
  }

  /** Get perceivable items near a position. */
  getNearbyItems(pos, radius) {
    const result = [];
    for (const [, worldItem] of this.worldItems) {
      const dx = worldItem.pos.x - pos.x;
      const dz = worldItem.pos.z - pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= radius) {
        const def = getItem(worldItem.itemId);
        result.push({
          worldId: worldItem.id,
          name: def?.name ?? 'Unknown',
          rarity: rarityName(def?.rarity ?? 0),
          category: def?.category ?? 'unknown',
          distance: Math.round(dist),
          pos: worldItem.pos,
        });
      }
    }
    return result;
  }

  /** Get a player's inventory as named items (for perception). */
  getInventoryForPerception(accountId) {
    const inv = this.inventories.get(accountId) || [];
    return inv.map((id, i) => {
      const def = getItem(id);
      return def ? { slot: i, name: def.name, rarity: rarityName(def.rarity), category: def.category } : null;
    }).filter(Boolean);
  }

  /** Get a player's equipped items as named items (for perception). */
  getEquipmentForPerception(accountId) {
    const equip = this.equipment.get(accountId);
    if (!equip) return {};
    const result = {};
    for (const [slot, itemId] of Object.entries(equip)) {
      if (itemId !== null) {
        const def = getItem(itemId);
        result[slot] = def ? `${def.name} (${rarityName(def.rarity)})` : null;
      }
    }
    return result;
  }

  _findGround(x, z) {
    for (let y = CHUNK_HEIGHT - 2; y > SEA_LEVEL; y--) {
      if (isSolid(this.server._getBlock(x, y, z)) &&
          !isSolid(this.server._getBlock(x, y + 1, z))) {
        return y;
      }
    }
    return -1;
  }

  _isNearAnyPlayer(pos, radius) {
    for (const [, session] of this.server.sessions) {
      const dx = session.pos.x - pos.x;
      const dz = session.pos.z - pos.z;
      if (dx * dx + dz * dz < radius * radius) return true;
    }
    return false;
  }
}
