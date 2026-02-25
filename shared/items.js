/**
 * Item definitions for BotCraft.
 *
 * 120+ items across 6 categories with 5 rarity tiers.
 * Items can be found in the world, picked up, equipped, dropped, and traded.
 */

// ── Rarity tiers ─────────────────────────────────────────────
export const RARITY = {
  COMMON:    0,  // white  — ~45% spawn weight
  UNCOMMON:  1,  // green  — ~25%
  RARE:      2,  // blue   — ~15%
  EPIC:      3,  // purple — ~10%
  LEGENDARY: 4,  // gold   — ~5%
};

export const RARITY_NAMES  = ['Common', 'Uncommon', 'Rare', 'Epic', 'Legendary'];
export const RARITY_COLORS = [0xAAAAAA, 0x55FF55, 0x5555FF, 0xAA55FF, 0xFFAA00];
export const RARITY_WEIGHTS = [45, 25, 15, 10, 5];

// ── Equipment slots ──────────────────────────────────────────
export const SLOT = {
  HEAD:      'head',
  BODY:      'body',
  LEGS:      'legs',
  FEET:      'feet',
  MAIN_HAND: 'mainHand',
  OFF_HAND:  'offHand',
};

// ── Categories ───────────────────────────────────────────────
export const CATEGORY = {
  HAT:       'hat',
  BODY:      'body',
  LEGS:      'legs',
  FEET:      'feet',
  WEAPON:    'weapon',
  SHIELD:    'shield',
  ACCESSORY: 'accessory',
};

const CATEGORY_SLOT = {
  hat:       SLOT.HEAD,
  body:      SLOT.BODY,
  legs:      SLOT.LEGS,
  feet:      SLOT.FEET,
  weapon:    SLOT.MAIN_HAND,
  shield:    SLOT.OFF_HAND,
  accessory: SLOT.OFF_HAND,
};

// ── Item database ────────────────────────────────────────────
// Each item: { id, name, category, rarity, color, description }

const ITEMS_RAW = [
  // ═══ HATS ═══════════════════════════════════════════════════
  // Common
  { name: 'Straw Hat',           category: 'hat', rarity: 0, color: 0xDDCC77, desc: 'A simple farmer\'s hat' },
  { name: 'Wool Beanie',         category: 'hat', rarity: 0, color: 0x884444, desc: 'Cozy and warm' },
  { name: 'Brown Cap',           category: 'hat', rarity: 0, color: 0x664422, desc: 'A plain brown cap' },
  { name: 'Gray Bandana',        category: 'hat', rarity: 0, color: 0x888888, desc: 'Tied around the head' },
  { name: 'Paper Hat',           category: 'hat', rarity: 0, color: 0xEEEEDD, desc: 'Folded from paper' },
  // Uncommon
  { name: 'Red Beret',           category: 'hat', rarity: 1, color: 0xCC2222, desc: 'Very artsy' },
  { name: 'Blue Fedora',         category: 'hat', rarity: 1, color: 0x2244AA, desc: 'Tips hat' },
  { name: 'Green Ranger Hat',    category: 'hat', rarity: 1, color: 0x228833, desc: 'For forest patrols' },
  { name: 'Mining Helmet',       category: 'hat', rarity: 1, color: 0xDDAA22, desc: 'Light on top' },
  { name: 'Chef Hat',            category: 'hat', rarity: 1, color: 0xFFFFFF, desc: 'Tall and puffy' },
  // Rare
  { name: 'Viking Helm',         category: 'hat', rarity: 2, color: 0x888866, desc: 'Horns on the sides' },
  { name: 'Wizard Hat',          category: 'hat', rarity: 2, color: 0x4422AA, desc: 'Pointy and mystical' },
  { name: 'Pirate Tricorn',      category: 'hat', rarity: 2, color: 0x332211, desc: 'Arrr matey!' },
  { name: 'Crystal Tiara',       category: 'hat', rarity: 2, color: 0x88DDFF, desc: 'Sparkles in light' },
  { name: 'Iron Helm',           category: 'hat', rarity: 2, color: 0x999999, desc: 'Solid protection' },
  // Epic
  { name: 'Phoenix Crown',       category: 'hat', rarity: 3, color: 0xFF6600, desc: 'Burns with ethereal flame' },
  { name: 'Shadow Hood',         category: 'hat', rarity: 3, color: 0x220033, desc: 'Shrouds the face in darkness' },
  { name: 'Frost Diadem',        category: 'hat', rarity: 3, color: 0xAADDFF, desc: 'Gleams with ice crystals' },
  { name: 'Golden Crown',        category: 'hat', rarity: 3, color: 0xFFDD00, desc: 'Fit for royalty' },
  // Legendary
  { name: 'Void Crown',          category: 'hat', rarity: 4, color: 0x110022, desc: 'Reality bends around it' },
  { name: 'Starfall Helm',       category: 'hat', rarity: 4, color: 0xFFEE88, desc: 'Forged from a fallen star' },

  // ═══ BODY ═══════════════════════════════════════════════════
  // Common
  { name: 'Linen Shirt',         category: 'body', rarity: 0, color: 0xCCBB99, desc: 'Plain but functional' },
  { name: 'Brown Tunic',         category: 'body', rarity: 0, color: 0x886644, desc: 'Standard adventurer wear' },
  { name: 'Gray Vest',           category: 'body', rarity: 0, color: 0x777777, desc: 'Simple and light' },
  { name: 'White Shirt',         category: 'body', rarity: 0, color: 0xEEEEEE, desc: 'Clean and pressed' },
  { name: 'Green Poncho',        category: 'body', rarity: 0, color: 0x448833, desc: 'Good in rain' },
  // Uncommon
  { name: 'Red Jacket',          category: 'body', rarity: 1, color: 0xCC3333, desc: 'Bold and stylish' },
  { name: 'Blue Coat',           category: 'body', rarity: 1, color: 0x3344AA, desc: 'Keeps you warm' },
  { name: 'Leather Armor',       category: 'body', rarity: 1, color: 0x775533, desc: 'Light protection' },
  { name: 'Striped Sweater',     category: 'body', rarity: 1, color: 0xDD4444, desc: 'Red and white stripes' },
  { name: 'Explorer Vest',       category: 'body', rarity: 1, color: 0x887755, desc: 'Many pockets' },
  // Rare
  { name: 'Chain Mail',          category: 'body', rarity: 2, color: 0xAAAABB, desc: 'Linked metal rings' },
  { name: 'Mage Robes',          category: 'body', rarity: 2, color: 0x4422CC, desc: 'Infused with magic' },
  { name: 'Captain\'s Coat',     category: 'body', rarity: 2, color: 0x223366, desc: 'Gold buttons and epaulettes' },
  { name: 'Crystal Vest',        category: 'body', rarity: 2, color: 0x88CCFF, desc: 'Woven from crystal threads' },
  // Epic
  { name: 'Dragon Scale Mail',   category: 'body', rarity: 3, color: 0xCC4422, desc: 'Scales of a fallen dragon' },
  { name: 'Void Cloak',          category: 'body', rarity: 3, color: 0x110033, desc: 'Absorbs light around it' },
  { name: 'Golden Plate',        category: 'body', rarity: 3, color: 0xDDAA22, desc: 'Gleaming gold armor' },
  // Legendary
  { name: 'Starweave Robe',      category: 'body', rarity: 4, color: 0xEEDDFF, desc: 'Threaded from starlight' },
  { name: 'Molten Core Armor',   category: 'body', rarity: 4, color: 0xFF4400, desc: 'Radiates intense heat' },

  // ═══ LEGS ═══════════════════════════════════════════════════
  // Common
  { name: 'Brown Pants',         category: 'legs', rarity: 0, color: 0x664422, desc: 'Sturdy trousers' },
  { name: 'Gray Trousers',       category: 'legs', rarity: 0, color: 0x777777, desc: 'Nothing special' },
  { name: 'Black Pants',         category: 'legs', rarity: 0, color: 0x222222, desc: 'Dark and practical' },
  { name: 'Linen Skirt',         category: 'legs', rarity: 0, color: 0xCCBB99, desc: 'Light and airy' },
  // Uncommon
  { name: 'Blue Jeans',          category: 'legs', rarity: 1, color: 0x3355AA, desc: 'Classic denim' },
  { name: 'Red Shorts',          category: 'legs', rarity: 1, color: 0xCC3333, desc: 'Sporty look' },
  { name: 'Leather Leggings',    category: 'legs', rarity: 1, color: 0x775533, desc: 'Tough and flexible' },
  { name: 'Cargo Pants',         category: 'legs', rarity: 1, color: 0x556644, desc: 'Extra pockets everywhere' },
  // Rare
  { name: 'Chain Leggings',      category: 'legs', rarity: 2, color: 0xAAAABB, desc: 'Metal ring protection' },
  { name: 'Enchanted Pants',     category: 'legs', rarity: 2, color: 0x6633CC, desc: 'Shimmer with magic' },
  { name: 'Frost Leggings',      category: 'legs', rarity: 2, color: 0xAADDFF, desc: 'Cool to the touch' },
  // Epic
  { name: 'Dragon Scale Greaves',category: 'legs', rarity: 3, color: 0xCC4422, desc: 'Scaled leg armor' },
  { name: 'Shadow Leggings',     category: 'legs', rarity: 3, color: 0x220044, desc: 'Silent when walking' },
  // Legendary
  { name: 'Starfall Greaves',    category: 'legs', rarity: 4, color: 0xFFEE88, desc: 'Leave trails of stardust' },

  // ═══ FEET ═══════════════════════════════════════════════════
  // Common
  { name: 'Leather Sandals',     category: 'feet', rarity: 0, color: 0x886644, desc: 'Simple footwear' },
  { name: 'Cloth Shoes',         category: 'feet', rarity: 0, color: 0x777766, desc: 'Comfortable but thin' },
  { name: 'Brown Boots',         category: 'feet', rarity: 0, color: 0x664422, desc: 'Sturdy walking boots' },
  // Uncommon
  { name: 'Red Sneakers',        category: 'feet', rarity: 1, color: 0xCC2222, desc: 'Fast and flashy' },
  { name: 'Blue Boots',          category: 'feet', rarity: 1, color: 0x3344AA, desc: 'Waterproof leather' },
  { name: 'Hiking Boots',        category: 'feet', rarity: 1, color: 0x665533, desc: 'Great for mountains' },
  { name: 'Iron Greaves',        category: 'feet', rarity: 1, color: 0x999999, desc: 'Heavy but protective' },
  // Rare
  { name: 'Mage Slippers',       category: 'feet', rarity: 2, color: 0x6633CC, desc: 'Float slightly' },
  { name: 'Crystal Boots',       category: 'feet', rarity: 2, color: 0x88CCFF, desc: 'Transparent and glowing' },
  { name: 'Sprint Boots',        category: 'feet', rarity: 2, color: 0x33AA44, desc: 'Feel lighter on your feet' },
  // Epic
  { name: 'Lava Walker Boots',   category: 'feet', rarity: 3, color: 0xFF4400, desc: 'Immune to hot surfaces' },
  { name: 'Shadow Step Boots',   category: 'feet', rarity: 3, color: 0x220033, desc: 'Move without a sound' },
  // Legendary
  { name: 'Cloudwalkers',        category: 'feet', rarity: 4, color: 0xDDEEFF, desc: 'Walk on air itself' },

  // ═══ WEAPONS ════════════════════════════════════════════════
  // Common
  { name: 'Wooden Stick',        category: 'weapon', rarity: 0, color: 0x886644, desc: 'Better than nothing' },
  { name: 'Stone Club',          category: 'weapon', rarity: 0, color: 0x888888, desc: 'Heavy and crude' },
  { name: 'Rusty Dagger',        category: 'weapon', rarity: 0, color: 0xAA7744, desc: 'Seen better days' },
  { name: 'Bone Knife',          category: 'weapon', rarity: 0, color: 0xDDCCBB, desc: 'Carved from bone' },
  // Uncommon
  { name: 'Iron Sword',          category: 'weapon', rarity: 1, color: 0xBBBBCC, desc: 'Reliable blade' },
  { name: 'Hunting Bow',         category: 'weapon', rarity: 1, color: 0x775533, desc: 'Good for ranged combat' },
  { name: 'Steel Mace',          category: 'weapon', rarity: 1, color: 0x999999, desc: 'Crushes armor' },
  { name: 'Bronze Axe',          category: 'weapon', rarity: 1, color: 0xCC8833, desc: 'Dual purpose tool' },
  { name: 'Copper Spear',        category: 'weapon', rarity: 1, color: 0xCC7744, desc: 'Good reach' },
  // Rare
  { name: 'Crystal Blade',       category: 'weapon', rarity: 2, color: 0x88CCFF, desc: 'Hums with energy' },
  { name: 'Flame Sword',         category: 'weapon', rarity: 2, color: 0xFF6622, desc: 'Wreathed in fire' },
  { name: 'Frost Axe',           category: 'weapon', rarity: 2, color: 0xAADDFF, desc: 'Freezes on impact' },
  { name: 'Thunder Hammer',      category: 'weapon', rarity: 2, color: 0xFFDD44, desc: 'Sparks on every swing' },
  { name: 'Elven Longbow',       category: 'weapon', rarity: 2, color: 0x448833, desc: 'Elegant and precise' },
  // Epic
  { name: 'Obsidian Greatsword', category: 'weapon', rarity: 3, color: 0x222233, desc: 'Black volcanic glass' },
  { name: 'Phoenix Blade',       category: 'weapon', rarity: 3, color: 0xFF4400, desc: 'Reforged in phoenix fire' },
  { name: 'Void Dagger',         category: 'weapon', rarity: 3, color: 0x330044, desc: 'Cuts through dimensions' },
  { name: 'Storm Bow',           category: 'weapon', rarity: 3, color: 0x4488FF, desc: 'Arrows become lightning' },
  // Legendary
  { name: 'Diamond Sword',       category: 'weapon', rarity: 4, color: 0x88EEFF, desc: 'Unbreakable diamond edge' },
  { name: 'Moltium Warblade',    category: 'weapon', rarity: 4, color: 0xFF2200, desc: 'Forged from the world\'s core' },
  { name: 'Starfall Scepter',    category: 'weapon', rarity: 4, color: 0xFFEE88, desc: 'Commands the stars' },

  // ═══ SHIELDS ════════════════════════════════════════════════
  // Common
  { name: 'Wooden Shield',       category: 'shield', rarity: 0, color: 0x886644, desc: 'Basic wooden protection' },
  { name: 'Wicker Buckler',      category: 'shield', rarity: 0, color: 0xAA9966, desc: 'Light woven shield' },
  // Uncommon
  { name: 'Iron Shield',         category: 'shield', rarity: 1, color: 0x999999, desc: 'Solid iron face' },
  { name: 'Bronze Buckler',      category: 'shield', rarity: 1, color: 0xCC8833, desc: 'Quick to parry' },
  { name: 'Kite Shield',         category: 'shield', rarity: 1, color: 0x3344AA, desc: 'Full body coverage' },
  // Rare
  { name: 'Crystal Barrier',     category: 'shield', rarity: 2, color: 0x88CCFF, desc: 'Semi-transparent wall' },
  { name: 'Tower Shield',        category: 'shield', rarity: 2, color: 0x666677, desc: 'Massive and immovable' },
  // Epic
  { name: 'Dragon Scale Shield', category: 'shield', rarity: 3, color: 0xCC4422, desc: 'Scale of a great dragon' },
  { name: 'Void Barrier',        category: 'shield', rarity: 3, color: 0x220033, desc: 'Absorbs incoming attacks' },
  // Legendary
  { name: 'Aegis of Stars',      category: 'shield', rarity: 4, color: 0xFFEE88, desc: 'Deflects any blow' },

  // ═══ ACCESSORIES ════════════════════════════════════════════
  // Common
  { name: 'Leather Belt',        category: 'accessory', rarity: 0, color: 0x664422, desc: 'Holds your pants up' },
  { name: 'Rope Bracelet',       category: 'accessory', rarity: 0, color: 0xAA9966, desc: 'Friendship bracelet' },
  { name: 'Wooden Pendant',      category: 'accessory', rarity: 0, color: 0x886644, desc: 'Simple carved wood' },
  { name: 'Cloth Scarf',         category: 'accessory', rarity: 0, color: 0xCC3333, desc: 'Warm around the neck' },
  // Uncommon
  { name: 'Silver Ring',         category: 'accessory', rarity: 1, color: 0xCCCCDD, desc: 'Gleaming silver band' },
  { name: 'Iron Bracelet',       category: 'accessory', rarity: 1, color: 0x999999, desc: 'Heavy metal cuff' },
  { name: 'Leather Satchel',     category: 'accessory', rarity: 1, color: 0x775533, desc: 'Extra carry space' },
  { name: 'Compass',             category: 'accessory', rarity: 1, color: 0xCC8833, desc: 'Always points north' },
  { name: 'Blue Buttons',        category: 'accessory', rarity: 1, color: 0x3344AA, desc: 'Decorative blue buttons' },
  // Rare
  { name: 'Gold Necklace',       category: 'accessory', rarity: 2, color: 0xDDAA22, desc: 'Heavy gold chain' },
  { name: 'Emerald Brooch',      category: 'accessory', rarity: 2, color: 0x22CC44, desc: 'Green jewel pin' },
  { name: 'Ruby Amulet',         category: 'accessory', rarity: 2, color: 0xCC2233, desc: 'Warm to the touch' },
  { name: 'Enchanted Monocle',   category: 'accessory', rarity: 2, color: 0xDDCC88, desc: 'See hidden things' },
  // Epic
  { name: 'Dragon Tooth Amulet', category: 'accessory', rarity: 3, color: 0xDDCCBB, desc: 'Radiates ancient power' },
  { name: 'Shadow Cloak Pin',    category: 'accessory', rarity: 3, color: 0x330044, desc: 'Bends shadows around you' },
  { name: 'Phoenix Feather',     category: 'accessory', rarity: 3, color: 0xFF6600, desc: 'Warm and glowing' },
  // Legendary
  { name: 'Crown of Ages',       category: 'accessory', rarity: 4, color: 0xFFDD00, desc: 'Worn by ancient kings' },
  { name: 'Void Stone',          category: 'accessory', rarity: 4, color: 0x110022, desc: 'A piece of nothing itself' },
  { name: 'Heart of Moltium',    category: 'accessory', rarity: 4, color: 0xFF2200, desc: 'Pulses with the world\'s heartbeat' },
];

// ── Build item registry ──────────────────────────────────────

/** @type {Map<number, ItemDef>} id -> item definition */
export const ITEMS = new Map();

/** @type {Map<string, number>} name -> id */
export const ITEM_NAME_TO_ID = new Map();

for (let i = 0; i < ITEMS_RAW.length; i++) {
  const raw = ITEMS_RAW[i];
  const id = i + 1; // 1-based IDs
  const item = {
    id,
    name: raw.name,
    category: raw.category,
    rarity: raw.rarity,
    color: raw.color,
    description: raw.desc,
    slot: CATEGORY_SLOT[raw.category] || null,
  };
  ITEMS.set(id, item);
  ITEM_NAME_TO_ID.set(raw.name, id);
}

/** Total item count */
export const ITEM_COUNT = ITEMS.size;

// ── Helpers ──────────────────────────────────────────────────

/** Get a random item ID weighted by rarity. */
export function randomItemByRarity() {
  const totalWeight = RARITY_WEIGHTS.reduce((a, b) => a + b, 0);
  let roll = Math.random() * totalWeight;
  let targetRarity = 0;
  for (let r = 0; r < RARITY_WEIGHTS.length; r++) {
    roll -= RARITY_WEIGHTS[r];
    if (roll <= 0) { targetRarity = r; break; }
  }

  // Collect items of this rarity
  const candidates = [];
  for (const [id, item] of ITEMS) {
    if (item.rarity === targetRarity) candidates.push(id);
  }
  if (candidates.length === 0) return 1; // fallback
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/** Get item def by ID */
export function getItem(id) {
  return ITEMS.get(id) ?? null;
}

/** Get rarity name */
export function rarityName(rarity) {
  return RARITY_NAMES[rarity] ?? 'Unknown';
}

/** Get rarity color */
export function rarityColor(rarity) {
  return RARITY_COLORS[rarity] ?? 0xAAAAAA;
}
