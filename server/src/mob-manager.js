/**
 * MobManager — Server-side creature system for BotCraft.
 *
 * Spawns, updates, and broadcasts mob state. Six creature types across
 * different biomes with simple AI behaviors (wander, flee, chase).
 */

import { randomUUID } from 'crypto';
import {
  S2C, CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL,
} from '../../shared/protocol.js';
import { AIR, isSolid, WATER } from '../../shared/blocks.js';
import { selectBiome, BIOME } from '../../shared/biomes.js';
import { PerlinNoise } from '../../shared/noise.js';

// ── Mob type definitions ────────────────────────────────────

const MOB_TYPES = {
  woolly: {
    name: 'Woolly',
    hostile: false,
    hp: 10,
    speed: 1.5,
    biomes: [BIOME.VERDANT_PLAINS, BIOME.FROST_PEAKS],
    color: 0xEEDDCC,
    width: 0.8,
    height: 1.0,
  },
  glowbug: {
    name: 'Glowbug',
    hostile: false,
    hp: 4,
    speed: 2.5,
    biomes: [BIOME.CRYSTAL_FOREST, BIOME.MUSHROOM_GLADES],
    color: 0x00FFAA,
    width: 0.4,
    height: 0.4,
  },
  frostling: {
    name: 'Frostling',
    hostile: false,
    hp: 8,
    speed: 1.8,
    biomes: [BIOME.FROST_PEAKS],
    color: 0xAADDFF,
    width: 0.6,
    height: 0.8,
  },
  shroomy: {
    name: 'Shroomy',
    hostile: false,
    hp: 6,
    speed: 1.2,
    biomes: [BIOME.MUSHROOM_GLADES],
    color: 0xCC3366,
    width: 0.7,
    height: 0.9,
  },
  lava_slime: {
    name: 'Lava Slime',
    hostile: true,
    hp: 14,
    speed: 1.0,
    biomes: [BIOME.MOLTEN_BADLANDS],
    color: 0xFF4400,
    width: 0.9,
    height: 0.7,
    damage: 3,
    aggroRange: 12,
  },
  shadow_creep: {
    name: 'Shadow Creep',
    hostile: true,
    hp: 16,
    speed: 3.0,
    biomes: null, // spawns everywhere at night
    color: 0x220033,
    width: 0.6,
    height: 1.6,
    damage: 4,
    aggroRange: 16,
    nightOnly: true,
  },
};

const MAX_MOBS = 40;
const SPAWN_RADIUS = 48;       // blocks from a player
const DESPAWN_RADIUS = 80;     // beyond this, remove
const SPAWN_INTERVAL = 100;    // ticks between spawn attempts (5s at 20tps)
const WANDER_INTERVAL = 60;    // ticks between wander decisions

export class MobManager {
  constructor(gameServer) {
    this.server = gameServer;
    /** @type {Map<string, MobInstance>} */
    this.mobs = new Map();
    this._spawnTimer = 0;
    this._biomeT = new PerlinNoise(42 + 1000);
    this._biomeM = new PerlinNoise(42 + 2000);
  }

  update(tick, dayPhase) {
    // Spawn new mobs periodically
    this._spawnTimer++;
    if (this._spawnTimer >= SPAWN_INTERVAL) {
      this._spawnTimer = 0;
      this._trySpawn(dayPhase);
    }

    // Update each mob
    for (const [id, mob] of this.mobs) {
      // Despawn if too far from all players
      if (!this._isNearAnyPlayer(mob.pos, DESPAWN_RADIUS)) {
        this.mobs.delete(id);
        this.server._broadcastAll(S2C.MOB_DESPAWN, { id });
        continue;
      }

      // AI update
      this._updateMob(mob, tick, dayPhase);
    }
  }

  _trySpawn(dayPhase) {
    if (this.mobs.size >= MAX_MOBS) return;
    if (this.server.sessions.size === 0) return;

    // Pick a random player to spawn near
    const sessions = [...this.server.sessions.values()];
    const session = sessions[Math.floor(Math.random() * sessions.length)];
    const px = session.pos.x;
    const pz = session.pos.z;

    // Random offset from player
    const angle = Math.random() * Math.PI * 2;
    const dist = 20 + Math.random() * (SPAWN_RADIUS - 20);
    const sx = Math.floor(px + Math.cos(angle) * dist);
    const sz = Math.floor(pz + Math.sin(angle) * dist);

    // Determine biome at spawn point
    const temp = this._biomeT.fbm(sx / 256, sz / 256, 3);
    const moist = this._biomeM.fbm(sx / 256, sz / 256, 3);
    const biomeId = selectBiome(temp, moist);

    // Pick a valid mob type for this biome + time
    const candidates = Object.entries(MOB_TYPES).filter(([, def]) => {
      if (def.nightOnly && dayPhase !== 'night' && dayPhase !== 'dusk') return false;
      if (def.biomes === null) return true; // spawns anywhere (shadow_creep at night)
      return def.biomes.includes(biomeId);
    });

    if (candidates.length === 0) return;

    const [typeKey, typeDef] = candidates[Math.floor(Math.random() * candidates.length)];

    // Find ground level at spawn point
    const sy = this._findGround(sx, sz);
    if (sy < 0) return;

    const mob = {
      id: randomUUID().slice(0, 8),
      type: typeKey,
      pos: { x: sx + 0.5, y: sy + 1, z: sz + 0.5 },
      vel: { x: 0, y: 0, z: 0 },
      hp: typeDef.hp,
      maxHp: typeDef.hp,
      _wanderTarget: null,
      _wanderTimer: 0,
      _idleTimer: Math.floor(Math.random() * WANDER_INTERVAL),
    };

    this.mobs.set(mob.id, mob);
    this.server._broadcastAll(S2C.MOB_SPAWN, {
      id: mob.id,
      type: mob.type,
      pos: mob.pos,
      hp: mob.hp,
      maxHp: mob.maxHp,
    });
  }

  _updateMob(mob, tick, dayPhase) {
    const def = MOB_TYPES[mob.type];
    if (!def) return;

    // Shadow creeps despawn at dawn
    if (def.nightOnly && dayPhase !== 'night' && dayPhase !== 'dusk') {
      this.mobs.delete(mob.id);
      this.server._broadcastAll(S2C.MOB_DESPAWN, { id: mob.id });
      return;
    }

    if (def.hostile) {
      this._updateHostile(mob, def);
    } else {
      this._updatePassive(mob, def);
    }
  }

  _updatePassive(mob, def) {
    mob._idleTimer++;

    // Wander periodically
    if (mob._idleTimer >= WANDER_INTERVAL) {
      mob._idleTimer = 0;

      // Pick a random nearby point to wander toward
      const angle = Math.random() * Math.PI * 2;
      const dist = 3 + Math.random() * 5;
      mob._wanderTarget = {
        x: mob.pos.x + Math.cos(angle) * dist,
        z: mob.pos.z + Math.sin(angle) * dist,
      };
    }

    // Move toward wander target
    if (mob._wanderTarget) {
      const dx = mob._wanderTarget.x - mob.pos.x;
      const dz = mob._wanderTarget.z - mob.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist < 0.5) {
        mob._wanderTarget = null;
      } else {
        const moveSpeed = def.speed * 0.2; // scale for tick rate
        const mx = (dx / dist) * moveSpeed;
        const mz = (dz / dist) * moveSpeed;

        const newX = mob.pos.x + mx;
        const newZ = mob.pos.z + mz;

        // Check ground at new position
        const gy = this._findGround(Math.floor(newX), Math.floor(newZ));
        if (gy >= 0) {
          mob.pos.x = newX;
          mob.pos.z = newZ;
          mob.pos.y = gy + 1;
          this.server._broadcastAll(S2C.MOB_MOVE, {
            id: mob.id,
            pos: mob.pos,
          });
        } else {
          mob._wanderTarget = null;
        }
      }
    }
  }

  _updateHostile(mob, def) {
    // Find nearest player
    let nearest = null;
    let nearestDist = Infinity;
    for (const [, session] of this.server.sessions) {
      const dx = session.pos.x - mob.pos.x;
      const dz = session.pos.z - mob.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist < nearestDist) {
        nearest = session;
        nearestDist = dist;
      }
    }

    if (nearest && nearestDist < (def.aggroRange || 12)) {
      // Chase player
      const dx = nearest.pos.x - mob.pos.x;
      const dz = nearest.pos.z - mob.pos.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > 1.5) {
        const moveSpeed = def.speed * 0.2;
        const mx = (dx / dist) * moveSpeed;
        const mz = (dz / dist) * moveSpeed;

        const newX = mob.pos.x + mx;
        const newZ = mob.pos.z + mz;
        const gy = this._findGround(Math.floor(newX), Math.floor(newZ));
        if (gy >= 0) {
          mob.pos.x = newX;
          mob.pos.z = newZ;
          mob.pos.y = gy + 1;
          this.server._broadcastAll(S2C.MOB_MOVE, {
            id: mob.id,
            pos: mob.pos,
          });
        }
      }
    } else {
      // Wander like passive when no target
      this._updatePassive(mob, def);
    }
  }

  /** Handle a player attacking a mob (called from game server). */
  damageMob(mobId, damage, attackerSession) {
    const mob = this.mobs.get(mobId);
    if (!mob) return;

    mob.hp = Math.max(0, mob.hp - damage);
    this.server._broadcastAll(S2C.MOB_HURT, {
      id: mob.id,
      hp: mob.hp,
      maxHp: mob.maxHp,
    });

    if (mob.hp <= 0) {
      this.mobs.delete(mob.id);
      this.server._broadcastAll(S2C.MOB_DESPAWN, { id: mob.id });
    }
  }

  _findGround(x, z) {
    for (let y = CHUNK_HEIGHT - 2; y > SEA_LEVEL; y--) {
      const block = this.server._getBlock(x, y, z);
      const above = this.server._getBlock(x, y + 1, z);
      if (isSolid(block) && !isSolid(above) && above !== WATER) {
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
