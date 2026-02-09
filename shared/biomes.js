/**
 * MoltWorld Biome Definitions
 *
 * Biomes are selected by temperature & moisture noise values at each (x,z).
 * Each biome defines surface/subsoil blocks, vegetation, height modifiers,
 * and a grass tint so the world feels alive and varied.
 */

import {
  GRASS, DIRT, SAND, SANDSTONE, SNOW, STONE, RED_SAND, MOLTEN_STONE,
  TEAL_GRASS, BIO_MOSS, PURPLE_GRASS, OAK_LOG, OAK_LEAVES,
  BIRCH_LOG, BIRCH_LEAVES, CRYSTAL_LOG, CRYSTAL_LEAVES,
  MUSHROOM_CAP, MUSHROOM_STEM, CACTUS,
} from './blocks.js';

export const BIOME = {
  VERDANT_PLAINS:  'verdant_plains',
  CRYSTAL_FOREST:  'crystal_forest',
  MOLTEN_BADLANDS: 'molten_badlands',
  FROST_PEAKS:     'frost_peaks',
  AZURE_COAST:     'azure_coast',
  MUSHROOM_GLADES: 'mushroom_glades',
};

export const BIOME_DATA = {
  [BIOME.VERDANT_PLAINS]: {
    name: 'Verdant Plains',
    surface: GRASS,
    subsoil: DIRT,
    heightBase: 22,
    heightAmp: 6,
    treeDensity: 0.008,
    treeLog: OAK_LOG,
    treeLeaf: OAK_LEAVES,
    treeMinH: 4,
    treeMaxH: 7,
    grassTint: 0x5D9B3A,
  },
  [BIOME.CRYSTAL_FOREST]: {
    name: 'Crystal Forest',
    surface: TEAL_GRASS,
    subsoil: DIRT,
    heightBase: 24,
    heightAmp: 10,
    treeDensity: 0.025,
    treeLog: CRYSTAL_LOG,
    treeLeaf: CRYSTAL_LEAVES,
    treeMinH: 5,
    treeMaxH: 10,
    grassTint: 0x2E9E8C,
  },
  [BIOME.MOLTEN_BADLANDS]: {
    name: 'Molten Badlands',
    surface: RED_SAND,
    subsoil: MOLTEN_STONE,
    heightBase: 20,
    heightAmp: 14,
    treeDensity: 0,
    treeLog: null,
    treeLeaf: null,
    treeMinH: 0,
    treeMaxH: 0,
    grassTint: 0xC85A3A,
  },
  [BIOME.FROST_PEAKS]: {
    name: 'Frost Peaks',
    surface: SNOW,
    subsoil: STONE,
    heightBase: 30,
    heightAmp: 22,
    treeDensity: 0.004,
    treeLog: BIRCH_LOG,
    treeLeaf: BIRCH_LEAVES,
    treeMinH: 3,
    treeMaxH: 6,
    grassTint: 0xB0C4DE,
  },
  [BIOME.AZURE_COAST]: {
    name: 'Azure Coast',
    surface: SAND,
    subsoil: SANDSTONE,
    heightBase: 16,
    heightAmp: 4,
    treeDensity: 0.003,
    treeLog: OAK_LOG,
    treeLeaf: OAK_LEAVES,
    treeMinH: 5,
    treeMaxH: 8,
    grassTint: 0xE8D5A3,
  },
  [BIOME.MUSHROOM_GLADES]: {
    name: 'Mushroom Glades',
    surface: PURPLE_GRASS,
    subsoil: DIRT,
    heightBase: 20,
    heightAmp: 4,
    treeDensity: 0.015,
    treeLog: MUSHROOM_STEM,
    treeLeaf: MUSHROOM_CAP,
    treeMinH: 4,
    treeMaxH: 9,
    grassTint: 0x7B4DAA,
  },
};

/**
 * Pick a biome from temperature and moisture, both in [-1, 1].
 */
export function selectBiome(temperature, moisture) {
  if (temperature < -0.3) return BIOME.FROST_PEAKS;
  if (temperature > 0.5 && moisture < 0.0) return BIOME.MOLTEN_BADLANDS;
  if (moisture < -0.2 && temperature > -0.1) return BIOME.AZURE_COAST;
  if (moisture > 0.4 && temperature > 0.2) return BIOME.MUSHROOM_GLADES;
  if (moisture > 0.1 && temperature < 0.2) return BIOME.CRYSTAL_FOREST;
  return BIOME.VERDANT_PLAINS;
}
