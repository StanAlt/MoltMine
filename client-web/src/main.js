/**
 * MoltMine Web Client — Main entry point.
 *
 * Boots the Three.js scene, connects to the server, and runs the game loop.
 */

import * as THREE from 'three';
import { Connection } from './network/connection.js';
import { VoxelWorld } from './engine/voxel-world.js';
import { PlayerController } from './engine/player-controller.js';
import { RemotePlayers } from './engine/remote-players.js';
import { createSky } from './engine/sky.js';
import { S2C, CHUNK_SIZE, CHUNK_HEIGHT } from '@shared/protocol.js';
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

// ── State ───────────────────────────────────────────────────
let connection, voxelWorld, controller, remotePlayers;
let myAccountId = null;
let myProfile = null;
let hotbar = [...DEFAULT_HOTBAR];
let selectedSlot = 0;
let chatOpen = false;
let tabHeld = false;
const onlinePlayers = new Map(); // accountId -> { name, profile }
const biomeNoise = { t: new PerlinNoise(42 + 1000), m: new PerlinNoise(42 + 2000) };

// ── Three.js setup ──────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

createSky(scene);

// ── Join flow ───────────────────────────────────────────────
joinBtn.addEventListener('click', startGame);
nameInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') startGame(); });

async function startGame() {
  const name = nameInput.value.trim();
  if (!name) { nameInput.focus(); return; }

  joinBtn.textContent = 'Connecting...';
  joinBtn.disabled = true;

  try {
    connection = new Connection();
    const wsUrl = location.protocol === 'https:'
      ? `wss://${location.host}`
      : `ws://${location.hostname}:3000`;
    await connection.connect(wsUrl);
    setupNetworkHandlers();
    connection.authenticate(name);
  } catch (err) {
    joinBtn.textContent = 'Enter MoltWorld';
    joinBtn.disabled = false;
    alert('Could not connect to MoltMine server. Is it running?');
  }
}

function setupNetworkHandlers() {
  connection.on(S2C.AUTH_OK, (payload) => {
    myAccountId = payload.accountId;
    myProfile = payload.profile;
    if (payload.hotbar) hotbar = payload.hotbar;

    // Join the world
    connection.joinWorld();
  });

  connection.on(S2C.AUTH_ERROR, (payload) => {
    alert(`Auth error: ${payload.message}`);
    joinBtn.textContent = 'Enter MoltWorld';
    joinBtn.disabled = false;
  });

  connection.on(S2C.WORLD_SNAPSHOT, (payload) => {
    // We have our spawn — enter the game
    if (payload.spawn) {
      controller.position.set(payload.spawn.x, payload.spawn.y, payload.spawn.z);
    }
    enterGame();
  });

  connection.on(S2C.WORLD_CHUNK, (payload) => {
    const { cx, cz, data } = payload;
    // Decode base64 chunk data
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    voxelWorld.setChunkData(cx, cz, bytes);
  });

  connection.on(S2C.PLAYER_JOIN, (payload) => {
    onlinePlayers.set(payload.accountId, { name: payload.name, profile: payload.profile });
    remotePlayers?.addPlayer(payload.accountId, payload.name, payload.profile, payload.pos);
    addChatMessage(null, `${payload.name} entered MoltWorld`, 'system');
    updatePlayerList();
  });

  connection.on(S2C.PLAYER_LEAVE, (payload) => {
    onlinePlayers.delete(payload.accountId);
    remotePlayers?.removePlayer(payload.accountId);
    addChatMessage(null, `${payload.name} left MoltWorld`, 'system');
    updatePlayerList();
  });

  connection.on(S2C.PLAYER_MOVE, (payload) => {
    remotePlayers?.updatePosition(payload.accountId, payload.pos);
  });

  connection.on(S2C.BLOCK_UPDATE, (payload) => {
    const { pos, block } = payload;
    voxelWorld?.updateBlock(pos.x, pos.y, pos.z, block);
  });

  connection.on(S2C.CHAT_MESSAGE, (payload) => {
    addChatMessage(payload.name, payload.text);
  });

  connection.on(S2C.WORLD_EVENT, (payload) => {
    if (payload.kind === 'emote') {
      addChatMessage(null, `${payload.name} ${payload.emote}`, 'system');
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

  buildHotbar();

  // Wait for click to lock pointer
  const lock = () => {
    controller.requestLock();
    clickPrompt.classList.remove('active');
    renderer.domElement.removeEventListener('click', lock);
  };
  renderer.domElement.addEventListener('click', lock);

  // Also re-lock on click if pointer was released
  renderer.domElement.addEventListener('click', () => {
    if (!controller.locked && !chatOpen) {
      controller.requestLock();
      clickPrompt.classList.remove('active');
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

// ── Game loop ───────────────────────────────────────────────
let lastTime = performance.now();
let moveAccum = 0;

function gameLoop(now) {
  requestAnimationFrame(gameLoop);

  const dt = Math.min((now - lastTime) / 1000, 0.1);
  lastTime = now;

  // Player movement
  controller.update(dt);
  remotePlayers.update(dt);

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

  // Update HUD
  updateHUD();

  // Render
  renderer.render(scene, camera);
}

// ── HUD ─────────────────────────────────────────────────────
function updateHUD() {
  const pos = controller.position;
  const bx = Math.floor(pos.x), by = Math.floor(pos.y), bz = Math.floor(pos.z);

  // Get biome at current position
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
  ].filter(Boolean).join('<br>');

  hudRight.innerHTML = [
    `<span class="hud-label">Players</span> ${onlinePlayers.size + 1}`,
    `<span class="hud-label">Chunks</span> ${voxelWorld.chunks.size}`,
  ].join('<br>');
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
  // Number keys for hotbar
  if (e.code >= 'Digit1' && e.code <= 'Digit9' && !chatOpen) {
    selectedSlot = parseInt(e.code.replace('Digit', '')) - 1;
    if (selectedSlot < hotbar.length) buildHotbar();
    return;
  }

  // T to open chat
  if (e.code === 'KeyT' && !chatOpen && controller.locked) {
    e.preventDefault();
    openChat();
    return;
  }

  // Enter to send chat
  if (e.code === 'Enter' && chatOpen) {
    const text = chatInput.value.trim();
    if (text && connection?.connected) {
      connection.sendChat(text);
    }
    closeChat();
    return;
  }

  // Escape to close chat
  if (e.code === 'Escape' && chatOpen) {
    closeChat();
    return;
  }

  // Tab for player list
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
    const nameSpan = document.createElement('span');
    nameSpan.className = 'name';
    nameSpan.textContent = name + ': ';
    // Color the name based on hash
    let hash = 0;
    for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    nameSpan.style.color = `hsl(${hue}, 70%, 70%)`;
    div.appendChild(nameSpan);
    div.appendChild(document.createTextNode(text));
  }

  chatLog.appendChild(div);
  chatLog.scrollTop = chatLog.scrollHeight;

  // Keep last 100 messages
  while (chatLog.children.length > 100) chatLog.removeChild(chatLog.firstChild);
}

function updatePlayerList() {
  playerEntries.innerHTML = '';
  // Add self
  addPlayerEntry(myProfile?.displayName ?? 'You', myProfile?.appearance?.primaryColor ?? '#9B30FF');
  // Add others
  for (const [, p] of onlinePlayers) {
    addPlayerEntry(p.name, p.profile?.appearance?.primaryColor ?? '#888');
  }
}

function addPlayerEntry(name, color) {
  const div = document.createElement('div');
  div.className = 'player-entry';
  const dot = document.createElement('div');
  dot.className = 'player-dot';
  dot.style.backgroundColor = color;
  div.appendChild(dot);
  div.appendChild(document.createTextNode(name));
  playerEntries.appendChild(div);
}

// Welcome message
addChatMessage(null, 'Welcome to MoltWorld! Press T to chat.', 'system');
