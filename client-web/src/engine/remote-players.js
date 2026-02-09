/**
 * Remote player avatar rendering.
 *
 * Each Molty is shown as a coloured voxel figure with a floating name tag.
 * The avatar colour is derived from their profile's primaryColor.
 */

import * as THREE from 'three';

const BODY_W = 0.6;
const BODY_H = 1.4;
const HEAD_SIZE = 0.5;

export class RemotePlayers {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    /** @type {Map<string, {group: THREE.Group, targetPos: THREE.Vector3, name: string}>} */
    this.players = new Map();
  }

  addPlayer(accountId, name, profile, pos) {
    if (this.players.has(accountId)) return;

    const color = new THREE.Color(profile?.appearance?.primaryColor ?? '#9B30FF');
    const secColor = new THREE.Color(profile?.appearance?.secondaryColor ?? '#00E5FF');

    const group = new THREE.Group();

    // Body
    const bodyGeo = new THREE.BoxGeometry(BODY_W, BODY_H, BODY_W * 0.5);
    const bodyMat = new THREE.MeshLambertMaterial({ color });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = BODY_H / 2;
    group.add(body);

    // Head
    const headGeo = new THREE.BoxGeometry(HEAD_SIZE, HEAD_SIZE, HEAD_SIZE);
    const headMat = new THREE.MeshLambertMaterial({ color: secColor });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = BODY_H + HEAD_SIZE / 2 + 0.05;
    group.add(head);

    // Eyes
    const eyeGeo = new THREE.BoxGeometry(0.08, 0.08, 0.06);
    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const leftEye = new THREE.Mesh(eyeGeo, eyeMat);
    leftEye.position.set(-0.12, BODY_H + HEAD_SIZE / 2 + 0.08, HEAD_SIZE / 2 + 0.01);
    group.add(leftEye);
    const rightEye = new THREE.Mesh(eyeGeo, eyeMat);
    rightEye.position.set(0.12, BODY_H + HEAD_SIZE / 2 + 0.08, HEAD_SIZE / 2 + 0.01);
    group.add(rightEye);

    // Name sprite
    const nameSprite = this._createNameSprite(name, profile?.personality?.traits);
    nameSprite.position.y = BODY_H + HEAD_SIZE + 0.5;
    group.add(nameSprite);

    group.position.set(pos?.x ?? 0, (pos?.y ?? 0) - 1.7, pos?.z ?? 0);
    this.scene.add(group);

    this.players.set(accountId, {
      group,
      targetPos: new THREE.Vector3(pos?.x ?? 0, (pos?.y ?? 0) - 1.7, pos?.z ?? 0),
      name,
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

  /** Smooth interpolation each frame */
  update(dt) {
    for (const [, entry] of this.players) {
      entry.group.position.lerp(entry.targetPos, Math.min(1, dt * 10));

      // Make name tags face camera
      for (const child of entry.group.children) {
        if (child.isSprite) {
          child.lookAt(this.camera.position);
        }
      }
    }
  }

  _createNameSprite(name, traits) {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 256;
    canvas.height = 64;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Name
    ctx.font = 'bold 24px monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = '#ffffff';
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = 3;
    ctx.strokeText(name, 128, 24);
    ctx.fillText(name, 128, 24);

    // Trait badge
    if (traits?.length) {
      ctx.font = '14px monospace';
      ctx.fillStyle = '#bbbbff';
      ctx.fillText(traits.slice(0, 2).join(' · '), 128, 48);
    }

    const texture = new THREE.CanvasTexture(canvas);
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.scale.set(3, 0.75, 1);
    return sprite;
  }
}
