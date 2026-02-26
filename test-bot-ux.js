/**
 * Bot UX integration test
 * Tests: connect, capabilities, perception, movement, mining, placing, speak, bad-args
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
  check('Capabilities has subscriptionStreams', bot.capabilities?.subscriptionStreams != null);
  check('Capabilities has notes', bot.capabilities?.notes != null);

  // Check each action has example
  const actionsWithExamples = bot.capabilities?.actions?.filter(a => a.example) || [];
  check('All actions have examples', actionsWithExamples.length === bot.capabilities?.actions?.length,
    `${actionsWithExamples.length}/${bot.capabilities?.actions?.length}`);

  // Check Speak action exists in capabilities
  const speakAction = bot.capabilities?.actions?.find(a => a.kind === 'Speak');
  check('Capabilities includes Speak action', speakAction != null);

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

  // ── 7. Semantic perception ──
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

  // ── 8. Full perception (to find a mineable block) ──
  console.log(`\n${INFO} Testing full perception...`);
  let mineTarget = null;
  let placeTarget = null;
  try {
    const fullPercept = await bot.perceive(4);
    check('perceive returned data', fullPercept != null);
    check('Full percept has nearbyPlayers', fullPercept?.nearbyPlayers != null);
    check('Full percept has nearbyBlocks', fullPercept?.nearbyBlocks != null, `${fullPercept?.nearbyBlocks?.length} blocks`);

    // Find a mineable block for the mine test
    if (fullPercept?.nearbyBlocks?.length > 0) {
      // Pick a block that's not bedrock (block 6) and is a solid block
      mineTarget = fullPercept.nearbyBlocks.find(b => b.block !== 6 && b.block !== 5 && b.block !== 0);
      if (mineTarget) {
        // Place target = the exact mined position (which will be AIR after mining)
        placeTarget = { x: mineTarget.x, y: mineTarget.y, z: mineTarget.z };
      }
    }
    check('Found mineable block', mineTarget != null, mineTarget ? `block ${mineTarget.block} at (${mineTarget.x},${mineTarget.y},${mineTarget.z})` : 'none');
  } catch (e) {
    check('perceive', false, e.message);
  }

  // ── 9. Movement with ActionResult ──
  console.log(`\n${INFO} Testing movement with ActionResult...`);
  try {
    const startPos = { ...bot.position };
    const targetX = startPos.x + 2;
    const targetZ = startPos.z + 2;
    const result = await bot.moveTo(targetX, startPos.y, targetZ);
    check('moveTo returned ActionResult', result != null);
    check('moveTo ActionResult ok=true', result?.ok === true);
    await sleep(300);
    check('Position updated (Player/State)',
      bot.position.x !== startPos.x || bot.position.z !== startPos.z,
      `now at (${bot.position?.x?.toFixed(1)}, ${bot.position?.y?.toFixed(1)}, ${bot.position?.z?.toFixed(1)})`
    );
  } catch (e) {
    check('Movement', false, e.message);
  }

  // ── 10. Mine with ActionResult + BlockUpdate ──
  console.log(`\n${INFO} Testing Mine action...`);
  if (mineTarget) {
    let blockUpdateReceived = null;
    bot.on('blockUpdate', (upd) => {
      if (upd.pos?.x === mineTarget.x && upd.pos?.y === mineTarget.y && upd.pos?.z === mineTarget.z) {
        blockUpdateReceived = upd;
      }
    });

    try {
      const mineResult = await bot.mine(mineTarget.x, mineTarget.y, mineTarget.z);
      check('mine() returned ActionResult', mineResult != null);
      check('Mine ActionResult ok=true', mineResult?.ok === true);
      check('Mine effects has mined block ID', typeof mineResult?.effects?.mined === 'number', `mined block ${mineResult?.effects?.mined}`);
      check('Mine effects has drop', mineResult?.effects?.drop != null, `drop: ${mineResult?.effects?.drop}`);
      check('Mine effects has pos', mineResult?.effects?.pos != null);

      await sleep(300);
      check('Block/Update received after Mine', blockUpdateReceived != null);
      check('BlockUpdate has oldBlock', blockUpdateReceived?.oldBlock != null, `old: ${blockUpdateReceived?.oldBlock}`);
      check('BlockUpdate block=0 (AIR)', blockUpdateReceived?.block === 0);
      check('BlockUpdate has byAccountId', blockUpdateReceived?.byAccountId === bot.accountId);
      check('BlockUpdate has tick', typeof blockUpdateReceived?.tick === 'number', `tick: ${blockUpdateReceived?.tick}`);
    } catch (e) {
      check('Mine', false, e.message);
    }

    // ── 11. Place with ActionResult + BlockUpdate ──
    console.log(`\n${INFO} Testing Place action...`);
    if (placeTarget) {
      let placeUpdateReceived = null;
      bot.on('blockUpdate', (upd) => {
        if (upd.pos?.x === placeTarget.x && upd.pos?.y === placeTarget.y && upd.pos?.z === placeTarget.z) {
          placeUpdateReceived = upd;
        }
      });

      try {
        const placeBlockId = 1; // Stone
        const placeResult = await bot.place(placeBlockId, placeTarget.x, placeTarget.y, placeTarget.z);
        check('place() returned ActionResult', placeResult != null);
        check('Place ActionResult ok=true', placeResult?.ok === true);
        check('Place effects has placed', placeResult?.effects?.placed === placeBlockId, `placed: ${placeResult?.effects?.placed}`);
        check('Place effects has pos', placeResult?.effects?.pos != null);

        await sleep(300);
        check('Block/Update received after Place', placeUpdateReceived != null);
        check('BlockUpdate block=placed ID', placeUpdateReceived?.block === placeBlockId);
        check('BlockUpdate has byAccountId', placeUpdateReceived?.byAccountId === bot.accountId);
        check('BlockUpdate has tick', typeof placeUpdateReceived?.tick === 'number');
      } catch (e) {
        check('Place', false, e.message);
      }
    } else {
      console.log(`    SKIP: no place target found`);
    }
  } else {
    console.log(`    SKIP: no mineable block found`);
  }

  // ── 12. Speak with ActionResult ──
  console.log(`\n${INFO} Testing Speak action (via action pipeline)...`);
  try {
    const speakResult = await bot.speak('Hello from Speak action!');
    check('speak() returned ActionResult', speakResult != null);
    check('Speak ActionResult ok=true', speakResult?.ok === true);
    check('Speak effects has text', speakResult?.effects?.text === 'Hello from Speak action!');
    check('Speak effects has channel', speakResult?.effects?.channel === 'global');
  } catch (e) {
    check('Speak', false, e.message);
  }

  // ── 13. Emote with ActionResult ──
  console.log(`\n${INFO} Testing Emote action...`);
  try {
    const emoteResult = await bot.emote('wave');
    check('emote() returned ActionResult', emoteResult != null);
    check('Emote ActionResult ok=true', emoteResult?.ok === true);
  } catch (e) {
    check('Emote', false, e.message);
  }

  // ── 14. Bad args → INVALID_ARGUMENT (never silent) ──
  console.log(`\n${INFO} Testing bad args → INVALID_ARGUMENT...`);

  // Mine with no pos
  try {
    const badMine = await bot.mine(undefined, undefined, undefined);
    check('Mine(no pos) returns ActionResult', badMine != null);
    check('Mine(no pos) ok=false', badMine?.ok === false);
    check('Mine(no pos) has error', badMine?.error?.code != null, badMine?.error?.message);
  } catch (e) {
    check('Mine(no pos)', false, e.message);
  }

  // Place with no blockId
  try {
    const badPlace = await bot.place(undefined, 0, 0, 0);
    check('Place(no blockId) returns ActionResult', badPlace != null);
    check('Place(no blockId) ok=false', badPlace?.ok === false);
    check('Place(no blockId) has error', badPlace?.error?.code != null, badPlace?.error?.message);
  } catch (e) {
    check('Place(no blockId)', false, e.message);
  }

  // Speak with no text
  try {
    const badSpeak = await bot.speak(undefined);
    check('Speak(no text) returns ActionResult', badSpeak != null);
    check('Speak(no text) ok=false', badSpeak?.ok === false);
    check('Speak(no text) has error', badSpeak?.error?.code != null, badSpeak?.error?.message);
  } catch (e) {
    check('Speak(no text)', false, e.message);
  }

  // Emote with no name
  try {
    const badEmote = await bot.emote(undefined);
    check('Emote(no name) returns ActionResult', badEmote != null);
    check('Emote(no name) ok=false', badEmote?.ok === false);
    check('Emote(no name) has error', badEmote?.error?.code != null, badEmote?.error?.message);
  } catch (e) {
    check('Emote(no name)', false, e.message);
  }

  // Unknown action
  try {
    const unknown = await bot._action('FlyToTheMoon', { speed: 'fast' });
    check('Unknown action returns ActionResult', unknown != null);
    check('Unknown action ok=false', unknown?.ok === false);
    check('Unknown action has error', unknown?.error?.message?.includes('Unknown'), unknown?.error?.message);
  } catch (e) {
    check('Unknown action', false, e.message);
  }

  // ── 15. Raycast ──
  console.log(`\n${INFO} Testing raycast...`);
  try {
    const ray = await bot.raycast();
    check('raycast returned data', ray != null);
    if (ray?.hit) {
      check('Raycast hit has blockId', ray.hit.blockId != null, `${ray.hit.name} (id ${ray.hit.blockId})`);
      check('Raycast hit has position', ray.hit.x != null);
    } else {
      check('Raycast returned (no hit)', true, 'no block in range');
    }
  } catch (e) {
    check('raycast', false, e.message);
  }

  // ── 16. Subscribe ──
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

  // ── 17. HP & state ──
  console.log(`\n${INFO} Checking player state...`);
  check('Has HP', typeof bot.hp === 'number', `HP: ${bot.hp}`);
  check('Has dead flag', typeof bot.dead === 'boolean', `dead: ${bot.dead}`);
  check('Has rotation', bot.rotation != null);

  // ── Summary ──
  console.log(`\n${'='.repeat(50)}`);
  console.log(`  Results: ${PASS} ${passed} passed, ${failed > 0 ? FAIL : ''} ${failed} failed`);
  console.log(`${'='.repeat(50)}\n`);

  bot.disconnect();
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Fatal error:', e);
  process.exit(1);
});
