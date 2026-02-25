/**
 * Client-side item renderer for BotCraft.
 *
 * Renders items floating and spinning in the world with rarity glow,
 * and draws equipment on remote players/self.
 * Uses detailed procedural geometry per item category.
 */

import * as THREE from 'three';
import { ITEMS, RARITY_COLORS, rarityName } from '@shared/items.js';

// ── Procedural item model builders ──────────────────────────

function _buildSwordModel(color, rarity) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.5) });
  const accentMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).lerp(new THREE.Color(0xFFFFFF), 0.4) });

  // Blade
  const bladeH = 0.35 + rarity * 0.04;
  const blade = new THREE.Mesh(new THREE.BoxGeometry(0.06, bladeH, 0.02), accentMat);
  blade.position.y = bladeH / 2 + 0.08;
  group.add(blade);

  // Blade tip (tapered)
  const tip = new THREE.Mesh(new THREE.ConeGeometry(0.03, 0.08, 4), accentMat);
  tip.position.y = bladeH + 0.12;
  group.add(tip);

  // Crossguard
  const guard = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.03, 0.04), mat);
  guard.position.y = 0.08;
  group.add(guard);

  // Grip
  const grip = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.1, 0.04), darkMat);
  grip.position.y = 0;
  group.add(grip);

  // Pommel
  const pommel = new THREE.Mesh(new THREE.SphereGeometry(0.03, 6, 4), mat);
  pommel.position.y = -0.06;
  group.add(pommel);

  return group;
}

function _buildShieldModel(color, rarity) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const trimMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.6) });

  // Shield face
  const face = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.35, 0.03), mat);
  group.add(face);

  // Shield rim (4 edges)
  const rimW = 0.02;
  const rimTop = new THREE.Mesh(new THREE.BoxGeometry(0.28, rimW, 0.04), trimMat);
  rimTop.position.y = 0.175;
  group.add(rimTop);
  const rimBot = new THREE.Mesh(new THREE.BoxGeometry(0.28, rimW, 0.04), trimMat);
  rimBot.position.y = -0.175;
  group.add(rimBot);
  const rimL = new THREE.Mesh(new THREE.BoxGeometry(rimW, 0.35, 0.04), trimMat);
  rimL.position.x = -0.14;
  group.add(rimL);
  const rimR = new THREE.Mesh(new THREE.BoxGeometry(rimW, 0.35, 0.04), trimMat);
  rimR.position.x = 0.14;
  group.add(rimR);

  // Boss (center emblem)
  if (rarity >= 2) {
    const boss = new THREE.Mesh(new THREE.SphereGeometry(0.04, 8, 6), trimMat);
    boss.position.z = 0.02;
    group.add(boss);
  }

  // Handle (back)
  const handle = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.12, 0.04), trimMat);
  handle.position.z = -0.035;
  group.add(handle);

  return group;
}

function _buildHatModel(color, rarity) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.7) });

  // Crown
  const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.14, 0.12, 8), mat);
  crown.position.y = 0.06;
  group.add(crown);

  // Brim
  const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.22, 0.02, 8), darkMat);
  brim.position.y = -0.01;
  group.add(brim);

  // Band
  const band = new THREE.Mesh(new THREE.CylinderGeometry(0.145, 0.145, 0.025, 8), darkMat);
  band.position.y = 0.015;
  group.add(band);

  // Top embellishment for rarer hats
  if (rarity >= 3) {
    const gem = new THREE.Mesh(new THREE.OctahedronGeometry(0.025, 0), new THREE.MeshBasicMaterial({ color: RARITY_COLORS[rarity] }));
    gem.position.y = 0.13;
    group.add(gem);
  }

  return group;
}

function _buildArmorModel(color, rarity) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const darkMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.7) });

  // Chest plate
  const chest = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.3, 0.08), mat);
  group.add(chest);

  // Shoulder plates
  const shoulderL = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), darkMat);
  shoulderL.position.set(-0.16, 0.13, 0);
  shoulderL.rotation.z = 0.3;
  group.add(shoulderL);
  const shoulderR = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.1), darkMat);
  shoulderR.position.set(0.16, 0.13, 0);
  shoulderR.rotation.z = -0.3;
  group.add(shoulderR);

  // Belt
  const belt = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.03, 0.09), darkMat);
  belt.position.y = -0.14;
  group.add(belt);

  return group;
}

function _buildBootModel(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });
  const soleMat = new THREE.MeshLambertMaterial({ color: new THREE.Color(color).multiplyScalar(0.5) });

  // Boot shaft
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.1), mat);
  shaft.position.y = 0.04;
  group.add(shaft);

  // Toe
  const toe = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.06, 0.06), mat);
  toe.position.set(0, -0.03, 0.06);
  group.add(toe);

  // Sole
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.02, 0.16), soleMat);
  sole.position.set(0, -0.06, 0.02);
  group.add(sole);

  return group;
}

function _buildLegsModel(color) {
  const group = new THREE.Group();
  const mat = new THREE.MeshLambertMaterial({ color });

  // Left leg
  const legL = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), mat);
  legL.position.set(-0.06, 0, 0);
  group.add(legL);

  // Right leg
  const legR = new THREE.Mesh(new THREE.BoxGeometry(0.08, 0.22, 0.08), mat);
  legR.position.set(0.06, 0, 0);
  group.add(legR);

  // Waistband
  const waist = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.09), mat);
  waist.position.y = 0.12;
  group.add(waist);

  return group;
}

function _buildAccessoryModel(color, rarity) {
  const group = new THREE.Group();

  // Ring / amulet shape — torus for rare+, sphere for common
  if (rarity >= 2) {
    const torus = new THREE.Mesh(
      new THREE.TorusGeometry(0.08, 0.02, 8, 12),
      new THREE.MeshLambertMaterial({ color }),
    );
    group.add(torus);
    // Gem
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.03, 0),
      new THREE.MeshBasicMaterial({ color: RARITY_COLORS[rarity] }),
    );
    gem.position.y = 0.08;
    group.add(gem);
  } else {
    const sphere = new THREE.Mesh(
      new THREE.SphereGeometry(0.08, 8, 6),
      new THREE.MeshLambertMaterial({ color }),
    );
    group.add(sphere);
  }

  return group;
}

/**
 * Build a detailed procedural item model based on category.
 */
function _buildItemModel(def) {
  switch (def.category) {
    case 'weapon':    return _buildSwordModel(def.color, def.rarity);
    case 'shield':    return _buildShieldModel(def.color, def.rarity);
    case 'hat':       return _buildHatModel(def.color, def.rarity);
    case 'body':      return _buildArmorModel(def.color, def.rarity);
    case 'feet':      return _buildBootModel(def.color);
    case 'legs':      return _buildLegsModel(def.color);
    case 'accessory': return _buildAccessoryModel(def.color, def.rarity);
    default: {
      // Fallback: colored cube
      const mat = new THREE.MeshLambertMaterial({ color: def.color });
      return new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), mat);
    }
  }
}

// ── Main renderer ───────────────────────────────────────────

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

    // Build detailed model for this item category
    const model = _buildItemModel(def);
    model.scale.setScalar(0.7);
    group.add(model);

    // Rarity glow
    const rarityCol = RARITY_COLORS[def.rarity] ?? 0xAAAAAA;
    if (def.rarity >= 2) {
      const glow = new THREE.PointLight(rarityCol, 0.5, 5);
      glow.position.y = 0;
      group.add(glow);
    }

    // Rarity particle ring for epic/legendary
    if (def.rarity >= 3) {
      const ringMat = new THREE.MeshBasicMaterial({ color: rarityCol, transparent: true, opacity: 0.4 });
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.35, 0.01, 6, 24), ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = -0.1;
      group.add(ring);
    }

    // Name tag
    const label = _createItemLabel(def.name, def.rarity);
    label.position.y = 0.7;
    group.add(label);

    group.position.set(pos.x, pos.y, pos.z);
    this.scene.add(group);

    this.worldItems.set(id, {
      group,
      model,
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
      item.group.position.y = item.baseY + 0.3 + bob;

      // Spin
      item.model.rotation.y = this.clock * 1.5 + item.phase;

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

  // Head item — detailed hat
  if (equipment.head) {
    const hat = _buildHatModel(equipment.head.color ?? 0xFFDD00, equipment.head.rarity ?? 0);
    hat.scale.setScalar(0.9);
    hat.position.y = 1.9;
    hat.userData.isEquipment = true;
    hat.traverse((c) => { c.userData.isEquipment = true; });
    playerGroup.add(hat);
  }

  // Body armor
  if (equipment.body) {
    const armor = _buildArmorModel(equipment.body.color ?? 0x886644, equipment.body.rarity ?? 0);
    armor.scale.setScalar(0.6);
    armor.position.y = 1.2;
    armor.userData.isEquipment = true;
    armor.traverse((c) => { c.userData.isEquipment = true; });
    playerGroup.add(armor);
  }

  // Main hand weapon — detailed sword
  if (equipment.mainHand) {
    const sword = _buildSwordModel(equipment.mainHand.color ?? 0xBBBBCC, equipment.mainHand.rarity ?? 0);
    sword.scale.setScalar(0.7);
    sword.position.set(0.45, 0.9, 0);
    sword.rotation.z = -0.3;
    sword.userData.isEquipment = true;
    sword.traverse((c) => { c.userData.isEquipment = true; });
    playerGroup.add(sword);
  }

  // Off hand shield — detailed shield
  if (equipment.offHand) {
    const cat = equipment.offHand.category;
    if (cat === 'shield') {
      const shield = _buildShieldModel(equipment.offHand.color ?? 0x886644, equipment.offHand.rarity ?? 0);
      shield.scale.setScalar(0.6);
      shield.position.set(-0.45, 0.95, 0.1);
      shield.userData.isEquipment = true;
      shield.traverse((c) => { c.userData.isEquipment = true; });
      playerGroup.add(shield);
    } else {
      // Accessory
      const acc = _buildAccessoryModel(equipment.offHand.color ?? 0xDDAA22, equipment.offHand.rarity ?? 0);
      acc.scale.setScalar(0.5);
      acc.position.set(-0.4, 1.0, 0);
      acc.userData.isEquipment = true;
      acc.traverse((c) => { c.userData.isEquipment = true; });
      playerGroup.add(acc);
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────

function _createItemLabel(name, rarity) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 256;
  canvas.height = 40;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Rarity-colored name with shadow
  const colors = ['#aaa', '#5f5', '#55f', '#a5f', '#fa0'];
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';

  // Drop shadow
  ctx.fillStyle = '#000';
  ctx.fillText(name, 129, 22);

  // Main text
  ctx.fillStyle = colors[rarity] ?? '#aaa';
  ctx.strokeStyle = '#000';
  ctx.lineWidth = 2.5;
  ctx.strokeText(name, 128, 21);
  ctx.fillText(name, 128, 21);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.0, 0.32, 1);
  return sprite;
}
