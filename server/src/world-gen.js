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
  RED_FLOWER, YELLOW_FLOWER, BLUE_FLOWER, TALL_GRASS, FERN, DEAD_BUSH,
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
    const biomeIdMap = new Array(CHUNK_SIZE * CHUNK_SIZE);

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
        biomeIdMap[idx] = biomeId;
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
          this._placeTree(blocks, lx, height + 1, lz, treeH, biome.treeLog, biome.treeLeaf, biomeIdMap[mapIdx]);
        }
      }
    }

    // Pass 4: vegetation (flowers, grass, ferns)
    for (let lx = 0; lx < CHUNK_SIZE; lx++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        const mapIdx = lx * CHUNK_SIZE + lz;
        const biome = biomeMap[mapIdx];
        const bId = biomeIdMap[mapIdx];
        const height = heightMap[mapIdx];

        if (height <= SEA_LEVEL) continue;

        const wx = cx * CHUNK_SIZE + lx;
        const wz = cz * CHUNK_SIZE + lz;
        const vegY = height + 1;
        if (vegY >= CHUNK_HEIGHT) continue;

        // Check the spot is air (not already occupied by a tree trunk)
        const blockIdx = (vegY * CHUNK_SIZE + lz) * CHUNK_SIZE + lx;
        if (blocks[blockIdx] !== AIR) continue;

        const vegNoise = this.detail.noise2D(wx * 2.3, wz * 2.3);
        const vegNoise2 = this.detail.noise2D(wx * 0.5 + 500, wz * 0.5 + 500);

        let vegBlock = null;

        if (bId === 'verdant_plains') {
          if (vegNoise > 0.55) vegBlock = TALL_GRASS;
          else if (vegNoise > 0.45 && vegNoise2 > 0.3) vegBlock = RED_FLOWER;
          else if (vegNoise > 0.42 && vegNoise2 < -0.3) vegBlock = YELLOW_FLOWER;
        } else if (bId === 'crystal_forest') {
          if (vegNoise > 0.5) vegBlock = FERN;
          else if (vegNoise > 0.45 && vegNoise2 > 0.2) vegBlock = BLUE_FLOWER;
        } else if (bId === 'mushroom_glades') {
          if (vegNoise > 0.5) vegBlock = TALL_GRASS;
          else if (vegNoise > 0.43 && vegNoise2 > 0.2) vegBlock = BLUE_FLOWER;
          else if (vegNoise > 0.40 && vegNoise2 < -0.2) vegBlock = RED_FLOWER;
        } else if (bId === 'frost_peaks') {
          if (vegNoise > 0.6 && height < 40) vegBlock = DEAD_BUSH;
        } else if (bId === 'molten_badlands') {
          if (vegNoise > 0.65) vegBlock = DEAD_BUSH;
        } else if (bId === 'azure_coast') {
          if (vegNoise > 0.55) vegBlock = TALL_GRASS;
          else if (vegNoise > 0.48 && vegNoise2 > 0.3) vegBlock = YELLOW_FLOWER;
        }

        if (vegBlock !== null) {
          blocks[blockIdx] = vegBlock;
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

  _placeTree(blocks, lx, baseY, lz, height, logId, leafId, biomeId) {
    if (baseY + height >= CHUNK_HEIGHT) return;

    const set = (x, y, z, id) => {
      if (x < 0 || x >= CHUNK_SIZE || z < 0 || z >= CHUNK_SIZE) return;
      if (y < 0 || y >= CHUNK_HEIGHT) return;
      const idx = (y * CHUNK_SIZE + z) * CHUNK_SIZE + x;
      if (blocks[idx] === AIR) blocks[idx] = id;
    };

    if (biomeId === 'frost_peaks') {
      this._treePine(set, lx, baseY, lz, height, logId, leafId);
    } else if (biomeId === 'azure_coast') {
      this._treePalm(set, lx, baseY, lz, height, logId, leafId);
    } else if (biomeId === 'mushroom_glades') {
      this._treeMushroom(set, lx, baseY, lz, height, logId, leafId);
    } else if (biomeId === 'crystal_forest') {
      this._treeCrystal(set, lx, baseY, lz, height, logId, leafId);
    } else {
      this._treeOak(set, lx, baseY, lz, height, logId, leafId);
    }
  }

  // ── Tree shapes ──────────────────────────────────────────

  // Spreading oak with branches and wide irregular canopy
  _treeOak(set, lx, baseY, lz, height, logId, leafId) {
    for (let dy = 0; dy < height; dy++) {
      set(lx, baseY + dy, lz, logId);
    }
    // Branch stubs
    if (height >= 5) {
      const bY = baseY + Math.floor(height * 0.6);
      set(lx + 1, bY, lz, logId);
      set(lx - 1, bY + 1, lz, logId);
      set(lx, bY, lz + 1, logId);
    }
    // Wide canopy with irregular edges
    const cStart = Math.floor(height * 0.4);
    const cR = Math.max(2, Math.floor(height / 2.5));
    for (let dy = cStart; dy <= height + 2; dy++) {
      const prog = (dy - cStart) / (height + 2 - cStart);
      const r = prog < 0.7 ? cR : Math.max(1, cR - 1);
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0 && dy < height) continue;
          const d2 = dx * dx + dz * dz;
          if (d2 <= r * r && (d2 < (r - 1) * (r - 1) || ((dx + dz + dy) & 1))) {
            set(lx + dx, baseY + dy, lz + dz, leafId);
          }
        }
      }
    }
  }

  // Conical pine — tall narrow cone shape
  _treePine(set, lx, baseY, lz, height, logId, leafId) {
    for (let dy = 0; dy < height; dy++) {
      set(lx, baseY + dy, lz, logId);
    }
    const coneStart = Math.max(2, Math.floor(height * 0.25));
    for (let dy = coneStart; dy <= height + 1; dy++) {
      const prog = (dy - coneStart) / (height + 1 - coneStart);
      const r = Math.max(0, Math.floor((1 - prog) * (height / 2.5)));
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0 && dy < height) continue;
          if (Math.abs(dx) + Math.abs(dz) <= r + 1) {
            set(lx + dx, baseY + dy, lz + dz, leafId);
          }
        }
      }
    }
    set(lx, baseY + height + 1, lz, leafId);
  }

  // Palm — tall bare trunk with frond cluster at top
  _treePalm(set, lx, baseY, lz, height, logId, leafId) {
    for (let dy = 0; dy < height; dy++) {
      set(lx, baseY + dy, lz, logId);
    }
    const top = baseY + height;
    set(lx, top, lz, leafId);
    set(lx, top + 1, lz, leafId);
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]];
    for (const [dx, dz] of dirs) {
      set(lx + dx, top, lz + dz, leafId);
      set(lx + dx * 2, top, lz + dz * 2, leafId);
      set(lx + dx * 2, top - 1, lz + dz * 2, leafId);
      set(lx + dx * 3, top - 1, lz + dz * 3, leafId);
      set(lx + dx * 3, top - 2, lz + dz * 3, leafId);
    }
  }

  // Giant mushroom — thick stem with wide cap
  _treeMushroom(set, lx, baseY, lz, height, logId, leafId) {
    for (let dy = 0; dy < height; dy++) {
      set(lx, baseY + dy, lz, logId);
      if (dy < height * 0.5) {
        set(lx + 1, baseY + dy, lz, logId);
        set(lx, baseY + dy, lz + 1, logId);
      }
    }
    const capR = Math.max(2, Math.floor(height / 2) + 1);
    for (let dx = -capR; dx <= capR; dx++) {
      for (let dz = -capR; dz <= capR; dz++) {
        const d2 = dx * dx + dz * dz;
        if (d2 <= capR * capR + 1) {
          set(lx + dx, baseY + height, lz + dz, leafId);
          if (d2 <= (capR - 1) * (capR - 1)) {
            set(lx + dx, baseY + height - 1, lz + dz, leafId);
            set(lx + dx, baseY + height + 1, lz + dz, leafId);
          }
        }
      }
    }
  }

  // Crystal spire — angular branches with glowing tips
  _treeCrystal(set, lx, baseY, lz, height, logId, leafId) {
    for (let dy = 0; dy < height; dy++) {
      set(lx, baseY + dy, lz, logId);
    }
    const branchH = Math.floor(height * 0.4);
    const spikeDirs = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let i = 0; i < 4; i++) {
      const [dx, dz] = spikeDirs[i];
      const dy = branchH + i;
      for (let len = 1; len <= 2; len++) {
        set(lx + dx * len, baseY + dy + len, lz + dz * len, leafId);
      }
    }
    for (let dy = Math.floor(height * 0.6); dy <= height + 2; dy++) {
      const r = dy <= height ? 2 : 1;
      for (let dx = -r; dx <= r; dx++) {
        for (let dz = -r; dz <= r; dz++) {
          if (dx === 0 && dz === 0 && dy < height) continue;
          if (Math.abs(dx) + Math.abs(dz) <= r) {
            set(lx + dx, baseY + dy, lz + dz, leafId);
          }
        }
      }
    }
  }
}
