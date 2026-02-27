/**
 * BotCraft Web Client — Main entry point.
 *
 * Boots the Three.js scene, connects to the server, and runs the game loop.
 * botcraft.app — Where AI agents build worlds.
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { Connection } from './network/connection.js';
import { VoxelWorld } from './engine/voxel-world.js';
import { PlayerController } from './engine/player-controller.js';
import { RemotePlayers } from './engine/remote-players.js';
import { ParticleSystem } from './engine/particles.js';
import { MobRenderer } from './engine/mobs.js';
import { ItemRenderer, applyEquipmentVisuals } from './engine/items.js';
import { createSky, updateSky } from './engine/sky.js';
import { S2C, CHUNK_SIZE, CHUNK_HEIGHT, TICK_RATE } from '@shared/protocol.js';
import { blockName, DEFAULT_HOTBAR, blockColor, BLOCKS, isEmissive } from '@shared/blocks.js';
import { selectBiome, BIOME_DATA } from '@shared/biomes.js';
import { PerlinNoise } from '@shared/noise.js';

// ── DOM refs ────────────────────────────────────────────────
const loginScreen   = document.getElementById('login-screen');
const nameInput     = document.getElementById('name-input');
const joinBtn       = document.getElementById('join-btn');
const hudEl         = document.getElementById('hud');
const hudLeft       = document.getElementById('hud-left');
const hudRight      = document.getElementById('hud-right');
const crosshair     = document.getElementById('crosshair');
const hotbarEl      = document.getElementById('hotbar');
const chatContainer = document.getElementById('chat-container');
const chatLog       = document.getElementById('chat-log');
const chatInputWrap = document.getElementById('chat-input-wrap');
const chatInput     = document.getElementById('chat-input');
const playerList    = document.getElementById('player-list');
const playerEntries = document.getElementById('player-entries');
const clickPrompt   = document.getElementById('click-prompt');
const flyIndicator  = document.getElementById('fly-indicator');
const minimapCanvas = document.getElementById('minimap-canvas');
const activityFeed  = document.getElementById('activity-feed');

// ── State ───────────────────────────────────────────────────
let connection, voxelWorld, controller, remotePlayers, particles, mobRenderer, itemRenderer;
let myInventory = [];
let myEquipment = {};
let myAccountId = null;
let myProfile = null;
let hotbar = [...DEFAULT_HOTBAR];
let selectedSlot = 0;
let chatOpen = false;
let tabHeld = false;
let playerHp = 20;
let playerMaxHp = 20;
let playerDead = false;
let attackCooldown = 0;
let hurtOverlay = 0;  // red flash timer
let worldTime = 0;
let dayLength = TICK_RATE * 60 * 20;
const onlinePlayers = new Map();
const biomeNoise = { t: new PerlinNoise(42 + 1000), m: new PerlinNoise(42 + 2000) };

// ── Three.js setup ──────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);

// ── Post-processing pipeline ──────────────────────────────
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

// Bloom pass — makes emissive blocks (crystal, lava, moltium, glowstone) glow
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.35,  // strength
  0.4,   // radius
  0.85,  // threshold — only bright (emissive) things bloom
);
composer.addPass(bloomPass);
composer.addPass(new OutputPass());

// Underwater overlay
const underwaterOverlay = document.createElement('div');
underwaterOverlay.id = 'underwater-overlay';
underwaterOverlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:5;transition:opacity 0.3s,background 0.3s;opacity:0;background:radial-gradient(ellipse at center,rgba(10,40,70,0.35) 0%,rgba(5,20,50,0.55) 100%)';
document.body.appendChild(underwaterOverlay);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
});

const sky = createSky(scene);

// ── Join flow ───────────────────────────────────────────────
joinBtn.addEventListener('click', startGame);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });

function getWsUrl() {
  return import.meta.env.VITE_WS_URL
    || (location.hostname === 'localhost' || location.hostname === '127.0.0.1'
      ? `ws://${location.hostname}:3000`
      : `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`);
}

async function startGame() {
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }

  joinBtn.disabled = true;
  const maxRetries = 3;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    joinBtn.textContent = attempt === 1 ? 'Connecting...' : `Retrying (${attempt}/${maxRetries})...`;
    try {
      connection = new Connection();
      await connection.connect(getWsUrl());
      setupNetworkHandlers();
      connection.authenticate(name);
      return;
    } catch (err) {
      if (attempt < maxRetries) {
        joinBtn.textContent = `Retry in ${attempt * 2}s...`;
        await new Promise(r => setTimeout(r, attempt * 2000));
      }
    }
  }

  joinBtn.textContent = 'Enter World';
  joinBtn.disabled = false;
  alert('Could not connect to the BotCraft server after multiple attempts. Is it running?');
}

function setupNetworkHandlers() {
  connection.on(S2C.AUTH_OK, (payload) => {
    myAccountId = payload.accountId;
    myProfile = payload.profile;
    if (payload.hotbar) hotbar = payload.hotbar;
    if (payload.worldTime != null) worldTime = payload.worldTime;
    if (payload.dayLength) dayLength = payload.dayLength;
    connection.joinWorld();
  });

  connection.on(S2C.AUTH_ERROR, (payload) => {
    alert(`Auth error: ${payload.message}`);
    joinBtn.textContent = 'Enter World';
    joinBtn.disabled = false;
  });

  connection.on(S2C.WORLD_SNAPSHOT, (payload) => {
    if (payload.spawn) {
      controller.position.set(payload.spawn.x, payload.spawn.y, payload.spawn.z);
    }
    if (payload.worldTime != null) worldTime = payload.worldTime;
    if (payload.dayLength) dayLength = payload.dayLength;
    enterGame();
  });

  connection.on(S2C.WORLD_CHUNK, (payload) => {
    const { cx, cz, data } = payload;
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    voxelWorld.setChunkData(cx, cz, bytes);
  });

  connection.on(S2C.PLAYER_JOIN, (payload) => {
    onlinePlayers.set(payload.accountId, { name: payload.name, profile: payload.profile, isAgent: payload.isAgent });
    remotePlayers?.addPlayer(payload.accountId, payload.name, payload.profile, payload.pos);
    addChatMessage(null, `${payload.name}${payload.isAgent ? ' [BOT]' : ''} joined BotCraft`, 'system');
    addActivity(payload.name, 'joined the world', payload.isAgent);
    updatePlayerList();
  });

  connection.on(S2C.PLAYER_LEAVE, (payload) => {
    onlinePlayers.delete(payload.accountId);
    remotePlayers?.removePlayer(payload.accountId);
    addChatMessage(null, `${payload.name} left BotCraft`, 'system');
    updatePlayerList();
  });

  connection.on(S2C.PLAYER_MOVE, (payload) => {
    remotePlayers?.updatePosition(payload.accountId, payload.pos);
  });

  connection.on(S2C.BLOCK_UPDATE, (payload) => {
    const { pos, block } = payload;
    // Particle effect for block destruction (block == 0 means mined)
    if (block === 0 && voxelWorld) {
      const oldBlock = voxelWorld.getBlock(pos.x, pos.y, pos.z);
      if (oldBlock !== 0) {
        particles?.emitBlockBreak(pos.x, pos.y, pos.z, blockColor(oldBlock));
      }
    } else if (block !== 0) {
      particles?.emitBlockPlace(pos.x, pos.y, pos.z);
    }
    voxelWorld?.updateBlock(pos.x, pos.y, pos.z, block);
  });

  connection.on(S2C.CHAT_MESSAGE, (payload) => {
    addChatMessage(payload.name, payload.text, payload.isAgent ? 'bot' : 'normal');
    if (payload.isAgent) {
      addActivity(payload.name, `said: "${payload.text.slice(0, 60)}"`, true);
    }
  });

  connection.on(S2C.WORLD_EVENT, (payload) => {
    if (payload.kind === 'emote') {
      addChatMessage(null, `${payload.name} ${payload.emote}`, 'system');
      addActivity(payload.name, payload.emote, true);
    } else if (payload.kind === 'time') {
      worldTime = payload.worldTime;
      if (payload.dayLength) dayLength = payload.dayLength;
    }
  });

  // ── Mob events ──
  connection.on(S2C.MOB_SPAWN, (payload) => {
    mobRenderer?.addMob(payload.id, payload.type, payload.pos, payload.hp, payload.maxHp);
  });

  connection.on(S2C.MOB_MOVE, (payload) => {
    mobRenderer?.updateMobPosition(payload.id, payload.pos);
  });

  connection.on(S2C.MOB_DESPAWN, (payload) => {
    mobRenderer?.removeMob(payload.id);
  });

  connection.on(S2C.MOB_HURT, (payload) => {
    mobRenderer?.hurtMob(payload.id, payload.hp, payload.maxHp);
  });

  // ── Player health events ──
  connection.on(S2C.PLAYER_HURT, (payload) => {
    if (payload.accountId === myAccountId) {
      playerHp = payload.hp;
      playerMaxHp = payload.maxHp;
      hurtOverlay = 0.4;
    }
  });

  connection.on(S2C.PLAYER_DEATH, (payload) => {
    if (payload.accountId === myAccountId) {
      playerDead = true;
      playerHp = 0;
      addChatMessage(null, `You were killed by ${payload.source}!`, 'system');
    } else {
      const name = onlinePlayers.get(payload.accountId)?.name ?? 'Someone';
      addChatMessage(null, `${name} was killed by ${payload.source}`, 'system');
    }
  });

  connection.on(S2C.PLAYER_RESPAWN, (payload) => {
    if (payload.accountId === myAccountId) {
      playerDead = false;
      playerHp = payload.hp;
      playerMaxHp = payload.maxHp;
      controller.position.set(payload.pos.x, payload.pos.y, payload.pos.z);
      addChatMessage(null, 'You respawned!', 'system');
    }
  });

  // ── Item events ──
  connection.on(S2C.ITEM_SPAWN, (payload) => {
    itemRenderer?.addWorldItem(payload.id, payload.itemId, payload.pos);
  });

  connection.on(S2C.ITEM_DESPAWN, (payload) => {
    itemRenderer?.removeWorldItem(payload.id);
  });

  connection.on(S2C.INVENTORY_UPDATE, (payload) => {
    myInventory = payload.items || [];
    if (inventoryOpen) {
      const panel = document.getElementById('inventory-panel');
      if (panel) renderInventoryPanel(panel);
    }
  });

  connection.on(S2C.EQUIP_UPDATE, (payload) => {
    if (payload.accountId === myAccountId) {
      myEquipment = payload.equipment || {};
      if (inventoryOpen) {
        const panel = document.getElementById('inventory-panel');
        if (panel) renderInventoryPanel(panel);
      }
    }
    // Apply visuals to remote player
    const rp = remotePlayers?.players.get(payload.accountId);
    if (rp) {
      applyEquipmentVisuals(rp.group, payload.equipment);
    }
  });

  connection.on(S2C.TRADE_COMPLETE, (payload) => {
    addChatMessage(null, `${payload.from} gave ${payload.itemName} to ${payload.to}`, 'system');
    addActivity(payload.from, `traded ${payload.itemName}`, true);
  });

  connection.on('disconnected', () => {
    addChatMessage(null, 'Disconnected from server', 'system');
  });
}

// ── Enter game ──────────────────────────────────────────────
function enterGame() {
  loginScreen.style.display = 'none';
  hudEl.classList.add('active');
  crosshair.classList.add('active');
  hotbarEl.classList.add('active');
  chatContainer.classList.add('active');
  clickPrompt.classList.add('active');
  if (minimapCanvas?.parentElement) minimapCanvas.parentElement.style.display = 'block';
  if (activityFeed) activityFeed.style.display = 'block';

  buildHotbar();

  // Pointer lock — click directly on the canvas (now position:fixed, full viewport)
  renderer.domElement.addEventListener('click', () => {
    if (!chatOpen && !controller.locked) {
      controller.requestLock();
      clickPrompt.classList.remove('active');
    }
  });

  // Show click prompt when pointer lock is lost
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && !chatOpen) {
      clickPrompt.classList.add('active');
    }
  });

  // Start game loop
  requestAnimationFrame(gameLoop);
}

// ── Initialize world + controller ───────────────────────────
voxelWorld = new VoxelWorld(scene);
controller = new PlayerController(camera, renderer.domElement, voxelWorld);
scene.add(controller.highlightMesh);
remotePlayers = new RemotePlayers(scene, camera);
particles = new ParticleSystem(scene);
mobRenderer = new MobRenderer(scene, camera);
itemRenderer = new ItemRenderer(scene, camera);

// ── Game loop ───────────────────────────────────────────────
let lastTime = performance.now();
let moveAccum = 0;
let minimapAccum = 0;

function gameLoop(now) {
  requestAnimationFrame(gameLoop);

  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  // Client-side time interpolation (server broadcasts every 2s, we tick locally)
  if (dayLength > 0) {
    worldTime = (worldTime + dt * TICK_RATE) % dayLength;
  }

  // Player movement
  controller.update(dt);
  remotePlayers.update(dt);
  particles.update(dt);
  mobRenderer.update(dt);
  itemRenderer?.update(dt);

  // Send position to server periodically
  moveAccum += dt;
  if (moveAccum > 0.05 && connection?.connected) {
    moveAccum = 0;
    connection.sendMove(
      { x: controller.position.x, y: controller.position.y, z: controller.position.z },
      { x: controller.euler.x, y: controller.euler.y, z: 0, w: 1 },
    );
  }

  // Attack cooldown
  if (attackCooldown > 0) attackCooldown -= dt;

  // Left-click: mob attack only (humans observe — only bots can mine/place)
  const mineTarget = controller.getMineTarget();
  if (mineTarget && connection?.connected && !playerDead) {
    const hitMob = findMobInCrosshair();
    if (hitMob && attackCooldown <= 0) {
      connection.sendAttackMob(hitMob);
      attackCooldown = 0.4; // attack cooldown
    }
    // No mining for human players — bots handle block interactions
  }

  // No placing for human players — bots handle building

  // Water shader animation
  if (voxelWorld.waterMaterial?.uniforms) {
    voxelWorld.waterMaterial.uniforms.uTime.value = now * 0.001;
    voxelWorld.waterMaterial.uniforms.uCamPos.value.copy(camera.position);
  }

  // Underwater visual effects
  if (controller.headUnderwater) {
    underwaterOverlay.style.opacity = '1';
    scene.fog.density = 0.04; // thick underwater fog
  } else if (controller.inWater) {
    underwaterOverlay.style.opacity = '0.3';
    scene.fog.density = 0.01;
  } else {
    underwaterOverlay.style.opacity = '0';
  }

  // Hurt flash overlay
  if (hurtOverlay > 0) {
    hurtOverlay -= dt;
  }

  // Day/night cycle — also resets fog density for above-water
  updateSky(sky, scene, worldTime, dayLength);
  if (!controller.inWater && !controller.headUnderwater) {
    // sky.js sets fog color; we just make sure density is normal
    scene.fog.density = 0.006;
  }

  // Update HUD + minimap
  updateHUD();
  minimapAccum += dt;
  if (minimapAccum > 0.5) {
    minimapAccum = 0;
    updateMinimap();
  }

  // Render with post-processing (bloom on emissive blocks)
  composer.render();
}

// ── HUD ─────────────────────────────────────────────────────
function updateHUD() {
  const pos = controller.position;
  const bx = Math.floor(pos.x), by = Math.floor(pos.y), bz = Math.floor(pos.z);

  const temp = biomeNoise.t.fbm(bx / 256, bz / 256, 3);
  const moist = biomeNoise.m.fbm(bx / 256, bz / 256, 3);
  const biomeId = selectBiome(temp, moist);
  const biome = BIOME_DATA[biomeId];

  // Health bar
  const hpRatio = playerMaxHp > 0 ? playerHp / playerMaxHp : 0;
  const hpColor = hpRatio > 0.5 ? '#4f4' : hpRatio > 0.25 ? '#fa0' : '#f33';
  const hpBar = `<span class="hud-label">HP</span> <span style="display:inline-block;width:60px;height:8px;background:rgba(0,0,0,0.4);border-radius:3px;vertical-align:middle"><span style="display:block;width:${hpRatio * 100}%;height:100%;background:${hpColor};border-radius:3px"></span></span> ${playerHp}/${playerMaxHp}`;

  hudLeft.innerHTML = [
    hpBar,
    `<span class="hud-label">XYZ</span> ${bx} / ${by} / ${bz}`,
    `<span class="hud-label">Biome</span> ${biome?.name ?? 'Unknown'}`,
    controller.targetBlock
      ? `<span class="hud-label">Target</span> ${blockName(voxelWorld.getBlock(controller.targetBlock.x, controller.targetBlock.y, controller.targetBlock.z))}`
      : '',
    myInventory.length > 0 ? `<span class="hud-label">Items</span> ${myInventory.length}/12 [I]` : '',
    controller.flying ? `<span class="hud-label">Mode</span> Flying` :
      controller.headUnderwater ? `<span class="hud-label" style="color:#4af">Mode</span> <span style="color:#4af">Underwater</span>` :
      controller.inWater ? `<span class="hud-label" style="color:#6cf">Mode</span> <span style="color:#6cf">Swimming</span>` : '',
    playerDead ? '<span style="color:#f44;font-weight:bold">DEAD — Respawning...</span>' : '',
  ].filter(Boolean).join('<br>');

  const timeOfDay = dayLength > 0 ? getDayPhaseLabel(worldTime / dayLength) : '';
  const timeIcon = getDayPhaseIcon(worldTime / dayLength);

  hudRight.innerHTML = [
    `<span class="hud-label">Players</span> ${onlinePlayers.size + 1}`,
    `<span class="hud-label">Chunks</span> ${voxelWorld.chunks.size}`,
    timeOfDay ? `<span class="hud-label">Time</span> ${timeIcon} ${timeOfDay}` : '',
  ].filter(Boolean).join('<br>');
}

function getDayPhaseLabel(t) {
  t = ((t % 1) + 1) % 1;
  if (t < 0.2) return 'Dawn';
  if (t < 0.45) return 'Day';
  if (t < 0.55) return 'Dusk';
  if (t < 0.8) return 'Night';
  return 'Pre-dawn';
}

function getDayPhaseIcon(t) {
  t = ((t % 1) + 1) % 1;
  if (t < 0.2) return '\u2600'; // sun
  if (t < 0.45) return '\u2600';
  if (t < 0.55) return '\u263D'; // moon
  if (t < 0.8) return '\u263D';
  return '\u2600';
}

// ── Item Pickup & Inventory ──────────────────────────────────
function pickUpNearestItem() {
  if (!itemRenderer || !connection?.connected) return;
  const pos = controller.position;
  let nearest = null;
  let nearDist = Infinity;

  for (const [id, item] of itemRenderer.worldItems) {
    const dx = item.group.position.x - pos.x;
    const dz = item.group.position.z - pos.z;
    const dist = Math.sqrt(dx * dx + dz * dz);
    if (dist < nearDist && dist < 5) {
      nearDist = dist;
      nearest = id;
    }
  }

  if (nearest) {
    connection.sendPickUpItem(nearest);
  }
}

let inventoryOpen = false;
function toggleInventoryPanel() {
  inventoryOpen = !inventoryOpen;
  let panel = document.getElementById('inventory-panel');
  if (!panel) {
    panel = document.createElement('div');
    panel.id = 'inventory-panel';
    panel.style.cssText = 'position:fixed;right:20px;top:50%;transform:translateY(-50%);width:260px;background:rgba(10,10,30,0.85);backdrop-filter:blur(12px);border:1px solid rgba(255,255,255,0.12);border-radius:12px;padding:16px;color:#fff;font-family:monospace;font-size:12px;z-index:200;display:none;max-height:70vh;overflow-y:auto';
    document.body.appendChild(panel);
  }

  if (inventoryOpen) {
    renderInventoryPanel(panel);
    panel.style.display = 'block';
  } else {
    panel.style.display = 'none';
  }
}

function renderInventoryPanel(panel) {
  let html = '<div style="font-size:14px;font-weight:bold;margin-bottom:10px">Inventory [I]</div>';

  // Equipment
  const slots = ['head', 'body', 'legs', 'feet', 'mainHand', 'offHand'];
  const slotLabels = { head: 'Head', body: 'Body', legs: 'Legs', feet: 'Feet', mainHand: 'Weapon', offHand: 'Shield' };
  html += '<div style="margin-bottom:8px;color:#aaa">Equipment:</div>';
  for (const slot of slots) {
    const item = myEquipment[slot];
    const label = slotLabels[slot] || slot;
    if (item) {
      const col = _rarityColor(item.rarity);
      html += `<div style="padding:2px 4px;margin:2px 0;display:flex;justify-content:space-between;align-items:center"><span style="color:${col}">${label}: ${item.name}</span><button onclick="window._unequipSlot('${slot}')" style="background:rgba(255,100,100,0.3);border:1px solid rgba(255,100,100,0.4);color:#faa;border-radius:4px;padding:1px 6px;cursor:pointer;font-size:10px">X</button></div>`;
    } else {
      html += `<div style="padding:2px 4px;margin:2px 0;color:#555">${label}: -</div>`;
    }
  }

  // Backpack
  html += '<div style="margin:10px 0 8px;color:#aaa">Backpack:</div>';
  if (myInventory.length === 0) {
    html += '<div style="color:#555;padding:2px 4px">Empty</div>';
  }
  for (let i = 0; i < myInventory.length; i++) {
    const item = myInventory[i];
    const col = _rarityColor(item.rarity);
    html += `<div style="padding:2px 4px;margin:2px 0;display:flex;justify-content:space-between;align-items:center"><span style="color:${col}">[${i}] ${item.name} <span style="color:#888;font-size:10px">${item.category}</span></span><span>`;
    html += `<button onclick="window._equipSlot(${i})" style="background:rgba(100,200,255,0.2);border:1px solid rgba(100,200,255,0.3);color:#8df;border-radius:4px;padding:1px 6px;cursor:pointer;font-size:10px;margin-right:3px">Equip</button>`;
    html += `<button onclick="window._dropSlot(${i})" style="background:rgba(255,100,100,0.2);border:1px solid rgba(255,100,100,0.3);color:#faa;border-radius:4px;padding:1px 6px;cursor:pointer;font-size:10px">Drop</button>`;
    html += '</span></div>';
  }

  panel.innerHTML = html;
}

function _rarityColor(rarity) {
  const colors = ['#aaa', '#5f5', '#55f', '#a5f', '#fa0'];
  return colors[rarity] ?? '#aaa';
}

// Global handlers for inventory buttons
window._equipSlot = (idx) => {
  if (connection?.connected) connection.sendEquipItem(idx);
};
window._unequipSlot = (slot) => {
  if (connection?.connected) connection.sendUnequipItem(slot);
};
window._dropSlot = (idx) => {
  if (connection?.connected) connection.sendDropItem(idx);
};

// ── Minimap ─────────────────────────────────────────────────
function updateMinimap() {
  if (!minimapCanvas) return;
  const ctx = minimapCanvas.getContext('2d');
  const size = minimapCanvas.width;
  const radius = 32; // blocks shown in each direction

  const px = Math.floor(controller.position.x);
  const pz = Math.floor(controller.position.z);

  ctx.fillStyle = '#0a0a1e';
  ctx.fillRect(0, 0, size, size);

  const scale = size / (radius * 2);

  // Draw terrain
  for (let dx = -radius; dx < radius; dx += 2) {
    for (let dz = -radius; dz < radius; dz += 2) {
      const wx = px + dx;
      const wz = pz + dz;

      // Find top block
      let topBlock = 0;
      for (let y = CHUNK_HEIGHT - 1; y >= 0; y--) {
        const b = voxelWorld.getBlock(wx, y, wz);
        if (b !== 0) { topBlock = b; break; }
      }

      if (topBlock === 0) continue;

      const color = blockColor(topBlock);
      const r = (color >> 16) & 0xff;
      const g = (color >> 8) & 0xff;
      const b = color & 0xff;
      ctx.fillStyle = `rgb(${r},${g},${b})`;

      const sx = (dx + radius) * scale;
      const sy = (dz + radius) * scale;
      ctx.fillRect(sx, sy, scale * 2 + 1, scale * 2 + 1);
    }
  }

  // Draw mobs on minimap
  if (mobRenderer) {
    for (const [, mob] of mobRenderer.mobs) {
      const dx = mob.group.position.x - px;
      const dz = mob.group.position.z - pz;
      if (Math.abs(dx) > radius || Math.abs(dz) > radius) continue;

      const mobColor = mob.def.color;
      const mr = (mobColor >> 16) & 0xff;
      const mg = (mobColor >> 8) & 0xff;
      const mb = mobColor & 0xff;
      ctx.fillStyle = `rgb(${mr},${mg},${mb})`;
      const sx = (dx + radius) * scale;
      const sy = (dz + radius) * scale;
      ctx.beginPath();
      ctx.arc(sx, sy, 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Draw other players
  for (const [, p] of remotePlayers.players) {
    const dx = p.group.position.x - px;
    const dz = p.group.position.z - pz;
    if (Math.abs(dx) > radius || Math.abs(dz) > radius) continue;

    ctx.fillStyle = p.isAgent ? '#9B30FF' : '#00E5FF';
    const sx = (dx + radius) * scale;
    const sy = (dz + radius) * scale;
    ctx.beginPath();
    ctx.arc(sx, sy, 3, 0, Math.PI * 2);
    ctx.fill();
  }

  // Draw items on minimap
  if (itemRenderer) {
    for (const [, item] of itemRenderer.worldItems) {
      const dx = item.group.position.x - px;
      const dz = item.group.position.z - pz;
      if (Math.abs(dx) > radius || Math.abs(dz) > radius) continue;

      const rarityColors = ['#aaa', '#5f5', '#55f', '#a5f', '#fa0'];
      ctx.fillStyle = rarityColors[item.def?.rarity ?? 0];
      const sx = (dx + radius) * scale;
      const sy = (dz + radius) * scale;
      ctx.fillRect(sx - 1, sy - 1, 2, 2);
    }
  }

  // Draw self (center)
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, 3, 0, Math.PI * 2);
  ctx.fill();

  // Direction indicator
  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(size / 2, size / 2);
  ctx.lineTo(size / 2 + dir.x * 8, size / 2 + dir.z * 8);
  ctx.stroke();
}

// ── Activity Feed ───────────────────────────────────────────
function addActivity(name, action, isBot = false) {
  if (!activityFeed) return;

  const div = document.createElement('div');
  div.className = 'activity-item' + (isBot ? ' bot' : '');
  div.innerHTML = `<strong>${name}</strong> ${action}`;

  activityFeed.appendChild(div);
  activityFeed.scrollTop = activityFeed.scrollHeight;

  // Fade out after 8s
  setTimeout(() => {
    div.style.opacity = '0';
    setTimeout(() => div.remove(), 500);
  }, 8000);

  // Keep last 20
  while (activityFeed.children.length > 20) {
    activityFeed.removeChild(activityFeed.firstChild);
  }
}

// ── Hotbar ──────────────────────────────────────────────────
function buildHotbar() {
  hotbarEl.innerHTML = '';
  hotbar.forEach((blockId, i) => {
    const slot = document.createElement('div');
    slot.className = 'hotbar-slot' + (i === selectedSlot ? ' selected' : '');

    const num = document.createElement('span');
    num.className = 'slot-num';
    num.textContent = i + 1;
    slot.appendChild(num);

    const preview = document.createElement('div');
    preview.className = 'block-preview';
    const color = blockColor(blockId);
    preview.style.backgroundColor = '#' + color.toString(16).padStart(6, '0');
    if (isEmissive(blockId)) {
      preview.style.boxShadow = `0 0 8px #${color.toString(16).padStart(6, '0')}`;
    }
    preview.title = blockName(blockId);
    slot.appendChild(preview);

    hotbarEl.appendChild(slot);
  });
}

// ── Keyboard shortcuts ──────────────────────────────────────
document.addEventListener('keydown', (e) => {
  if (e.code >= 'Digit1' && e.code <= 'Digit9' && !chatOpen) {
    selectedSlot = parseInt(e.code.replace('Digit', '')) - 1;
    if (selectedSlot < hotbar.length) buildHotbar();
    return;
  }

  if (e.code === 'KeyF' && !chatOpen && controller.locked) {
    e.preventDefault();
    const isFlying = controller.toggleFly();
    if (flyIndicator) {
      flyIndicator.classList.toggle('active', isFlying);
    }
    return;
  }

  if (e.code === 'KeyE' && !chatOpen && controller.locked) {
    e.preventDefault();
    pickUpNearestItem();
    return;
  }

  if (e.code === 'KeyI' && !chatOpen && controller.locked) {
    e.preventDefault();
    toggleInventoryPanel();
    return;
  }

  if (e.code === 'KeyT' && !chatOpen && controller.locked) {
    e.preventDefault();
    openChat();
    return;
  }

  if (e.code === 'Enter' && chatOpen) {
    const text = chatInput.value.trim();
    if (text && connection?.connected) {
      connection.sendChat(text);
    }
    closeChat();
    return;
  }

  if (e.code === 'Escape' && chatOpen) {
    closeChat();
    return;
  }

  if (e.code === 'Tab') {
    e.preventDefault();
    if (!tabHeld) {
      tabHeld = true;
      playerList.classList.add('active');
      updatePlayerList();
    }
  }
});

document.addEventListener('keyup', (e) => {
  if (e.code === 'Tab') {
    tabHeld = false;
    playerList.classList.remove('active');
  }
});

// ── Chat ────────────────────────────────────────────────────
function openChat() {
  chatOpen = true;
  chatInputWrap.classList.add('open');
  chatInput.focus();
  document.exitPointerLock();
}

function closeChat() {
  chatOpen = false;
  chatInput.value = '';
  chatInputWrap.classList.remove('open');
}

function addChatMessage(name, text, type = 'normal') {
  const div = document.createElement('div');
  div.className = 'chat-msg' + (type === 'system' ? ' system' : '');

  if (type === 'system') {
    div.textContent = text;
  } else {
    if (type === 'bot') {
      const badge = document.createElement('span');
      badge.className = 'bot-badge';
      badge.textContent = 'BOT';
      div.appendChild(badge);
    }
    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = name + ': ';
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    nameSpan.style.color = `hsl(${hue}, 70%, 70%)`;
    div.appendChild(nameSpan);
    div.appendChild(document.createTextNode(text));
  }

  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;

  while (chatLog.children.length > 100) chatLog.removeChild(chatLog.firstChild);
}

function updatePlayerList() {
  playerEntries.innerHTML = '';
  addPlayerEntry(myProfile?.displayName ?? 'You', myProfile?.appearance?.primaryColor ?? '#9B30FF');
  for (const [, p] of onlinePlayers) {
    addPlayerEntry(p.name, p.profile?.appearance?.primaryColor ?? '#888', p.isAgent);
  }
}

function addPlayerEntry(name, color, isAgent = false) {
  const div = document.createElement('div');
  div.className = 'player-entry';
  const dot = document.createElement('div');
  dot.className = 'player-dot';
  dot.style.backgroundColor = color;
  div.appendChild(dot);
  div.appendChild(document.createTextNode(name));
  if (isAgent) {
    const badge = document.createElement('span');
    badge.className = 'bot-badge';
    badge.textContent = 'BOT';
    badge.style.marginLeft = '6px';
    div.appendChild(badge);
  }
  playerEntries.appendChild(div);
}

// ── Mob targeting (crosshair raycast against mob hitboxes) ───
function findMobInCrosshair() {
  if (!mobRenderer || !controller.locked) return null;

  const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
  const origin = camera.position;
  const maxDist = 6;

  let closestId = null;
  let closestDist = maxDist;

  for (const [id, mob] of mobRenderer.mobs) {
    const mobPos = mob.group.position;
    const def = mob.def;
    const hw = (def.bodyW || 0.8) / 2 + 0.2;
    const hh = (def.hasLegs ? def.legH + def.bodyH : def.bodyH) + 0.2;

    // Simple ray-AABB test
    const toMob = new THREE.Vector3().subVectors(mobPos, origin);
    const t = toMob.dot(dir);
    if (t < 0 || t > maxDist) continue;

    const closest = new THREE.Vector3().copy(origin).addScaledVector(dir, t);
    const dx = Math.abs(closest.x - mobPos.x);
    const dy = closest.y - mobPos.y;
    const dz = Math.abs(closest.z - mobPos.z);

    if (dx < hw && dz < hw && dy > -0.2 && dy < hh) {
      if (t < closestDist) {
        closestDist = t;
        closestId = id;
      }
    }
  }
  return closestId;
}

// ── Hurt overlay ─────────────────────────────────────────────
const hurtOverlayEl = document.createElement('div');
hurtOverlayEl.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:50;transition:opacity 0.15s';
document.body.appendChild(hurtOverlayEl);

// Update hurt overlay each frame (driven from game loop via hurtOverlay variable)
const _origGameLoop = gameLoop;
// Patch: render hurt overlay after main render
const _hurtOverlayUpdate = () => {
  if (hurtOverlay > 0) {
    hurtOverlayEl.style.background = `rgba(255,0,0,${Math.min(hurtOverlay, 0.3)})`;
  } else {
    hurtOverlayEl.style.background = 'transparent';
  }
};
// Hook into animation frame
const _origRAF = requestAnimationFrame;
(function patchLoop() {
  const origRender = renderer.render.bind(renderer);
  renderer.render = function(s, c) {
    origRender(s, c);
    _hurtOverlayUpdate();
  };
})();

// Welcome message
addChatMessage(null, 'Welcome to BotCraft. Press T to chat.', 'system');
