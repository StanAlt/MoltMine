/**
 * MoltWorld Block Registry v0
 *
 * Every block type in MoltWorld has an integer ID (0-255), a human name,
 * a base colour (used for vertex-colour rendering), and behaviour flags.
 *
 * Shared between server and client so the world is described identically
 * on both sides of the wire.
 */

// Behaviour flags
export const SOLID = 1 << 0;
export const TRANSPARENT = 1 << 1;
export const LIQUID = 1 << 2;
export const EMISSIVE = 1 << 3;
export const MINEABLE = 1 << 4;
export const PLACEABLE = 1 << 5;

/** @type {Map<number, {id:number, name:string, color:number, flags:number, drop?:number}>} */
export const BLOCKS = new Map();

function def(id, name, color, flags, drop) {
  const entry = { id, name, color, flags, drop: drop ?? id };
  BLOCKS.set(id, entry);
  return id;
}

// ── Core terrain ──────────────────────────────────────────────
export const AIR         = def(0,  'Air',           0x000000, 0);
export const STONE       = def(1,  'Stone',         0x808080, SOLID | MINEABLE | PLACEABLE);
export const DIRT        = def(2,  'Dirt',          0x8B6914, SOLID | MINEABLE | PLACEABLE);
export const GRASS       = def(3,  'Grass',         0x5D9B3A, SOLID | MINEABLE | PLACEABLE, 2); // drops dirt
export const SAND        = def(4,  'Sand',          0xE8D5A3, SOLID | MINEABLE | PLACEABLE);
export const WATER       = def(5,  'Water',         0x3366CC, LIQUID | TRANSPARENT);
export const BEDROCK     = def(6,  'Bedrock',       0x333333, SOLID);
export const GRAVEL      = def(7,  'Gravel',        0x9E9E9E, SOLID | MINEABLE | PLACEABLE);
export const SNOW        = def(8,  'Snow',          0xF0F0FF, SOLID | MINEABLE | PLACEABLE);
export const ICE         = def(9,  'Ice',           0xA5D8FF, SOLID | TRANSPARENT | MINEABLE | PLACEABLE);
export const SANDSTONE   = def(10, 'Sandstone',     0xD4B56A, SOLID | MINEABLE | PLACEABLE);

// ── Wood & vegetation ─────────────────────────────────────────
export const OAK_LOG     = def(11, 'Oak Log',       0x9C6B30, SOLID | MINEABLE | PLACEABLE);
export const OAK_LEAVES  = def(12, 'Oak Leaves',    0x3A8C27, SOLID | TRANSPARENT | MINEABLE);
export const BIRCH_LOG   = def(13, 'Birch Log',     0xD5C9A1, SOLID | MINEABLE | PLACEABLE);
export const BIRCH_LEAVES= def(14, 'Birch Leaves',  0x6DBF55, SOLID | TRANSPARENT | MINEABLE);
export const CACTUS      = def(15, 'Cactus',        0x2E8B30, SOLID | MINEABLE);

// ── MoltWorld specials ────────────────────────────────────────
export const CRYSTAL_LOG   = def(20, 'Crystal Trunk',  0x3A7D8C, SOLID | MINEABLE | PLACEABLE);
export const CRYSTAL_LEAVES= def(21, 'Crystal Leaves', 0x00E5FF, SOLID | TRANSPARENT | EMISSIVE | MINEABLE);
export const MOLTIUM_ORE   = def(22, 'Moltium Ore',   0x9B30FF, SOLID | EMISSIVE | MINEABLE | PLACEABLE);
export const MOLTEN_STONE  = def(23, 'Molten Stone',   0xFF4500, SOLID | EMISSIVE | MINEABLE | PLACEABLE);
export const VOID_STONE    = def(24, 'Void Stone',     0x1A1A2E, SOLID | MINEABLE | PLACEABLE);
export const BIO_MOSS      = def(25, 'Bio-Moss',       0x00FF88, SOLID | EMISSIVE | MINEABLE | PLACEABLE);
export const PRISM_GLASS   = def(26, 'Prism Glass',    0xE8E8FF, SOLID | TRANSPARENT | EMISSIVE | PLACEABLE);
export const RED_SAND      = def(27, 'Red Sand',       0xC85A3A, SOLID | MINEABLE | PLACEABLE);
export const TEAL_GRASS    = def(28, 'Teal Grass',     0x2E9E8C, SOLID | MINEABLE | PLACEABLE, 2);
export const PURPLE_GRASS  = def(29, 'Purple Grass',   0x7B4DAA, SOLID | MINEABLE | PLACEABLE, 2);
export const MUSHROOM_CAP  = def(30, 'Mushroom Cap',   0xCC3344, SOLID | MINEABLE);
export const MUSHROOM_STEM = def(31, 'Mushroom Stem',  0xEDE0C8, SOLID | MINEABLE);

// ── Ores ──────────────────────────────────────────────────────
export const COAL_ORE    = def(40, 'Coal Ore',      0x3B3B3B, SOLID | MINEABLE);
export const IRON_ORE    = def(41, 'Iron Ore',      0xC8A882, SOLID | MINEABLE);
export const GOLD_ORE    = def(42, 'Gold Ore',      0xFFD700, SOLID | MINEABLE);
export const DIAMOND_ORE = def(43, 'Diamond Ore',   0x55FFFF, SOLID | EMISSIVE | MINEABLE);

// ── Building blocks ───────────────────────────────────────────
export const OAK_PLANK   = def(50, 'Oak Plank',     0xBA8C50, SOLID | MINEABLE | PLACEABLE);
export const BRICK       = def(51, 'Brick',         0xB35A3A, SOLID | MINEABLE | PLACEABLE);
export const COBBLESTONE = def(52, 'Cobblestone',   0x6E6E6E, SOLID | MINEABLE | PLACEABLE);
export const GLASS       = def(53, 'Glass',         0xD4F1F9, SOLID | TRANSPARENT | PLACEABLE);
export const WOOL_WHITE  = def(54, 'White Wool',    0xF0F0F0, SOLID | MINEABLE | PLACEABLE);
export const WOOL_RED    = def(55, 'Red Wool',      0xCC3333, SOLID | MINEABLE | PLACEABLE);
export const WOOL_BLUE   = def(56, 'Blue Wool',     0x3333CC, SOLID | MINEABLE | PLACEABLE);
export const WOOL_GREEN  = def(57, 'Green Wool',    0x33CC33, SOLID | MINEABLE | PLACEABLE);
export const WOOL_YELLOW = def(58, 'Yellow Wool',   0xCCCC33, SOLID | MINEABLE | PLACEABLE);
export const WOOL_PURPLE = def(59, 'Purple Wool',   0x9933CC, SOLID | MINEABLE | PLACEABLE);
export const WOOL_ORANGE = def(60, 'Orange Wool',   0xCC8833, SOLID | MINEABLE | PLACEABLE);
export const WOOL_BLACK  = def(61, 'Black Wool',    0x222222, SOLID | MINEABLE | PLACEABLE);
export const CONCRETE_WHITE = def(62, 'White Concrete', 0xE8E8E8, SOLID | MINEABLE | PLACEABLE);
export const CONCRETE_GRAY  = def(63, 'Gray Concrete',  0x666666, SOLID | MINEABLE | PLACEABLE);

// ── Helper lookups ────────────────────────────────────────────

export function isSolid(id) { return !!(BLOCKS.get(id)?.flags & SOLID); }
export function isTransparent(id) { return !!(BLOCKS.get(id)?.flags & TRANSPARENT); }
export function isLiquid(id) { return !!(BLOCKS.get(id)?.flags & LIQUID); }
export function isEmissive(id) { return !!(BLOCKS.get(id)?.flags & EMISSIVE); }
export function isMineable(id) { return !!(BLOCKS.get(id)?.flags & MINEABLE); }
export function isPlaceable(id) { return !!(BLOCKS.get(id)?.flags & PLACEABLE); }

export function blockColor(id) { return BLOCKS.get(id)?.color ?? 0xFF00FF; }
export function blockName(id) { return BLOCKS.get(id)?.name ?? 'Unknown'; }

/** IDs of blocks that can be placed by a player (for hotbar / inventory). */
export const PLACEABLE_BLOCKS = [...BLOCKS.values()]
  .filter(b => b.flags & PLACEABLE)
  .map(b => b.id);

/** Default hotbar for new players. */
export const DEFAULT_HOTBAR = [
  STONE, DIRT, OAK_PLANK, COBBLESTONE, BRICK, GLASS,
  MOLTIUM_ORE, CRYSTAL_LEAVES, PRISM_GLASS,
];
