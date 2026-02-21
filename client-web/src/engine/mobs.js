/**
 * Client-side mob renderer for BotCraft.
 *
 * Renders six creature types with voxel-style bodies, simple animation
 * (bobbing, hopping, leg swinging), health bars, and name labels.
 */

import * as THREE from 'three';

// ── Mob type visual definitions ──────────────────────────────

const MOB_VISUALS = {
  woolly: {
    name: 'Woolly',
    color: 0xEEDDCC,
    accentColor: 0xBBAA99,
    bodyW: 0.9, bodyH: 0.7, bodyD: 1.1,
    headW: 0.5, headH: 0.45, headD: 0.45,
    legH: 0.35, legW: 0.18,
    hasLegs: true,
    bobSpeed: 1.5, bobAmount: 0.02,
    walkSpeed: 6, walkSwing: 0.4,
  },
  glowbug: {
    name: 'Glowbug',
    color: 0x00FFAA,
    accentColor: 0x88FFDD,
    bodyW: 0.35, bodyH: 0.3, bodyD: 0.35,
    headW: 0, headH: 0, headD: 0, // no separate head
    legH: 0, legW: 0,
    hasLegs: false,
    bobSpeed: 3.0, bobAmount: 0.15,
    walkSpeed: 0, walkSwing: 0,
    emissive: true, glowRadius: 4, glowIntensity: 0.6,
  },
  frostling: {
    name: 'Frostling',
    color: 0xAADDFF,
    accentColor: 0x7799CC,
    bodyW: 0.5, bodyH: 0.55, bodyD: 0.4,
    headW: 0.4, headH: 0.35, headD: 0.35,
    legH: 0.3, legW: 0.15,
    hasLegs: true,
    bobSpeed: 2.0, bobAmount: 0.025,
    walkSpeed: 7, walkSwing: 0.35,
  },
  shroomy: {
    name: 'Shroomy',
    color: 0xEDE0C8,
    accentColor: 0xCC3366,
    bodyW: 0.45, bodyH: 0.5, bodyD: 0.45,
    headW: 0.7, headH: 0.3, headD: 0.7, // wide mushroom cap
    legH: 0.25, legW: 0.14,
    hasLegs: true,
    bobSpeed: 1.2, bobAmount: 0.015,
    walkSpeed: 5, walkSwing: 0.3,
  },
  lava_slime: {
    name: 'Lava Slime',
    color: 0xFF4400,
    accentColor: 0xFF8800,
    bodyW: 0.8, bodyH: 0.6, bodyD: 0.8,
    headW: 0, headH: 0, headD: 0,
    legH: 0, legW: 0,
    hasLegs: false,
    bobSpeed: 2.5, bobAmount: 0.08,
    walkSpeed: 0, walkSwing: 0,
    emissive: true, glowRadius: 5, glowIntensity: 0.5,
    squash: true, // squash/stretch animation
  },
  shadow_creep: {
    name: 'Shadow Creep',
    color: 0x220033,
    accentColor: 0x9900FF,
    bodyW: 0.45, bodyH: 0.9, bodyD: 0.35,
    headW: 0.4, headH: 0.4, headD: 0.4,
    legH: 0.45, legW: 0.15,
    hasLegs: true,
    bobSpeed: 1.8, bobAmount: 0.01,
    walkSpeed: 8, walkSwing: 0.5,
    eyeGlow: true,
  },
};

export class MobRenderer {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    /** @type {Map<string, MobEntry>} */
    this.mobs = new Map();
    this.clock = 0;
  }

  addMob(id, type, pos, hp, maxHp) {
    if (this.mobs.has(id)) return;

    const def = MOB_VISUALS[type];
    if (!def) return;

    const group = new THREE.Group();

    const mainColor = new THREE.Color(def.color);
    const accent = new THREE.Color(def.accentColor);

    // ── Body ──
    const bodyMat = def.emissive
      ? new THREE.MeshBasicMaterial({ color: mainColor })
      : new THREE.MeshLambertMaterial({ color: mainColor });
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(def.bodyW, def.bodyH, def.bodyD),
      bodyMat,
    );
    const baseY = def.hasLegs ? def.legH + def.bodyH / 2 : def.bodyH / 2;
    body.position.y = baseY;
    group.add(body);

    // ── Head (if applicable) ──
    let head = null;
    if (def.headW > 0) {
      const headMat = type === 'shroomy'
        ? new THREE.MeshLambertMaterial({ color: accent })
        : new THREE.MeshLambertMaterial({ color: mainColor.clone().lerp(new THREE.Color(0xffffff), 0.1) });
      head = new THREE.Mesh(
        new THREE.BoxGeometry(def.headW, def.headH, def.headD),
        headMat,
      );
      head.position.y = baseY + def.bodyH / 2 + def.headH / 2 + 0.02;
      group.add(head);

      // Eyes
      const eyeSize = type === 'shadow_creep' ? 0.08 : 0.06;
      const eyeColor = def.eyeGlow ? 0x9900FF : 0x111111;
      const eyeMat = def.eyeGlow
        ? new THREE.MeshBasicMaterial({ color: eyeColor })
        : new THREE.MeshBasicMaterial({ color: eyeColor });
      const eyeY = head.position.y + def.headH * 0.1;
      const eyeZ = def.headD / 2 + 0.01;
      const eyeSpacing = def.headW * 0.25;

      const lEye = new THREE.Mesh(new THREE.BoxGeometry(eyeSize, eyeSize, 0.02), eyeMat);
      lEye.position.set(-eyeSpacing, eyeY, eyeZ);
      group.add(lEye);

      const rEye = new THREE.Mesh(new THREE.BoxGeometry(eyeSize, eyeSize, 0.02), eyeMat);
      rEye.position.set(eyeSpacing, eyeY, eyeZ);
      group.add(rEye);
    } else if (type === 'glowbug') {
      // Glowbug: add tiny wing-like protrusions
      const wingMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.6 });
      const lWing = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.02, 0.15), wingMat);
      lWing.position.set(-0.25, baseY + 0.1, 0);
      lWing.rotation.z = 0.3;
      group.add(lWing);
      const rWing = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.02, 0.15), wingMat);
      rWing.position.set(0.25, baseY + 0.1, 0);
      rWing.rotation.z = -0.3;
      group.add(rWing);
    } else if (type === 'lava_slime') {
      // Inner core glow
      const core = new THREE.Mesh(
        new THREE.BoxGeometry(def.bodyW * 0.5, def.bodyH * 0.5, def.bodyD * 0.5),
        new THREE.MeshBasicMaterial({ color: 0xFFCC00, transparent: true, opacity: 0.7 }),
      );
      core.position.y = baseY;
      group.add(core);
    }

    // ── Legs ──
    let legs = null;
    if (def.hasLegs) {
      const legColor = mainColor.clone().multiplyScalar(0.7);
      const legMat = new THREE.MeshLambertMaterial({ color: legColor });

      legs = {
        fl: _createLeg(def.legW, def.legH, legMat),
        fr: _createLeg(def.legW, def.legH, legMat),
        bl: _createLeg(def.legW, def.legH, legMat),
        br: _createLeg(def.legW, def.legH, legMat),
      };

      const halfW = def.bodyW / 2 - def.legW / 2;
      const halfD = def.bodyD / 2 - def.legW / 2;

      legs.fl.pivot.position.set(-halfW, def.legH, halfD);
      legs.fr.pivot.position.set(halfW, def.legH, halfD);
      legs.bl.pivot.position.set(-halfW, def.legH, -halfD);
      legs.br.pivot.position.set(halfW, def.legH, -halfD);

      group.add(legs.fl.pivot, legs.fr.pivot, legs.bl.pivot, legs.br.pivot);
    }

    // ── Glow light ──
    let glow = null;
    if (def.emissive || def.eyeGlow) {
      glow = new THREE.PointLight(
        def.eyeGlow ? 0x9900FF : def.color,
        def.glowIntensity ?? 0.4,
        def.glowRadius ?? 4,
      );
      glow.position.y = baseY;
      group.add(glow);
    }

    // ── Name tag ──
    const nameSprite = _createMobLabel(def.name, hp, maxHp, type);
    const labelY = (head ? head.position.y + def.headH / 2 : baseY + def.bodyH / 2) + 0.5;
    nameSprite.position.y = labelY;
    group.add(nameSprite);

    // Position
    group.position.set(pos.x, pos.y, pos.z);
    this.scene.add(group);

    this.mobs.set(id, {
      group,
      type,
      def,
      body,
      head,
      legs,
      glow,
      nameSprite,
      labelY,
      targetPos: new THREE.Vector3(pos.x, pos.y, pos.z),
      hp,
      maxHp,
      walkPhase: Math.random() * Math.PI * 2,
      speed: 0,
      hurtFlash: 0,
    });
  }

  removeMob(id) {
    const entry = this.mobs.get(id);
    if (!entry) return;
    this.scene.remove(entry.group);
    entry.group.traverse((child) => {
      if (child.geometry) child.geometry.dispose();
      if (child.material) {
        if (child.material.map) child.material.map.dispose();
        child.material.dispose();
      }
    });
    this.mobs.delete(id);
  }

  updateMobPosition(id, pos) {
    const entry = this.mobs.get(id);
    if (!entry) return;
    entry.targetPos.set(pos.x, pos.y, pos.z);
  }

  hurtMob(id, hp, maxHp) {
    const entry = this.mobs.get(id);
    if (!entry) return;
    entry.hp = hp;
    entry.maxHp = maxHp;
    entry.hurtFlash = 0.3; // flash red for 0.3s

    // Update label
    entry.group.remove(entry.nameSprite);
    if (entry.nameSprite.material.map) entry.nameSprite.material.map.dispose();
    entry.nameSprite.material.dispose();
    const newLabel = _createMobLabel(entry.def.name, hp, maxHp, entry.type);
    newLabel.position.y = entry.labelY;
    entry.group.add(newLabel);
    entry.nameSprite = newLabel;
  }

  update(dt) {
    this.clock += dt;

    for (const [, mob] of this.mobs) {
      const def = mob.def;

      // Smooth position interpolation
      const prevPos = mob.group.position.clone();
      mob.group.position.lerp(mob.targetPos, Math.min(1, dt * 8));

      // Speed calculation
      const delta = mob.group.position.clone().sub(prevPos);
      delta.y = 0;
      const instantSpeed = delta.length() / Math.max(dt, 0.001);
      mob.speed = THREE.MathUtils.lerp(mob.speed, instantSpeed, dt * 6);

      const isWalking = mob.speed > 0.2;

      // Face direction of movement
      if (isWalking && delta.lengthSq() > 0.0001) {
        const targetAngle = Math.atan2(delta.x, delta.z);
        let diff = targetAngle - mob.group.rotation.y;
        while (diff > Math.PI) diff -= Math.PI * 2;
        while (diff < -Math.PI) diff += Math.PI * 2;
        mob.group.rotation.y += diff * Math.min(1, dt * 6);
      }

      // ── Leg animation ──
      if (mob.legs) {
        if (isWalking) {
          mob.walkPhase += dt * def.walkSpeed;
          const swing = Math.sin(mob.walkPhase) * def.walkSwing * Math.min(1, mob.speed / 2);
          mob.legs.fl.pivot.rotation.x = swing;
          mob.legs.br.pivot.rotation.x = swing;
          mob.legs.fr.pivot.rotation.x = -swing;
          mob.legs.bl.pivot.rotation.x = -swing;
        } else {
          mob.legs.fl.pivot.rotation.x *= 0.9;
          mob.legs.fr.pivot.rotation.x *= 0.9;
          mob.legs.bl.pivot.rotation.x *= 0.9;
          mob.legs.br.pivot.rotation.x *= 0.9;
        }
      }

      // ── Body bob ──
      const bob = Math.sin(this.clock * def.bobSpeed) * def.bobAmount;
      mob.body.position.y = (def.hasLegs ? def.legH + def.bodyH / 2 : def.bodyH / 2) + bob;
      if (mob.head) {
        mob.head.position.y = mob.body.position.y + def.bodyH / 2 + def.headH / 2 + 0.02 + bob * 0.5;
      }

      // ── Squash/stretch for slimes ──
      if (def.squash) {
        const squash = 1 + Math.sin(this.clock * def.bobSpeed) * 0.12;
        mob.body.scale.set(squash, 1 / squash, squash);
      }

      // ── Glow pulse ──
      if (mob.glow) {
        mob.glow.intensity = (def.glowIntensity ?? 0.4) + Math.sin(this.clock * 2.5) * 0.15;
      }

      // ── Hurt flash ──
      if (mob.hurtFlash > 0) {
        mob.hurtFlash -= dt;
        const flash = mob.hurtFlash > 0;
        mob.body.material.color.set(flash ? 0xFF0000 : def.color);
      }

      // Name tags face camera
      if (mob.nameSprite) {
        mob.nameSprite.lookAt(this.camera.position);
      }
    }
  }
}

// ── Helpers ──────────────────────────────────────────────────

function _createLeg(w, h, material) {
  const pivot = new THREE.Group();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), material);
  mesh.position.y = -h / 2;
  pivot.add(mesh);
  return { pivot, mesh };
}

function _createMobLabel(name, hp, maxHp, type) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 200;
  canvas.height = 48;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Name
  ctx.font = 'bold 16px monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#000000';
  ctx.lineWidth = 2;
  ctx.strokeText(name, 100, 16);
  ctx.fillText(name, 100, 16);

  // Health bar background
  const barW = 80;
  const barH = 6;
  const barX = (200 - barW) / 2;
  const barY = 26;
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(barX, barY, barW, barH);

  // Health bar fill
  const hpRatio = maxHp > 0 ? hp / maxHp : 0;
  const hpColor = hpRatio > 0.5 ? '#44FF44' : hpRatio > 0.25 ? '#FFAA00' : '#FF3333';
  ctx.fillStyle = hpColor;
  ctx.fillRect(barX, barY, barW * hpRatio, barH);

  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  const material = new THREE.SpriteMaterial({
    map: texture,
    transparent: true,
    depthTest: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.scale.set(2.0, 0.5, 1);
  return sprite;
}
