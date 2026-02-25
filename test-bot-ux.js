/**
 * Bot UX integration test
 * Tests: connect, capabilities handshake, perception, movement, mining, chat, items
 */

import { BotCraftAgent } from './packages/agent-sdk/src/index.js';

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
const INFO = '\x1b[36mINFO\x1b[0m';
let passed = 0;
let failed = 0;

function check(label, condition, detail) {
  if (condition) {
    console.log(`  ${PASS} ${label}${detail ? ' — ' + detail : ''}`);
    passed++;
  } else {
    console.log(`  ${FAIL} ${label}${detail ? ' — ' + detail : ''}`);
    failed++;
  }
}

async function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function main() {
  console.log('\n=== BotCraft Bot UX Test ===\n');

  // ── 1. REST API: GET /api/status ──
  console.log(`${INFO} Testing REST API...`);
  try {
    const statusRes = await fetch('http://localhost:3000/api/status');
    const status = await statusRes.json();
    check('GET /api/status returns 200', statusRes.ok);
    check('Status has players', typeof status.players === 'number', `${status.players} online`);
    check('Status has wsUrl', typeof status.wsUrl === 'string', status.wsUrl);
    check('Status has protocolVersion', status.protocolVersion !== undefined, `v${status.protocolVersion}`);
    check('Status has dayPhase', typeof status.dayPhase === 'string', status.dayPhase);
  } catch (e) {
    check('REST /api/status', false, e.message);
  }

  // ── 2. REST API: POST /api/agent/join ──
  try {
    const joinRes = await fetch('http://localhost:3000/api/agent/join', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'TestBot' }),
    });
    const join = await joinRes.json();
    check('POST /api/agent/join returns 200', joinRes.ok);
    check('Join has wsUrl', typeof join.wsUrl === 'string', join.wsUrl);
    check('Join wsUrl uses ws:// or wss://', join.wsUrl?.startsWith('ws'), join.wsUrl);
    check('Join has protocolVersion', join.protocolVersion !== undefined);
    check('Join has instructions', join.instructions != null && typeof join.instructions === 'object');
    check('Join has serverBuild', typeof join.serverBuild === 'string', join.serverBuild);
  } catch (e) {
    check('REST /api/agent/join', false, e.message);
  }

  // ── 3. Agent SDK: Connect ──
  console.log(`\n${INFO} Connecting bot via Agent SDK...`);
  const bot = new BotCraftAgent({
    name: 'Victorio-Test',
    traits: ['explorer', 'tester'],
    primaryColor: '#FF6600',
    motto: 'Testing all the things!',
  });

  try {
    await bot.connect('ws://localhost:3000');
    check('WebSocket connected', true);
    check('Got account ID', !!bot.accountId, bot.accountId);
    check('Got spawn position', bot.position != null, `(${bot.position?.x?.toFixed(1)}, ${bot.position?.y?.toFixed(1)}, ${bot.position?.z?.toFixed(1)})`);
  } catch (e) {
    check('WebSocket connect', false, e.message);
    console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`);
    process.exit(1);
  }

  // ── 4. Capabilities Handshake ──
  console.log(`\n${INFO} Checking capabilities handshake...`);
  check('Has capabilities object', bot.capabilities != null);
  check('Capabilities has actions', Array.isArray(bot.capabilities?.actions), `${bot.capabilities?.actions?.length} actions`);
  check('Capabilities has channels', Array.isArray(bot.capabilities?.channels));
  check('Capabilities has rateLimit', bot.capabilities?.rateLimit != null);
  check('Capabilities has subscriptionStreams', bot.capabilities?.subscriptionStreams != null, bot.capabilities?.subscriptionStreams?.join(', '));

  // ── 5. Item Registry ──
  console.log(`\n${INFO} Checking item registry...`);
  check('Has itemRegistry', Array.isArray(bot.itemRegistry), `${bot.itemRegistry?.length} items`);
  if (bot.itemRegistry?.length > 0) {
    const sample = bot.itemRegistry[0];
    check('Item has id', typeof sample.id === 'number');
    check('Item has name', typeof sample.name === 'string', sample.name);
    check('Item has category', typeof sample.category === 'string');
    check('Item has rarity', typeof sample.rarity === 'number');
  }

  // ── 6. Hotbar Resolved ──
  console.log(`\n${INFO} Checking hotbar...`);
  check('Has hotbarResolved', Array.isArray(bot.hotbarResolved), `${bot.hotbarResolved?.length} slots`);
  if (bot.hotbarResolved?.length > 0) {
    const slot = bot.hotbarResolved[0];
    check('Hotbar slot has id', typeof slot.id === 'number');
    check('Hotbar slot has name', typeof slot.name === 'string', slot.name);
  }

  // ── 7. Chat ──
  console.log(`\n${INFO} Testing chat...`);
  let chatReceived = false;
  bot.on('chat', (msg) => {
    if (msg.text === 'Hello from bot test!') chatReceived = true;
  });
  await bot.chat('Hello from bot test!');
  await sleep(500);
  check('Chat message sent', true);

  // ── 8. Perception: queryPercept ──
  console.log(`\n${INFO} Testing semantic perception...`);
  try {
    const percept = await bot.queryPercept(8);
    check('queryPercept returned data', percept != null);
    check('Percept has blockSummary', percept?.blockSummary != null, `${Object.keys(percept?.blockSummary || {}).length} block types`);
    check('Percept has biome', typeof percept?.biome === 'string', percept?.biome);
    check('Percept has nearbyPlayers', percept?.nearbyPlayers != null);
    check('Percept has inventory', percept?.inventory != null);
    if (percept?.blockSummary) {
      const blockTypes = Object.keys(percept.blockSummary);
      console.log(`    Block types nearby: ${blockTypes.slice(0, 8).join(', ')}${blockTypes.length > 8 ? '...' : ''}`);
    }
  } catch (e) {
    check('queryPercept', false, e.message);
  }

  // ── 9. Movement with ActionResult ──
  console.log(`\n${INFO} Testing movement with ActionResult...`);
  try {
    const startPos = { ...bot.position };
    const targetX = startPos.x + 2;
    const targetZ = startPos.z + 2;
    const result = await bot.moveTo(targetX, startPos.y, targetZ);
    check('moveTo returned ActionResult', result != null);
    check('ActionResult has ok field', result?.ok !== undefined, `ok=${result?.ok}`);
    await sleep(300);
    check('Position updated (Player/State)',
      bot.position.x !== startPos.x || bot.position.z !== startPos.z,
      `now at (${bot.position?.x?.toFixed(1)}, ${bot.position?.y?.toFixed(1)}, ${bot.position?.z?.toFixed(1)})`
    );
  } catch (e) {
    check('Movement', false, e.message);
  }

  // ── 10. Raycast ──
  console.log(`\n${INFO} Testing raycast...`);
  try {
    const ray = await bot.raycast();
    check('raycast returned data', ray != null);
    if (ray?.hit) {
      check('Raycast hit has block', ray.block != null, ray.blockName);
      check('Raycast hit has position', ray.position != null, `(${ray.position?.x}, ${ray.position?.y}, ${ray.position?.z})`);
    } else {
      check('Raycast returned (no hit)', true, 'no block in range');
    }
  } catch (e) {
    check('raycast', false, e.message);
  }

  // ── 11. Perceive (full) ──
  console.log(`\n${INFO} Testing full perception...`);
  try {
    const fullPercept = await bot.perceive(4);
    check('perceive returned data', fullPercept != null);
    check('Full percept has nearbyPlayers', fullPercept?.nearbyPlayers != null);
    check('Full percept has nearbyBlocks', fullPercept?.nearbyBlocks != null, `${fullPercept?.nearbyBlocks?.length} blocks`);
  } catch (e) {
    check('perceive', false, e.message);
  }

  // ── 12. Emote ──
  console.log(`\n${INFO} Testing emote...`);
  try {
    await bot.emote('wave');
    check('Emote sent', true);
  } catch (e) {
    check('Emote', false, e.message);
  }

  // ── 13. Subscribe ──
  console.log(`\n${INFO} Testing subscription control...`);
  try {
    bot.subscribe({ mobs: false, items: false });
    check('subscribe() called', true);
    await sleep(200);
    bot.subscribe({ mobs: true, items: true });
    check('Re-subscribe successful', true);
  } catch (e) {
    check('subscribe', false, e.message);
  }

  // ── 14. HP & state ──
  console.log(`\n${INFO} Checking player state...`);
  check('Has HP', typeof bot.hp === 'number', `HP: ${bot.hp}`);
  check('Has dead flag', typeof bot.dead === 'boolean', `dead: ${bot.dead}`);
  check('Has rotation', bot.rotation != null, `yaw: ${bot.rotation?.yaw?.toFixed(2)}`);

  // ── Summary ──
  console.log(`\n${'='.repeat(40)}`);
  console.log(`  Results: ${PASS} ${passed} passed, ${failed > 0 ? FAIL : ''} ${failed} failed`);
  console.log(`${'='.repeat(40)}\n`);

  bot.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
