/**
 * Rich avatar system for remote players and bots.
 *
 * Each Molty has a full voxel body with:
 * - Head with face (eyes, mouth)
 * - Torso in their primary color
 * - Arms and legs that swing when walking
 * - Personality-driven accessories (hats, backpacks, capes, etc.)
 * - Glowing aura for bot agents
 * - Floating name tag with traits
 */

import * as THREE from 'three';

// Avatar dimensions
const HEAD_SIZE = 0.44;
const TORSO_W = 0.5;
const TORSO_H = 0.7;
const TORSO_D = 0.28;
const ARM_W = 0.18;
const ARM_H = 0.55;
const LEG_W = 0.2;
const LEG_H = 0.55;

// Trait → accessory mapping
const TRAIT_ACCESSORIES = {
  adventurous: 'explorer_hat',
  builder: 'hard_hat',
  curious: 'antenna',
  resourceful: 'backpack',
  creative: 'beret',
  wise: 'monocle',
  friendly: 'flower',
  brave: 'cape',
  social: 'scarf',
  analytical: 'visor',
};

// Walk animation constants
const WALK_SWING_SPEED = 8;
const WALK_SWING_ANGLE = 0.6;
const IDLE_BOB_SPEED = 1.5;
const IDLE_BOB_AMOUNT = 0.015;

export class RemotePlayers {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.players = new Map();
    this.clock = 0;
  }

  addPlayer(accountId, name, profile, pos) {
    if (this.players.has(accountId)) return;

    const primary = new THREE.Color(profile?.appearance?.primaryColor ?? '#9B30FF');
    const secondary = new THREE.Color(profile?.appearance?.secondaryColor ?? '#00E5FF');
    const traits = profile?.personality?.traits ?? [];
    const isAgent = !!profile?.isAgent;

    const group = new THREE.Group();

    // ── Torso ──
    const torso = _box(TORSO_W, TORSO_H, TORSO_D, primary);
    torso.position.y = LEG_H + TORSO_H / 2;
    group.add(torso);

    // ── Head ──
    const head = _box(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE, secondary);
    head.position.y = LEG_H + TORSO_H + HEAD_SIZE / 2 + 0.04;
    group.add(head);

    // ── Face ──
    _addFace(group, LEG_H + TORSO_H + HEAD_SIZE / 2);

    // ── Arms (pivot at shoulder) ──
    const armColor = primary.clone().multiplyScalar(0.82);
    const leftArmPivot = new THREE.Group();
    leftArmPivot.position.set(-(TORSO_W / 2 + ARM_W / 2 + 0.02), LEG_H + TORSO_H - 0.02, 0);
    leftArmPivot.add(_limb(ARM_W, ARM_H, armColor));
    group.add(leftArmPivot);

    const rightArmPivot = new THREE.Group();
    rightArmPivot.position.set(TORSO_W / 2 + ARM_W / 2 + 0.02, LEG_H + TORSO_H - 0.02, 0);
    rightArmPivot.add(_limb(ARM_W, ARM_H, armColor));
    group.add(rightArmPivot);

    // ── Legs (pivot at hip) ──
    const legColor = primary.clone().multiplyScalar(0.65);
    const leftLegPivot = new THREE.Group();
    leftLegPivot.position.set(-0.1, LEG_H, 0);
    leftLegPivot.add(_limb(LEG_W, LEG_H, legColor));
    group.add(leftLegPivot);

    const rightLegPivot = new THREE.Group();
    rightLegPivot.position.set(0.1, LEG_H, 0);
    rightLegPivot.add(_limb(LEG_W, LEG_H, legColor));
    group.add(rightLegPivot);

    // ── Personality Accessory ──
    _addAccessory(group, traits, primary, secondary);

    // ── Bot glow ──
    let botGlow = null;
    if (isAgent) {
      botGlow = new THREE.PointLight(primary.getHex(), 0.5, 6);
      botGlow.position.y = LEG_H + TORSO_H / 2;
      group.add(botGlow);
    }

    // ── Name tag ──
    const nameSprite = _createNameSprite(name, traits, isAgent);
    nameSprite.position.y = LEG_H + TORSO_H + HEAD_SIZE + 0.6;
    group.add(nameSprite);

    const startPos = new THREE.Vector3(pos?.x ?? 0, (pos?.y ?? 0) - 1.7, pos?.z ?? 0);
    group.position.copy(startPos);
    this.scene.add(group);

    this.players.set(accountId, {
      group,
      targetPos: startPos.clone(),
      name,
      isAgent,
      leftArmPivot,
      rightArmPivot,
      leftLegPivot,
      rightLegPivot,
      head,
      torso,
      botGlow,
      walkPhase: 0,
      speed: 0,
    });
  }

  removePlayer(accountId) {
    const entry = this.players.get(accountId);
    if (!entry) return;
    this.scene.remove(entry.group);
    entry.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    this.players.delete(accountId);
  }

  updatePosition(accountId, pos) {
    const entry = this.players.get(accountId);
    if (!entry) return;
    entry.targetPos.set(pos.x, pos.y - 1.7, pos.z);
  }

  /** Smooth interpolation + walk/idle animation each frame */
  update(dt) {
    this.clock += dt;

    for (const [, entry] of this.players) {
      // Smooth movement
      const prevPos = entry.group.position.clone();
      entry.group.position.lerp(entry.targetPos, Math.min(1, dt * 10));

      // Calculate speed for walk animation
      const delta = entry.group.position.clone().sub(prevPos);
      delta.y = 0;
      const instantSpeed = delta.length() / Math.max(dt, 0.001);
      entry.speed = THREE.MathUtils.lerp(entry.speed, instantSpeed, dt * 8);

      // ── Walk animation ──
      const isWalking = entry.speed > 0.3;
      if (isWalking) {
        entry.walkPhase += dt * WALK_SWING_SPEED;
        const swing = Math.sin(entry.walkPhase) * WALK_SWING_ANGLE * Math.min(1, entry.speed / 3);

        entry.leftArmPivot.rotation.x = swing;
        entry.rightArmPivot.rotation.x = -swing;
        entry.leftLegPivot.rotation.x = -swing;
        entry.rightLegPivot.rotation.x = swing;

        // Face direction of movement
        if (delta.lengthSq() > 0.0001) {
          const targetAngle = Math.atan2(delta.x, delta.z);
          let diff = targetAngle - entry.group.rotation.y;
          while (diff > Math.PI) diff -= Math.PI * 2;
          while (diff < -Math.PI) diff += Math.PI * 2;
          entry.group.rotation.y += diff * Math.min(1, dt * 8);
        }
      } else {
        // Return to idle pose
        entry.leftArmPivot.rotation.x *= 0.9;
        entry.rightArmPivot.rotation.x *= 0.9;
        entry.leftLegPivot.rotation.x *= 0.9;
        entry.rightLegPivot.rotation.x *= 0.9;
      }

      // ── Idle breathing ──
      const breath = Math.sin(this.clock * IDLE_BOB_SPEED) * IDLE_BOB_AMOUNT;
      entry.torso.scale.y = 1 + breath;
      entry.head.position.y = LEG_H + TORSO_H + HEAD_SIZE / 2 + 0.04 + breath * 2;

      // ── Bot glow pulse ──
      if (entry.botGlow) {
        entry.botGlow.intensity = 0.3 + Math.sin(this.clock * 2) * 0.2;
      }

      // Name tags face camera
      for (const child of entry.group.children) {
        if (child.isSprite) {
          child.lookAt(this.camera.position);
        }
      }
    }
  }
}

// ── Helper functions ──────────────────────────────────────

function _box(w, h, d, color) {
  return new THREE.Mesh(
    new THREE.BoxGeometry(w, h, d),
    new THREE.MeshLambertMaterial({ color }),
  );
}

function _limb(w, h, color) {
  const mesh = _box(w, h, w, color);
  mesh.position.y = -h / 2;
  return mesh;
}

function _addFace(group, headCenterY) {
  const eyeWhiteMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
  const pupilMat = new THREE.MeshBasicMaterial({ color: 0x111111 });

  // Left eye
  const lEye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.02), eyeWhiteMat);
  lEye.position.set(-0.1, headCenterY + 0.06, HEAD_SIZE / 2 + 0.01);
  group.add(lEye);
  const lPupil = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), pupilMat);
  lPupil.position.set(-0.1, headCenterY + 0.06, HEAD_SIZE / 2 + 0.02);
  group.add(lPupil);

  // Right eye
  const rEye = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.02), eyeWhiteMat);
  rEye.position.set(0.1, headCenterY + 0.06, HEAD_SIZE / 2 + 0.01);
  group.add(rEye);
  const rPupil = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.05, 0.02), pupilMat);
  rPupil.position.set(0.1, headCenterY + 0.06, HEAD_SIZE / 2 + 0.02);
  group.add(rPupil);

  // Mouth
  const mouthMat = new THREE.MeshBasicMaterial({ color: 0x333333 });
  const mouth = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.03, 0.02), mouthMat);
  mouth.position.set(0, headCenterY - 0.06, HEAD_SIZE / 2 + 0.01);
  group.add(mouth);
}

function _addAccessory(group, traits, primary, secondary) {
  const headTop = LEG_H + TORSO_H + HEAD_SIZE;

  for (const trait of traits) {
    const type = TRAIT_ACCESSORIES[trait];
    if (!type) continue;

    switch (type) {
      case 'explorer_hat': {
        const brim = _box(0.6, 0.05, 0.6, new THREE.Color(0x8B4513));
        brim.position.y = headTop + 0.06;
        group.add(brim);
        const crown = _box(0.34, 0.14, 0.34, new THREE.Color(0x6B3410));
        crown.position.y = headTop + 0.15;
        group.add(crown);
        return;
      }
      case 'hard_hat': {
        const hat = _box(0.52, 0.1, 0.52, new THREE.Color(0xFFD700));
        hat.position.y = headTop + 0.08;
        group.add(hat);
        return;
      }
      case 'antenna': {
        const pole = _box(0.03, 0.22, 0.03, new THREE.Color(0xcccccc));
        pole.position.y = headTop + 0.15;
        group.add(pole);
        const tip = new THREE.Mesh(
          new THREE.SphereGeometry(0.055, 8, 8),
          new THREE.MeshBasicMaterial({ color: secondary }),
        );
        tip.position.y = headTop + 0.3;
        group.add(tip);
        return;
      }
      case 'backpack': {
        const pack = _box(0.32, 0.36, 0.18, primary.clone().multiplyScalar(0.55));
        pack.position.set(0, LEG_H + TORSO_H * 0.65, -(TORSO_D / 2 + 0.11));
        group.add(pack);
        return;
      }
      case 'beret': {
        const beret = _box(0.42, 0.07, 0.42, new THREE.Color(0xCC3333));
        beret.position.set(0.06, headTop + 0.05, 0);
        group.add(beret);
        return;
      }
      case 'monocle': {
        const ring = new THREE.Mesh(
          new THREE.TorusGeometry(0.065, 0.012, 8, 16),
          new THREE.MeshBasicMaterial({ color: 0xFFD700 }),
        );
        ring.position.set(0.1, LEG_H + TORSO_H + HEAD_SIZE / 2 + 0.06, HEAD_SIZE / 2 + 0.03);
        ring.rotation.y = Math.PI / 2;
        group.add(ring);
        return;
      }
      case 'flower': {
        const stem = _box(0.03, 0.14, 0.03, new THREE.Color(0x228B22));
        stem.position.set(HEAD_SIZE / 2 + 0.04, headTop - 0.1, 0);
        group.add(stem);
        const petals = new THREE.Mesh(
          new THREE.SphereGeometry(0.07, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xFF69B4 }),
        );
        petals.position.set(HEAD_SIZE / 2 + 0.04, headTop + 0.01, 0);
        group.add(petals);
        return;
      }
      case 'cape': {
        const cape = _box(0.44, 0.7, 0.04, new THREE.Color(0xCC0000));
        cape.position.set(0, LEG_H + TORSO_H * 0.5, -(TORSO_D / 2 + 0.04));
        group.add(cape);
        return;
      }
      case 'scarf': {
        const scarf = _box(0.54, 0.08, 0.34, new THREE.Color(0x4488FF));
        scarf.position.y = LEG_H + TORSO_H + 0.02;
        group.add(scarf);
        return;
      }
      case 'visor': {
        const visor = _box(0.48, 0.06, 0.08, new THREE.Color(0x00CCFF));
        visor.position.set(0, LEG_H + TORSO_H + HEAD_SIZE / 2 + 0.06, HEAD_SIZE / 2 + 0.05);
        group.add(visor);
        return;
      }
    }
  }
}

function _createNameSprite(name, traits, isAgent) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 320;
  canvas.height = 80;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Background pill
  ctx.fillStyle = isAgent ? 'rgba(139, 92, 246, 0.35)' : 'rgba(0, 0, 0, 0.35)';
  const textWidth = Math.min(300, name.length * 16 + 40);
  const pillX = (canvas.width - textWidth) / 2;
  ctx.beginPath();
  ctx.roundRect(pillX, 2, textWidth, 44, 12);
  ctx.fill();

  // Name text
  ctx.font = 'bold 22px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeText(name, 160, 28);
  ctx.fillText(name, 160, 28);

  // Bot badge
  if (isAgent) {
    const nameW = ctx.measureText(name).width;
    const badgeX = 160 + nameW / 2 + 8;
    ctx.fillStyle = 'rgba(139, 92, 246, 0.6)';
    ctx.beginPath();
    ctx.roundRect(badgeX - 2, 10, 32, 18, 4);
    ctx.fill();
    ctx.font = 'bold 11px monospace';
    ctx.fillStyle = '#E0D0FF';
    ctx.fillText('BOT', badgeX + 14, 24);
  }

  // Trait badges
  if (traits?.length) {
    ctx.font = '13px monospace';
    ctx.fillStyle = '#bbbbee';
    ctx.fillText(traits.slice(0, 3).join(' · '), 160, 62);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(3.5, 0.88, 1);
  return sprite;
}
