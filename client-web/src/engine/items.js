/**
 * Client-side item renderer for BotCraft.
 *
 * Renders items floating and spinning in the world with rarity glow,
 * and draws equipment on remote players/self.
 */

import * as THREE from 'three';
import { ITEMS, RARITY_COLORS, rarityName } from '@shared/items.js';

export class ItemRenderer {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    /** @type {Map<string, WorldItemEntry>} worldItemId -> { group, itemId, ... } */
    this.worldItems = new Map();
    this.clock = 0;
  }

  addWorldItem(id, itemId, pos) {
    if (this.worldItems.has(id)) return;

    const def = ITEMS.get(itemId);
    if (!def) return;

    const group = new THREE.Group();

    // Item body — small colored cube
    const size = 0.35;
    const mat = new THREE.MeshLambertMaterial({ color: def.color });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(size, size, size), mat);
    mesh.position.y = 0;
    group.add(mesh);

    // Rarity glow
    const rarityCol = RARITY_COLORS[def.rarity] ?? 0xAAAAAA;
    if (def.rarity >= 2) {
      const glow = new THREE.PointLight(rarityCol, 0.4, 4);
      glow.position.y = 0;
      group.add(glow);
    }

    // Name tag
    const label = _createItemLabel(def.name, def.rarity);
    label.position.y = 0.6;
    group.add(label);

    group.position.set(pos.x, pos.y, pos.z);
    this.scene.add(group);

    this.worldItems.set(id, {
      group,
      mesh,
      label,
      itemId,
      def,
      baseY: pos.y,
      phase: Math.random() * Math.PI * 2,
    });
  }

  removeWorldItem(id) {
    const entry = this.worldItems.get(id);
    if (!entry) return;
    this.scene.remove(entry.group);
    entry.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    this.worldItems.delete(id);
  }

  update(dt) {
    this.clock += dt;

    for (const [, item] of this.worldItems) {
      // Float bob
      const bob = Math.sin(this.clock * 2 + item.phase) * 0.15;
      item.group.position.y = item.baseY + bob;

      // Spin
      item.mesh.rotation.y = this.clock * 1.5 + item.phase;

      // Label faces camera
      item.label.lookAt(this.camera.position);
    }
  }
}

// ── Equipment visual helper (for remote players) ─────────────

/**
 * Apply equipment visuals to a remote player group.
 * @param {THREE.Group} playerGroup — the player's Three.js group
 * @param {object} equipment — { head, body, legs, feet, mainHand, offHand }
 */
export function applyEquipmentVisuals(playerGroup, equipment) {
  // Remove existing equipment meshes
  const toRemove = [];
  playerGroup.traverse((child) => {
    if (child.userData?.isEquipment) toRemove.push(child);
  });
  toRemove.forEach((child) => {
    playerGroup.remove(child);
    if (child.geometry) child.geometry.dispose();
    if (child.material) child.material.dispose();
  });

  if (!equipment) return;

  // Head item
  if (equipment.head) {
    const headMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.55, 0.2, 0.55),
      new THREE.MeshLambertMaterial({ color: equipment.head.color ?? 0xFFDD00 }),
    );
    headMesh.position.y = 1.95; // on top of head
    headMesh.userData.isEquipment = true;
    playerGroup.add(headMesh);
  }

  // Main hand weapon
  if (equipment.mainHand) {
    const weaponMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.1, 0.5, 0.1),
      new THREE.MeshLambertMaterial({ color: equipment.mainHand.color ?? 0xBBBBCC }),
    );
    weaponMesh.position.set(0.45, 0.9, 0);
    weaponMesh.rotation.z = -0.3;
    weaponMesh.userData.isEquipment = true;
    playerGroup.add(weaponMesh);
  }

  // Off hand shield
  if (equipment.offHand) {
    const shieldMesh = new THREE.Mesh(
      new THREE.BoxGeometry(0.05, 0.4, 0.35),
      new THREE.MeshLambertMaterial({ color: equipment.offHand.color ?? 0x886644 }),
    );
    shieldMesh.position.set(-0.45, 0.9, 0.1);
    shieldMesh.userData.isEquipment = true;
    playerGroup.add(shieldMesh);
  }
}

// ── Helpers ──────────────────────────────────────────────────

function _createItemLabel(name, rarity) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 200;
  canvas.height = 32;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Rarity-colored name
  const colors = ['#aaa', '#5f5', '#55f', '#a5f', '#fa0'];
  ctx.font = 'bold 14px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = colors[rarity] ?? '#aaa';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2;
  ctx.strokeText(name, 100, 16);
  ctx.fillText(name, 100, 16);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(1.8, 0.3, 1);
  return sprite;
}
