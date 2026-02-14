/**
 * OpenAI function calling definitions for MoltyMind.
 *
 * Each tool maps to an action the agent can take in BotCraft.
 * OpenAI returns structured function calls — no text parsing needed.
 */

import { BLOCKS, PLACEABLE, MINEABLE, EMISSIVE } from '../../../shared/blocks.js';

// ── Block name ↔ ID mappings ────────────────────────────────

/** Map human-readable block name → numeric ID (only placeable blocks). */
export const BLOCK_NAME_TO_ID = new Map();

/** Map numeric ID → human-readable name (all blocks). */
export const BLOCK_ID_TO_NAME = new Map();

for (const [id, block] of BLOCKS) {
  BLOCK_ID_TO_NAME.set(id, block.name);
  if (block.flags & PLACEABLE) {
    BLOCK_NAME_TO_ID.set(block.name, id);
  }
}

/** Names of all placeable blocks (for the tool enum). */
const PLACEABLE_NAMES = [...BLOCK_NAME_TO_ID.keys()].sort();

/** Names of "interesting" blocks worth calling out in perception. */
export const NOTABLE_BLOCK_IDS = new Set();
for (const [id, block] of BLOCKS) {
  if (
    (block.flags & MINEABLE) && !(block.flags & PLACEABLE) || // ores, leaves
    (block.flags & EMISSIVE) ||                                // glowing blocks
    block.name.includes('Ore') ||
    block.name.includes('Crystal') ||
    block.name.includes('Moltium') ||
    block.name === 'Water' ||
    block.name === 'Crafting Table' ||
    block.name === 'Furnace'
  ) {
    NOTABLE_BLOCK_IDS.add(id);
  }
}

// ── Tool definitions (OpenAI function calling format) ────────

export const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'perceive',
      description: 'Look around and update your knowledge of the world. Returns biome, nearby blocks summary, nearby players, and time of day. Use this when you need fresh information about your surroundings.',
      parameters: {
        type: 'object',
        properties: {
          radius: {
            type: 'integer',
            description: 'How far to look (1-16 blocks). Default 10.',
          },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'move_to',
      description: 'Walk to a position in the world. X and Z are horizontal, Y is vertical (up). You can move to any position — the server will place you there.',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'number', description: 'Target X coordinate' },
          y: { type: 'number', description: 'Target Y coordinate (vertical)' },
          z: { type: 'number', description: 'Target Z coordinate' },
          reason: { type: 'string', description: 'Brief reason for moving (helps you plan)' },
        },
        required: ['x', 'y', 'z'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'mine_block',
      description: 'Mine (destroy) a block at specific coordinates. Only works on mineable blocks — cannot mine Air, Water, or Bedrock. The block must be near you (within ~6 blocks).',
      parameters: {
        type: 'object',
        properties: {
          x: { type: 'integer', description: 'Block X coordinate' },
          y: { type: 'integer', description: 'Block Y coordinate (vertical)' },
          z: { type: 'integer', description: 'Block Z coordinate' },
        },
        required: ['x', 'y', 'z'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'place_block',
      description: 'Place a block at specific coordinates. The position must be Air (empty) and near you (within ~6 blocks). Use the block name, not a number.',
      parameters: {
        type: 'object',
        properties: {
          block_name: {
            type: 'string',
            description: 'Name of the block to place.',
            enum: PLACEABLE_NAMES,
          },
          x: { type: 'integer', description: 'Block X coordinate' },
          y: { type: 'integer', description: 'Block Y coordinate (vertical)' },
          z: { type: 'integer', description: 'Block Z coordinate' },
        },
        required: ['block_name', 'x', 'y', 'z'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'chat',
      description: 'Say something in the world chat. All players and agents can see this. Keep messages concise and in-character.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'What to say (max 200 characters).',
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'emote',
      description: 'Express an emotion or gesture that other players can see.',
      parameters: {
        type: 'object',
        properties: {
          name: {
            type: 'string',
            description: 'The emote to perform.',
            enum: ['wave', 'dance', 'think', 'celebrate', 'shrug'],
          },
        },
        required: ['name'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'set_goal',
      description: 'Set or update your current primary goal. This helps you stay focused across multiple cycles. Goals persist in your memory until you change them.',
      parameters: {
        type: 'object',
        properties: {
          goal: {
            type: 'string',
            description: 'What you want to accomplish.',
          },
          priority: {
            type: 'string',
            description: 'How important this goal is.',
            enum: ['high', 'medium', 'low'],
          },
        },
        required: ['goal', 'priority'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description: 'Do nothing this cycle. Use when there is nothing meaningful to do right now — observing is fine.',
      parameters: {
        type: 'object',
        properties: {
          reason: {
            type: 'string',
            description: 'Why you are waiting.',
          },
        },
        required: ['reason'],
      },
    },
  },
];
