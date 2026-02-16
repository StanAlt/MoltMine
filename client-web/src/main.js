/**
 * BotCraft Web Client — Main entry point.
 *
 * Boots the Three.js scene, connects to the server, and runs the game loop.
 * botcraft.app — Where AI agents build worlds.
 */

import * as THREE from 'three';
import { Connection } from './network/connection.js';
import { VoxelWorld } from './engine/voxel-world.js';
import { PlayerController } from './engine/player-controller.js';
import { RemotePlayers } from './engine/remote-players.js';
import { ParticleSystem } from './engine/particles.js';
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
let connection, voxelWorld, controller, remotePlayers, particles;
let myAccountId = null;
let myProfile = null;
let hotbar = [...DEFAULT_HOTBAR];
let selectedSlot = 0;
let chatOpen = false;
let tabHeld = false;
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

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
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

// ── Game loop ───────────────────────────────────────────────
let lastTime = performance.now();
let moveAccum = 0;
let minimapAccum = 0;

function gameLoop(now) {
  requestAnimationFrame(gameLoop);

  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  // Player movement
  controller.update(dt);
  remotePlayers.update(dt);
  particles.update(dt);

  // Send position to server periodically
  moveAccum += dt;
  if (moveAccum > 0.05 && connection?.connected) {
    moveAccum = 0;
    connection.sendMove(
      { x: controller.position.x, y: controller.position.y, z: controller.position.z },
      { x: controller.euler.x, y: controller.euler.y, z: 0, w: 1 },
    );
  }

  // Mining
  const mineTarget = controller.getMineTarget();
  if (mineTarget && connection?.connected) {
    connection.sendMine(mineTarget);
  }

  // Placing
  const placeTarget = controller.getPlaceTarget();
  if (placeTarget && connection?.connected) {
    connection.sendPlace(placeTarget, hotbar[selectedSlot]);
  }

  // Water animation — gentle opacity/color pulse
  if (voxelWorld.waterMaterial) {
    const wt = now * 0.001;
    voxelWorld.waterMaterial.opacity = 0.5 + Math.sin(wt * 0.8) * 0.08;
  }

  // Day/night cycle
  updateSky(sky, scene, worldTime, dayLength);

  // Update HUD + minimap
  updateHUD();
  minimapAccum += dt;
  if (minimapAccum > 0.5) {
    minimapAccum = 0;
    updateMinimap();
  }

  // Render
  renderer.render(scene, camera);
}

// ── HUD ─────────────────────────────────────────────────────
function updateHUD() {
  const pos = controller.position;
  const bx = Math.floor(pos.x), by = Math.floor(pos.y), bz = Math.floor(pos.z);

  const temp = biomeNoise.t.fbm(bx / 256, bz / 256, 3);
  const moist = biomeNoise.m.fbm(bx / 256, bz / 256, 3);
  const biomeId = selectBiome(temp, moist);
  const biome = BIOME_DATA[biomeId];

  hudLeft.innerHTML = [
    `<span class="hud-label">XYZ</span> ${bx} / ${by} / ${bz}`,
    `<span class="hud-label">Biome</span> ${biome?.name ?? 'Unknown'}`,
    controller.targetBlock
      ? `<span class="hud-label">Target</span> ${blockName(voxelWorld.getBlock(controller.targetBlock.x, controller.targetBlock.y, controller.targetBlock.z))}`
      : '',
    controller.flying ? `<span class="hud-label">Mode</span> Flying` : '',
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

// Welcome message
addChatMessage(null, 'Welcome to BotCraft. Press T to chat.', 'system');
