/**
 * Procedural terrain generator for MoltWorld.
 *
 * Uses seeded Perlin noise to produce a deterministic voxel landscape
 * with multiple biomes, ore veins, trees, and special MoltWorld features.
 */

import { PerlinNoise } from '../../shared/noise.js';
import { selectBiome, BIOME_DATA } from '../../shared/biomes.js';
import {
  AIR, STONE, BEDROCK, WATER, COAL_ORE, IRON_ORE, GOLD_ORE,
  DIAMOND_ORE, MOLTIUM_ORE, GRAVEL, VOID_STONE,
} from '../../shared/blocks.js';
import { CHUNK_SIZE, CHUNK_HEIGHT, SEA_LEVEL } from '../../shared/protocol.js';

export class WorldGen {
  constructor(seed) {
    this.seed = seed;
    this.terrain  = new PerlinNoise(seed);
    this.biomeT   = new PerlinNoise(seed + 1000);
    this.biomeM   = new PerlinNoise(seed + 2000);
    this.cave     = new PerlinNoise(seed + 3000);
    this.ore      = new PerlinNoise(seed + 4000);
    this.tree     = new PerlinNoise(seed + 5000);
    this.detail   = new PerlinNoise(seed + 6000);
  }

  /**
   * Generate a full chunk of block data.
   * @param {number} cx chunk X
   * @param {number} cz chunk Z
   * @returns {Uint8Array} flat array [CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE]
   */
  generateChunk(cx, cz) {
    const blocks = new Uint8Array(CHUNK_SIZE * CHUNK_HEIGHT * CHUNK_SIZE);
    const heightMap = new Int32Array(CHUNK_SIZE * CHUNK_SIZE);
    const biomeMap = new Array(CHUNK_SIZE * CHUNK_SIZE);

    // Pass 1: compute height map and biomes
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const wx = cx * CHUNK_SIZE + lx;
        const wz = cz * CHUNK_SIZE + lz;

        const temp = this.biomeT.fbm(wx / 256, wz / 256, 3);
        const moist = this.biomeM.fbm(wx / 256, wz / 256, 3);
        const biomeId = selectBiome(temp, moist);
        const biome = BIOME_DATA[biomeId];

        const base = this.terrain.fbm(wx / 80, wz / 80, 5, 2, 0.45);
        const detail = this.detail.fbm(wx / 20, wz / 20, 2) * 0.15;
        const height = Math.floor(biome.heightBase + (base + detail) * biome.heightAmp);
        const clampedHeight = Math.max(1, Math.min(CHUNK_HEIGHT - 2, height));

        const idx = lx * CHUNK_SIZE + lz;
        heightMap[idx] = clampedHeight;
        biomeMap[idx] = biome;
      }
    }

    // Pass 2: fill blocks
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const mapIdx = lx * CHUNK_SIZE + lz;
        const height = heightMap[mapIdx];
        const biome = biomeMap[mapIdx];
        const wx = cx * CHUNK_SIZE + lx;
        const wz = cz * CHUNK_SIZE + lz;

        for (let y = 0; y < CHUNK_HEIGHT; y++) {
          const blockIdx = (y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
          let block = AIR;

          if (y === 0) {
            block = BEDROCK;
          } else if (y <= height) {
            if (y === height) {
              block = (height < SEA_LEVEL) ? biome.subsoil : biome.surface;
            } else if (y > height - 4) {
              block = biome.subsoil;
            } else {
              block = this._stoneOrOre(wx, y, wz);
            }

            // Caves (only below surface - 5)
            if (y > 1 && y < height - 5) {
              const caveVal = this.cave.fbm(wx / 30, y / 20 + wz / 30, 3);
              if (caveVal > 0.55) {
                block = AIR;
              }
            }
          } else if (y <= SEA_LEVEL) {
            block = WATER;
          }

          blocks[blockIdx] = block;
        }
      }
    }

    // Pass 3: trees
    for (let lx = 2; lx < CHUNK_SIZE - 2; lx++) {
      for (let lz = 2; lz < CHUNK_SIZE - 2; lz++) {
        const mapIdx = lx * CHUNK_SIZE + lz;
        const biome = biomeMap[mapIdx];
        const height = heightMap[mapIdx];

        if (height <= SEA_LEVEL || !biome.treeLog || biome.treeDensity === 0) continue;

        const wx = cx * CHUNK_SIZE + lx;
        const wz = cz * CHUNK_SIZE + lz;
        const treeNoise = Math.abs(this.tree.noise2D(wx * 0.8, wz * 0.8));

        if (treeNoise < biome.treeDensity * 50) {
          const treeH = biome.treeMinH +
            Math.floor(treeNoise * 100 % (biome.treeMaxH - biome.treeMinH + 1));
          this._placeTree(blocks, lx, height + 1, lz, treeH, biome.treeLog, biome.treeLeaf);
        }
      }
    }

    return blocks;
  }

  _stoneOrOre(x, y, z) {
    const oreVal = this.ore.noise2D(x / 8 + y * 0.1, z / 8 + y * 0.1);

    if (y < 8) {
      if (oreVal > 0.7) return DIAMOND_ORE;
      if (oreVal > 0.6) return MOLTIUM_ORE;
      if (oreVal < -0.6) return VOID_STONE;
    }
    if (y < 20) {
      if (oreVal > 0.65) return GOLD_ORE;
      if (oreVal < -0.65) return GRAVEL;
    }
    if (y < 40) {
      if (oreVal > 0.6) return IRON_ORE;
    }
    if (oreVal > 0.55) return COAL_ORE;

    return STONE;
  }

  _placeTree(blocks, lx, baseY, lz, height, logId, leafId) {
    if (baseY + height >= CHUNK_HEIGHT) return;

    const set = (x, y, z, id) => {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return;
      if (y < 0 || y >= CHUNK_HEIGHT) return;
      const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
      if (blocks[idx] === AIR) blocks[idx] = id;
    };

    // Trunk
    for (let dy = 0; dy < height; dy++) {
      set(lx, baseY + dy, lz, logId);
    }

    // Canopy (simple sphere-ish shape)
    const canopyStart = Math.floor(height * 0.5);
    const canopyRadius = Math.max(1, Math.floor(height / 3));
    for (let dy = canopyStart; dy <= height + 1; dy++) {
      const r = dy <= height ? canopyRadius : Math.max(0, canopyRadius - 1);
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0 && dy < height) continue; // trunk column
          if (dx * dx + dz * dz <= r * r + 1) {
            set(lx + dx, baseY + dy, lz + dz, leafId);
          }
        }
      }
    }
  }
}
