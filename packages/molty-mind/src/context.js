/**
 * Perception-to-prompt transformer for MoltyMind.
 *
 * Takes raw perceive() output (up to 500 blocks) and compresses it into
 * a ~30-line, LLM-digestible context message for Claude.
 */

import { BLOCK_ID_TO_NAME, NOTABLE_BLOCK_IDS } from './tools.js';
import { AIR } from '../../../shared/blocks.js';

/**
 * Build a context message string from perception data + memory.
 *
 * @param {object} perception — from agent.perceive()
 * @param {import('./memory.js').Memory} memory
 * @param {object} profile — personality config
 * @param {object} agent — BotCraftAgent instance
 * @returns {string}
 */
export function buildContextMessage(perception, memory, profile, agent) {
  const lines = [];

  // ── World state ──────────────────────────────────────
  const pos = perception.position ?? agent.position;
  const px = Math.round(pos.x * 10) / 10;
  const py = Math.round(pos.y * 10) / 10;
  const pz = Math.round(pos.z * 10) / 10;

  lines.push('## World State');
  lines.push(`Position: (${px}, ${py}, ${pz})`);
  lines.push(`Biome: ${perception.biome ?? 'Unknown'}`);

  // Time
  const dayLength = agent.dayLength || 24000;
  const worldTime = perception.worldTime ?? agent.worldTime ?? 0;
  const phase = perception.dayPhase ?? 'unknown';
  const timePercent = Math.round((worldTime / dayLength) * 100);
  lines.push(`Time: ${capitalize(phase)} (${timePercent}% through the day cycle)`);

  // ── Block summary ────────────────────────────────────
  const blocks = perception.nearbyBlocks ?? [];
  if (blocks.length > 0) {
    const { census, notables, terrain } = summarizeBlocks(blocks, pos);

    lines.push('');
    lines.push('## Surroundings');

    // Census
    const totalNonAir = blocks.filter(b => b.block !== AIR).length;
    const censusStr = census
      .sort((a, b) => b.count - a.count)
      .slice(0, 12)
      .map(c => `${c.name}: ${c.count}`)
      .join(', ');
    lines.push(`Block summary (${totalNonAir} non-air blocks nearby): ${censusStr}`);

    // Notable positions
    if (notables.length > 0) {
      lines.push('');
      lines.push('Notable positions:');
      // Group by name
      const grouped = new Map();
      for (const n of notables) {
        if (!grouped.has(n.name)) grouped.set(n.name, []);
        grouped.get(n.name).push(`(${n.x}, ${n.y}, ${n.z})`);
      }
      for (const [name, coords] of grouped) {
        lines.push(`  ${name}: ${coords.slice(0, 5).join(', ')}${coords.length > 5 ? ` (+${coords.length - 5} more)` : ''}`);
      }
    }

    // Vertical context
    lines.push('');
    lines.push(terrain);
  }

  // ── Nearby players ───────────────────────────────────
  const players = perception.nearbyPlayers ?? [];
  if (players.length > 0) {
    lines.push('');
    lines.push('## Nearby Players');
    for (const p of players) {
      const dir = describeDirection(pos, p.pos);
      const tag = p.isAgent ? ' [bot]' : '';
      lines.push(`- ${p.name}${tag} (${p.distance} blocks away, ${dir})`);
    }
  } else {
    lines.push('');
    lines.push('## Nearby Players');
    lines.push('No one nearby.');
  }

  // ── Memory ───────────────────────────────────────────
  lines.push('');
  lines.push(memory.toContextString());

  return lines.join('\n');
}

// ── Block summarization helpers ──────────────────────────

function summarizeBlocks(blocks, agentPos) {
  const counts = new Map(); // blockId -> count
  const notables = [];      // { name, x, y, z }

  // Surface tracking for terrain description
  let above = null;
  let below = null;
  let standing = null;

  const ay = Math.floor(agentPos.y);
  const ax = Math.floor(agentPos.x);
  const az = Math.floor(agentPos.z);

  for (const b of blocks) {
    if (b.block === AIR) continue;

    const name = BLOCK_ID_TO_NAME.get(b.block) ?? `Block#${b.block}`;
    counts.set(name, (counts.get(name) || 0) + 1);

    // Notable blocks (ores, emissive, rare)
    if (NOTABLE_BLOCK_IDS.has(b.block)) {
      notables.push({ name, x: b.x, y: b.y, z: b.z });
    }

    // Vertical context near the agent
    if (b.x === ax && b.z === az) {
      if (b.y === ay - 1) standing = name;
      if (b.y === ay) below = name;     // at feet level
      if (b.y === ay + 2) above = name; // above head
    }
  }

  // Census array
  const census = [...counts.entries()].map(([name, count]) => ({ name, count }));

  // Terrain description
  const terrainParts = [];
  if (standing) terrainParts.push(`Standing on: ${standing}`);
  if (above) {
    terrainParts.push(`Above head: ${above}`);
  } else {
    terrainParts.push('Above: Open sky');
  }

  // Cardinal direction scan
  const directions = cardinalScan(blocks, agentPos);
  if (directions.length > 0) {
    terrainParts.push(...directions);
  }

  const terrain = terrainParts.join('. ') + '.';

  // Cap notables at 20
  return { census, notables: notables.slice(0, 20), terrain };
}

/**
 * Scan blocks in 4 cardinal directions for a brief terrain description.
 */
function cardinalScan(blocks, agentPos) {
  const ax = Math.floor(agentPos.x);
  const ay = Math.floor(agentPos.y);
  const az = Math.floor(agentPos.z);
  const results = [];

  const dirs = [
    { name: 'North', dx: 0, dz: -1 },
    { name: 'East',  dx: 1, dz: 0 },
    { name: 'South', dx: 0, dz: 1 },
    { name: 'West',  dx: -1, dz: 0 },
  ];

  // Group blocks by direction quadrant
  for (const dir of dirs) {
    const relevant = blocks.filter(b => {
      if (b.block === AIR) return false;
      const rx = b.x - ax;
      const rz = b.z - az;
      // Must be in the right half-plane and at roughly agent's Y level
      if (Math.abs(b.y - ay) > 3) return false;
      if (dir.dx !== 0) return Math.sign(rx) === dir.dx && Math.abs(rx) > Math.abs(rz);
      return Math.sign(rz) === dir.dz && Math.abs(rz) > Math.abs(rx);
    });

    if (relevant.length === 0) continue;

    // Count surface block types in this direction
    const typeCounts = new Map();
    for (const b of relevant) {
      const name = BLOCK_ID_TO_NAME.get(b.block) ?? 'unknown';
      typeCounts.set(name, (typeCounts.get(name) || 0) + 1);
    }

    const sorted = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 2).map(([n]) => n).join(' and ');
    results.push(`${dir.name}: mostly ${top}`);
  }

  return results;
}

/**
 * Describe the cardinal direction from one position to another.
 */
function describeDirection(from, to) {
  const dx = to.x - from.x;
  const dz = to.z - from.z;

  const absDx = Math.abs(dx);
  const absDz = Math.abs(dz);

  let ns = '';
  let ew = '';

  if (absDz > 2) ns = dz < 0 ? 'north' : 'south';
  if (absDx > 2) ew = dx > 0 ? 'east' : 'west';

  if (ns && ew) return `to the ${ns}${ew}`;
  if (ns) return `to the ${ns}`;
  if (ew) return `to the ${ew}`;
  return 'nearby';
}

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}
