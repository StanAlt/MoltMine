/**
 * Procedural texture atlas for Minecraft-like block rendering.
 *
 * Generates a canvas-based texture atlas where each block face gets a
 * 16x16 pixel tile with grayscale detail patterns. These multiply with
 * vertex colors to produce textured blocks that retain the game's color
 * palette while looking much more realistic.
 *
 * Block faces can have different textures (e.g. grass top vs grass side).
 */

import * as THREE from 'three';
import { BLOCKS } from '@shared/blocks.js';

const TILE_SIZE = 16;
const ATLAS_COLS = 16;  // 16 tiles per row
const ATLAS_ROWS = 16;  // up to 256 tiles

// Tile IDs — each unique face pattern gets an ID
export const TILE = {
  STONE: 0,
  DIRT: 1,
  GRASS_TOP: 2,
  GRASS_SIDE: 3,
  SAND: 4,
  GRAVEL: 5,
  SNOW: 6,
  ICE: 7,
  SANDSTONE_TOP: 8,
  SANDSTONE_SIDE: 9,
  LOG_TOP: 10,
  LOG_SIDE: 11,
  LEAVES: 12,
  BIRCH_LOG_SIDE: 13,
  CACTUS_SIDE: 14,
  CACTUS_TOP: 15,
  CRYSTAL_LOG_SIDE: 16,
  CRYSTAL_LEAVES: 17,
  ORE_STONE: 18,     // stone base with colored spots (vertex color tints)
  MOLTEN: 19,
  VOID_STONE: 20,
  BIO_MOSS: 21,
  GLASS: 22,
  PLANKS: 23,
  BRICK: 24,
  COBBLESTONE: 25,
  WOOL: 26,
  CONCRETE: 27,
  RED_SAND: 28,
  MUSHROOM_CAP: 29,
  MUSHROOM_STEM: 30,
  BEDROCK: 31,
  PRISM_GLASS: 32,
  DEFAULT: 33,        // flat white (pure vertex color)
  TEAL_GRASS_TOP: 34,
  PURPLE_GRASS_TOP: 35,
};

/**
 * Maps (blockId, face) → tile index.
 * face: 'py' (top), 'ny' (bottom), or 'side' (px/nx/pz/nz)
 */
const BLOCK_FACE_MAP = new Map();

function mapBlock(blockId, top, side, bottom) {
  BLOCK_FACE_MAP.set(blockId, { top: top ?? TILE.DEFAULT, side: side ?? top ?? TILE.DEFAULT, bottom: bottom ?? side ?? top ?? TILE.DEFAULT });
}

// Core terrain
mapBlock(1,  TILE.STONE, TILE.STONE, TILE.STONE);           // Stone
mapBlock(2,  TILE.DIRT, TILE.DIRT, TILE.DIRT);               // Dirt
mapBlock(3,  TILE.GRASS_TOP, TILE.GRASS_SIDE, TILE.DIRT);    // Grass
mapBlock(4,  TILE.SAND, TILE.SAND, TILE.SAND);              // Sand
mapBlock(6,  TILE.BEDROCK, TILE.BEDROCK, TILE.BEDROCK);      // Bedrock
mapBlock(7,  TILE.GRAVEL, TILE.GRAVEL, TILE.GRAVEL);        // Gravel
mapBlock(8,  TILE.SNOW, TILE.SNOW, TILE.SNOW);              // Snow
mapBlock(9,  TILE.ICE, TILE.ICE, TILE.ICE);                 // Ice
mapBlock(10, TILE.SANDSTONE_TOP, TILE.SANDSTONE_SIDE, TILE.SANDSTONE_TOP); // Sandstone

// Wood & vegetation
mapBlock(11, TILE.LOG_TOP, TILE.LOG_SIDE, TILE.LOG_TOP);    // Oak Log
mapBlock(12, TILE.LEAVES, TILE.LEAVES, TILE.LEAVES);        // Oak Leaves
mapBlock(13, TILE.LOG_TOP, TILE.BIRCH_LOG_SIDE, TILE.LOG_TOP); // Birch Log
mapBlock(14, TILE.LEAVES, TILE.LEAVES, TILE.LEAVES);        // Birch Leaves
mapBlock(15, TILE.CACTUS_TOP, TILE.CACTUS_SIDE, TILE.CACTUS_TOP); // Cactus

// MoltWorld specials
mapBlock(20, TILE.LOG_TOP, TILE.CRYSTAL_LOG_SIDE, TILE.LOG_TOP);  // Crystal Trunk
mapBlock(21, TILE.CRYSTAL_LEAVES, TILE.CRYSTAL_LEAVES, TILE.CRYSTAL_LEAVES); // Crystal Leaves
mapBlock(22, TILE.ORE_STONE, TILE.ORE_STONE, TILE.ORE_STONE);     // Moltium Ore
mapBlock(23, TILE.MOLTEN, TILE.MOLTEN, TILE.MOLTEN);               // Molten Stone
mapBlock(24, TILE.VOID_STONE, TILE.VOID_STONE, TILE.VOID_STONE);  // Void Stone
mapBlock(25, TILE.BIO_MOSS, TILE.BIO_MOSS, TILE.BIO_MOSS);        // Bio-Moss
mapBlock(26, TILE.PRISM_GLASS, TILE.PRISM_GLASS, TILE.PRISM_GLASS); // Prism Glass
mapBlock(27, TILE.RED_SAND, TILE.RED_SAND, TILE.RED_SAND);         // Red Sand
mapBlock(28, TILE.TEAL_GRASS_TOP, TILE.GRASS_SIDE, TILE.DIRT);     // Teal Grass
mapBlock(29, TILE.PURPLE_GRASS_TOP, TILE.GRASS_SIDE, TILE.DIRT);   // Purple Grass
mapBlock(30, TILE.MUSHROOM_CAP, TILE.MUSHROOM_CAP, TILE.MUSHROOM_CAP); // Mushroom Cap
mapBlock(31, TILE.MUSHROOM_STEM, TILE.MUSHROOM_STEM, TILE.MUSHROOM_STEM); // Mushroom Stem

// Ores
mapBlock(40, TILE.ORE_STONE, TILE.ORE_STONE, TILE.ORE_STONE); // Coal Ore
mapBlock(41, TILE.ORE_STONE, TILE.ORE_STONE, TILE.ORE_STONE); // Iron Ore
mapBlock(42, TILE.ORE_STONE, TILE.ORE_STONE, TILE.ORE_STONE); // Gold Ore
mapBlock(43, TILE.ORE_STONE, TILE.ORE_STONE, TILE.ORE_STONE); // Diamond Ore

// Building
mapBlock(50, TILE.PLANKS, TILE.PLANKS, TILE.PLANKS);        // Oak Plank
mapBlock(51, TILE.BRICK, TILE.BRICK, TILE.BRICK);           // Brick
mapBlock(52, TILE.COBBLESTONE, TILE.COBBLESTONE, TILE.COBBLESTONE); // Cobblestone
mapBlock(53, TILE.GLASS, TILE.GLASS, TILE.GLASS);           // Glass
mapBlock(54, TILE.WOOL, TILE.WOOL, TILE.WOOL);              // White Wool
mapBlock(55, TILE.WOOL, TILE.WOOL, TILE.WOOL);              // Red Wool
mapBlock(56, TILE.WOOL, TILE.WOOL, TILE.WOOL);              // Blue Wool
mapBlock(57, TILE.WOOL, TILE.WOOL, TILE.WOOL);              // Green Wool
mapBlock(58, TILE.WOOL, TILE.WOOL, TILE.WOOL);              // Yellow Wool
mapBlock(59, TILE.WOOL, TILE.WOOL, TILE.WOOL);              // Purple Wool
mapBlock(60, TILE.WOOL, TILE.WOOL, TILE.WOOL);              // Orange Wool
mapBlock(61, TILE.WOOL, TILE.WOOL, TILE.WOOL);              // Black Wool
mapBlock(62, TILE.CONCRETE, TILE.CONCRETE, TILE.CONCRETE);  // White Concrete
mapBlock(63, TILE.CONCRETE, TILE.CONCRETE, TILE.CONCRETE);  // Gray Concrete

/**
 * Get the tile index for a block face.
 * @param {number} blockId
 * @param {string} face - 'py', 'ny', 'px', 'nx', 'pz', 'nz'
 * @returns {number} tile index in the atlas
 */
export function getTileForFace(blockId, face) {
  const mapping = BLOCK_FACE_MAP.get(blockId);
  if (!mapping) return TILE.DEFAULT;
  if (face === 'py') return mapping.top;
  if (face === 'ny') return mapping.bottom;
  return mapping.side;
}

/**
 * Convert a tile index to UV coordinates in the atlas.
 * @param {number} tileIdx
 * @returns {{ u: number, v: number, uSize: number, vSize: number }}
 */
export function tileUV(tileIdx) {
  const col = tileIdx % ATLAS_COLS;
  const row = Math.floor(tileIdx / ATLAS_COLS);
  const uSize = 1 / ATLAS_COLS;
  const vSize = 1 / ATLAS_ROWS;
  return {
    u: col * uSize,
    v: 1 - (row + 1) * vSize,  // flip Y for UV
    uSize,
    vSize,
  };
}

/**
 * Generate the texture atlas canvas.
 * Each tile is a 16x16 grayscale pattern that multiplies with vertex colors.
 * Brighter = more vertex color shows through.
 */
export function createTextureAtlas() {
  const width = TILE_SIZE * ATLAS_COLS;
  const height = TILE_SIZE * ATLAS_ROWS;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  // Fill with white (default = pure vertex color)
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);

  // Draw each tile
  _drawTile(ctx, TILE.STONE, _stonePattern);
  _drawTile(ctx, TILE.DIRT, _dirtPattern);
  _drawTile(ctx, TILE.GRASS_TOP, _grassTopPattern);
  _drawTile(ctx, TILE.GRASS_SIDE, _grassSidePattern);
  _drawTile(ctx, TILE.SAND, _sandPattern);
  _drawTile(ctx, TILE.GRAVEL, _gravelPattern);
  _drawTile(ctx, TILE.SNOW, _snowPattern);
  _drawTile(ctx, TILE.ICE, _icePattern);
  _drawTile(ctx, TILE.SANDSTONE_TOP, _sandstoneTopPattern);
  _drawTile(ctx, TILE.SANDSTONE_SIDE, _sandstoneSidePattern);
  _drawTile(ctx, TILE.LOG_TOP, _logTopPattern);
  _drawTile(ctx, TILE.LOG_SIDE, _logSidePattern);
  _drawTile(ctx, TILE.LEAVES, _leavesPattern);
  _drawTile(ctx, TILE.BIRCH_LOG_SIDE, _birchLogSidePattern);
  _drawTile(ctx, TILE.CACTUS_SIDE, _cactusSidePattern);
  _drawTile(ctx, TILE.CACTUS_TOP, _cactusTopPattern);
  _drawTile(ctx, TILE.CRYSTAL_LOG_SIDE, _crystalLogSidePattern);
  _drawTile(ctx, TILE.CRYSTAL_LEAVES, _crystalLeavesPattern);
  _drawTile(ctx, TILE.ORE_STONE, _oreStonePattern);
  _drawTile(ctx, TILE.MOLTEN, _moltenPattern);
  _drawTile(ctx, TILE.VOID_STONE, _voidStonePattern);
  _drawTile(ctx, TILE.BIO_MOSS, _bioMossPattern);
  _drawTile(ctx, TILE.GLASS, _glassPattern);
  _drawTile(ctx, TILE.PLANKS, _planksPattern);
  _drawTile(ctx, TILE.BRICK, _brickPattern);
  _drawTile(ctx, TILE.COBBLESTONE, _cobblestonePattern);
  _drawTile(ctx, TILE.WOOL, _woolPattern);
  _drawTile(ctx, TILE.CONCRETE, _concretePattern);
  _drawTile(ctx, TILE.RED_SAND, _redSandPattern);
  _drawTile(ctx, TILE.MUSHROOM_CAP, _mushroomCapPattern);
  _drawTile(ctx, TILE.MUSHROOM_STEM, _mushroomStemPattern);
  _drawTile(ctx, TILE.BEDROCK, _bedrockPattern);
  _drawTile(ctx, TILE.PRISM_GLASS, _prismGlassPattern);
  _drawTile(ctx, TILE.TEAL_GRASS_TOP, _grassTopPattern);
  _drawTile(ctx, TILE.PURPLE_GRASS_TOP, _grassTopPattern);

  // Create Three.js texture
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;

  return texture;
}

// ── Tile drawing helpers ──────────────────────────────────

function _drawTile(ctx, tileIdx, patternFn) {
  const col = tileIdx % ATLAS_COLS;
  const row = Math.floor(tileIdx / ATLAS_COLS);
  const x0 = col * TILE_SIZE;
  const y0 = row * TILE_SIZE;

  const imageData = ctx.createImageData(TILE_SIZE, TILE_SIZE);
  patternFn(imageData.data);
  ctx.putImageData(imageData, x0, y0);
}

// Simple seeded random for reproducible patterns
function _hash(x, y) {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

function _setPixel(data, x, y, r, g, b) {
  const i = (y * TILE_SIZE + x) * 4;
  data[i] = r;
  data[i + 1] = g;
  data[i + 2] = b;
  data[i + 3] = 255;
}

function _fillGray(data, base, variance) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const v = Math.max(0, Math.min(255, base + (_hash(x, y) - 0.5) * variance));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

// ── Pattern generators (grayscale) ──────────────────────────

function _stonePattern(data) {
  // Rocky noise with cracks
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 180 + (_hash(x, y) - 0.5) * 60;
      // Darker cracks
      if (_hash(x * 3 + 7, y * 3 + 11) < 0.08) v -= 50;
      if (_hash(x + 13, y + 23) < 0.05) v -= 40;
      v = Math.max(120, Math.min(240, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _dirtPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 190 + (_hash(x + 5, y + 3) - 0.5) * 80;
      // Speckles
      if (_hash(x * 7, y * 7) < 0.12) v -= 40;
      if (_hash(x * 11, y * 11) < 0.08) v += 30;
      v = Math.max(130, Math.min(240, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _grassTopPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 200 + (_hash(x + 1, y + 2) - 0.5) * 70;
      // Grass blades
      if (_hash(x * 5, y * 5) < 0.15) v += 35;
      if (_hash(x * 3 + 1, y * 3 + 7) < 0.1) v -= 30;
      v = Math.max(140, Math.min(255, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _grassSidePattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if (y < 4) {
        // Green top strip
        let v = 210 + (_hash(x + 1, y + 2) - 0.5) * 50;
        if (y === 3 && _hash(x, y) < 0.4) v = 170 + _hash(x, y + 10) * 40; // jagged edge
        v = Math.max(160, Math.min(255, v));
        _setPixel(data, x, y, v, v, v);
      } else {
        // Dirt bottom
        let v = 185 + (_hash(x + 5, y + 3) - 0.5) * 70;
        if (_hash(x * 7, y * 7) < 0.1) v -= 35;
        v = Math.max(130, Math.min(230, v));
        _setPixel(data, x, y, v, v, v);
      }
    }
  }
}

function _sandPattern(data) {
  _fillGray(data, 225, 40);
  // Sand grains
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      if (_hash(x * 13, y * 13) < 0.06) {
        const i = (y * TILE_SIZE + x) * 4;
        data[i] = Math.min(255, data[i] + 25);
        data[i + 1] = Math.min(255, data[i + 1] + 25);
        data[i + 2] = Math.min(255, data[i + 2] + 25);
      }
    }
  }
}

function _gravelPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      // Chunky rocks
      const h = _hash(Math.floor(x / 3), Math.floor(y / 3));
      let v = 160 + h * 80;
      v += (_hash(x, y) - 0.5) * 30;
      v = Math.max(120, Math.min(240, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _snowPattern(data) {
  _fillGray(data, 245, 15);
}

function _icePattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 220 + (_hash(x, y) - 0.5) * 30;
      // Crack lines
      if ((x + y) % 7 === 0 && _hash(x + 3, y + 5) < 0.3) v -= 40;
      v = Math.max(170, Math.min(255, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _sandstoneTopPattern(data) {
  _fillGray(data, 215, 30);
}

function _sandstoneSidePattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      // Horizontal layers
      let v = 210 + (_hash(x, y) - 0.5) * 25;
      if (y % 4 === 0) v -= 20; // layer lines
      v = Math.max(160, Math.min(245, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _logTopPattern(data) {
  // Tree rings
  const cx = 7.5, cy = 7.5;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      const ring = Math.sin(dist * 2.0) * 0.5 + 0.5;
      let v = 170 + ring * 60 + (_hash(x, y) - 0.5) * 20;
      v = Math.max(140, Math.min(240, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _logSidePattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      // Vertical wood grain
      let v = 185 + Math.sin(x * 1.2 + _hash(0, y) * 3) * 25;
      v += (_hash(x, y) - 0.5) * 20;
      // Bark lines
      if (_hash(x * 2, y) < 0.06) v -= 35;
      v = Math.max(130, Math.min(230, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _leavesPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 190 + (_hash(x, y) - 0.5) * 80;
      // Leaf clusters
      if (_hash(x * 3, y * 3) < 0.25) v += 40;
      if (_hash(x * 5, y * 5) < 0.15) v -= 45;
      v = Math.max(100, Math.min(255, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _birchLogSidePattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 230 + (_hash(x, y) - 0.5) * 20;
      // Birch dark patches
      if (_hash(Math.floor(x / 3), Math.floor(y / 2)) < 0.15) v -= 80;
      v = Math.max(120, Math.min(250, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _cactusSidePattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 200 + (_hash(x, y) - 0.5) * 30;
      // Vertical ridges
      if (x % 4 === 0) v -= 25;
      // Spines
      if (x % 4 === 0 && y % 3 === 0) v += 50;
      v = Math.max(140, Math.min(255, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _cactusTopPattern(data) {
  const cx = 7.5, cy = 7.5;
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2);
      let v = dist < 5 ? 210 : 170;
      v += (_hash(x, y) - 0.5) * 25;
      v = Math.max(140, Math.min(240, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _crystalLogSidePattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 180 + (_hash(x, y) - 0.5) * 30;
      // Crystal facet lines
      if ((x + y) % 5 === 0) v += 40;
      if ((x - y + 16) % 7 === 0) v += 30;
      v = Math.max(150, Math.min(255, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _crystalLeavesPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 200 + (_hash(x, y) - 0.5) * 50;
      // Sparkle points
      if (_hash(x * 7, y * 7) < 0.08) v = 255;
      v = Math.max(150, Math.min(255, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _oreStonePattern(data) {
  // Stone base with ore deposit spots
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 175 + (_hash(x, y) - 0.5) * 50;
      if (_hash(x * 3 + 7, y * 3 + 11) < 0.07) v -= 45;
      // Ore spots — brighter (vertex color will tint them)
      const oreHash = _hash(Math.floor(x / 2) + 99, Math.floor(y / 2) + 77);
      if (oreHash < 0.15) v = 240 + (_hash(x + 33, y + 44) - 0.5) * 20;
      v = Math.max(110, Math.min(255, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _moltenPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 210 + (_hash(x, y) - 0.5) * 50;
      // Lava flow lines
      const flow = Math.sin(y * 0.8 + _hash(x, 0) * 4) * 25;
      v += flow;
      // Hot spots
      if (_hash(x * 5, y * 5) < 0.1) v = 255;
      v = Math.max(160, Math.min(255, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _voidStonePattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 150 + (_hash(x, y) - 0.5) * 40;
      // Void swirl
      if ((x + y) % 8 < 2) v -= 30;
      v = Math.max(100, Math.min(200, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _bioMossPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 200 + (_hash(x, y) - 0.5) * 60;
      // Organic bumps
      if (_hash(x * 3, y * 3) < 0.2) v += 35;
      // Glow spots
      if (_hash(x * 11, y * 11) < 0.06) v = 255;
      v = Math.max(140, Math.min(255, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _glassPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 240;
      // Border frame
      if (x === 0 || x === 15 || y === 0 || y === 15) v = 200;
      if (x === 1 || x === 14 || y === 1 || y === 14) v = 220;
      // Subtle reflection
      if (_hash(x, y) < 0.03) v = 255;
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _planksPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 200 + (_hash(x, y) - 0.5) * 25;
      // Horizontal plank lines
      if (y % 4 === 0) v -= 30;
      // Wood grain
      v += Math.sin(x * 0.8 + _hash(0, Math.floor(y / 4)) * 8) * 10;
      // Nail marks
      if (y % 4 === 2 && (x === 3 || x === 11)) v -= 40;
      v = Math.max(140, Math.min(240, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _brickPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const row = Math.floor(y / 4);
      const offset = (row % 2) * 8;
      const bx = (x + offset) % 16;

      let v = 200 + (_hash(x + row * 17, y) - 0.5) * 30;
      // Mortar lines
      if (y % 4 === 0) v = 160 + (_hash(x, y) - 0.5) * 15;
      if (bx === 0 || bx === 15) v = 160 + (_hash(x, y) - 0.5) * 15;
      v = Math.max(130, Math.min(235, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _cobblestonePattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      // Irregular stone chunks
      const cx = Math.floor(x / 4) + Math.floor(y / 4) * 4;
      const h = _hash(cx, cx * 3 + 7);
      let v = 155 + h * 70 + (_hash(x, y) - 0.5) * 25;
      // Dark gaps between stones
      if (x % 4 === 0 || y % 4 === 0) {
        if (_hash(x + 1, y + 1) < 0.5) v -= 35;
      }
      v = Math.max(100, Math.min(230, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _woolPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 220 + (_hash(x, y) - 0.5) * 30;
      // Fluffy texture
      if (_hash(x * 3, y * 3) < 0.2) v += 15;
      if (_hash(x * 5, y * 5) < 0.15) v -= 15;
      v = Math.max(190, Math.min(255, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _concretePattern(data) {
  _fillGray(data, 220, 15);
}

function _redSandPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 215 + (_hash(x + 20, y + 30) - 0.5) * 45;
      if (_hash(x * 9, y * 9) < 0.05) v += 20;
      v = Math.max(170, Math.min(255, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _mushroomCapPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 210 + (_hash(x, y) - 0.5) * 30;
      // Spots
      const dist1 = Math.sqrt((x - 5) ** 2 + (y - 5) ** 2);
      const dist2 = Math.sqrt((x - 12) ** 2 + (y - 10) ** 2);
      if (dist1 < 3 || dist2 < 2) v = 245;
      v = Math.max(170, Math.min(255, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _mushroomStemPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 230 + (_hash(x, y) - 0.5) * 20;
      // Vertical fibers
      if (x % 3 === 0) v -= 10;
      v = Math.max(200, Math.min(250, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _bedrockPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      const h = _hash(Math.floor(x / 2), Math.floor(y / 2));
      let v = 130 + h * 60 + (_hash(x, y) - 0.5) * 30;
      v = Math.max(80, Math.min(200, v));
      _setPixel(data, x, y, v, v, v);
    }
  }
}

function _prismGlassPattern(data) {
  for (let y = 0; y < TILE_SIZE; y++) {
    for (let x = 0; x < TILE_SIZE; x++) {
      let v = 235;
      // Frame
      if (x === 0 || x === 15 || y === 0 || y === 15) v = 210;
      // Rainbow refraction lines
      if ((x + y) % 5 === 0) v = 255;
      if ((x - y + 16) % 7 === 0) v = 250;
      _setPixel(data, x, y, v, v, v);
    }
  }
}
