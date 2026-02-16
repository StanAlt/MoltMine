/**
 * First-person player controller with pointer-lock, WASD movement,
 * jumping, gravity, fly mode, and block raycasting for mining/placing.
 */

import * as THREE from 'three';
import { CHUNK_HEIGHT } from '@shared/protocol.js';
import { AIR, isSolid, WATER } from '@shared/blocks.js';

const MOVE_SPEED = 6;        // blocks per second
const FLY_SPEED = 12;        // faster in fly mode
const JUMP_VELOCITY = 8;
const GRAVITY = -22;
const MOUSE_SENSITIVITY = 0.002;
const REACH = 6;             // max mining/placing distance
const PLAYER_HEIGHT = 1.7;
const PLAYER_RADIUS = 0.3;

export class PlayerController {
  constructor(camera, canvas, voxelWorld) {
    this.camera = camera;
    this.canvas = canvas;
    this.world = voxelWorld;

    this.position = new THREE.Vector3(0, 40, 0);
    this.velocity = new THREE.Vector3(0, 0, 0);
    this.euler = new THREE.Euler(0, 0, 0, 'YXZ');
    this.onGround = false;
    this.locked = false;
    this.flying = false;

    // Input state
    this.keys = {};
    this.mouseButtons = { left: false, right: false };
    this._mineTimer = 0;
    this._placeTimer = 0;

    // Raycasting
    this.raycaster = new THREE.Raycaster();
    this.targetBlock = null;   // { x, y, z } of block being looked at
    this.placeBlock = null;    // { x, y, z } where a new block would go

    // Highlight cube
    this.highlightMesh = new THREE.Mesh(
      new THREE.BoxGeometry(1.005, 1.005, 1.005),
      new THREE.MeshBasicMaterial({ color: 0xffffff, wireframe: true, transparent: true, opacity: 0.5 }),
    );
    this.highlightMesh.visible = false;

    this._setupListeners();
  }

  _setupListeners() {
    document.addEventListener('keydown', (e) => { this.keys[e.code] = true; });
    document.addEventListener('keyup', (e) => { this.keys[e.code] = false; });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
    });

    // Mouse events on document so they work even when pointer is locked
    document.addEventListener('mousedown', (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.mouseButtons.left = true;
      if (e.button === 2) this.mouseButtons.right = true;
    });
    document.addEventListener('mouseup', (e) => {
      if (e.button === 0) this.mouseButtons.left = false;
      if (e.button === 2) this.mouseButtons.right = false;
    });
    this.canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    document.addEventListener('contextmenu', (e) => { if (this.locked) e.preventDefault(); });

    document.addEventListener('mousemove', (e) => {
      if (!this.locked) return;
      this.euler.y -= e.movementX * MOUSE_SENSITIVITY;
      this.euler.x -= e.movementY * MOUSE_SENSITIVITY;
      this.euler.x = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.euler.x));
      this.camera.quaternion.setFromEuler(this.euler);
    });
  }

  requestLock() {
    try {
      const promise = this.canvas.requestPointerLock();
      if (promise && promise.catch) {
        promise.catch((err) => {
          console.warn('Pointer lock failed:', err.message);
        });
      }
    } catch (err) {
      console.warn('Pointer lock error:', err.message);
    }
  }

  toggleFly() {
    this.flying = !this.flying;
    if (this.flying) {
      this.velocity.y = 0;
    }
    return this.flying;
  }

  update(dt) {
    if (!this.locked) return;

    // Camera forward and right vectors
    const camForward = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const forward = camForward.clone();
    const right = new THREE.Vector3().crossVectors(camForward, new THREE.Vector3(0, 1, 0)).normalize();

    if (this.flying) {
      // ── Fly mode: move in camera direction, no gravity ──
      const moveDir = new THREE.Vector3();
      if (this.keys['KeyW'] || this.keys['ArrowUp']) moveDir.add(forward);
      if (this.keys['KeyS'] || this.keys['ArrowDown']) moveDir.sub(forward);
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) moveDir.sub(right);
      if (this.keys['KeyD'] || this.keys['ArrowRight']) moveDir.add(right);
      if (this.keys['Space']) moveDir.y += 1;
      if (this.keys['ShiftLeft'] || this.keys['ShiftRight']) moveDir.y -= 1;
      if (moveDir.lengthSq() > 0) moveDir.normalize();

      const speed = (this.keys['ControlLeft'] || this.keys['ControlRight']) ? FLY_SPEED * 2.5 : FLY_SPEED;
      this.velocity.set(moveDir.x * speed, moveDir.y * speed, moveDir.z * speed);

      // Move with collision (optional in fly — skip for now for freedom)
      this.position.addScaledVector(this.velocity, dt);
    } else {
      // ── Walk mode: horizontal WASD, gravity, jumping ──
      const walkForward = camForward.clone();
      walkForward.y = 0;
      walkForward.normalize();
      const walkRight = new THREE.Vector3().crossVectors(walkForward, new THREE.Vector3(0, 1, 0)).normalize();

      const moveDir = new THREE.Vector3();
      if (this.keys['KeyW'] || this.keys['ArrowUp']) moveDir.add(walkForward);
      if (this.keys['KeyS'] || this.keys['ArrowDown']) moveDir.sub(walkForward);
      if (this.keys['KeyA'] || this.keys['ArrowLeft']) moveDir.sub(walkRight);
      if (this.keys['KeyD'] || this.keys['ArrowRight']) moveDir.add(walkRight);
      if (moveDir.lengthSq() > 0) moveDir.normalize();

      const speed = this.keys['ShiftLeft'] ? MOVE_SPEED * 1.5 : MOVE_SPEED;
      this.velocity.x = moveDir.x * speed;
      this.velocity.z = moveDir.z * speed;

      // Jump
      if ((this.keys['Space'] || this.keys['KeyJ']) && this.onGround) {
        this.velocity.y = JUMP_VELOCITY;
        this.onGround = false;
      }

      // Gravity
      this.velocity.y += GRAVITY * dt;

      // Collision detection and position update
      this._moveAxis('y', this.velocity.y * dt);
      this._moveAxis('x', this.velocity.x * dt);
      this._moveAxis('z', this.velocity.z * dt);
    }

    // Don't fall below bedrock
    if (this.position.y < 1) {
      this.position.y = 1;
      this.velocity.y = 0;
      this.onGround = true;
    }

    // Don't go above sky
    if (this.position.y > CHUNK_HEIGHT - 2) {
      this.position.y = CHUNK_HEIGHT - 2;
      this.velocity.y = 0;
    }

    // Update camera position
    this.camera.position.copy(this.position);

    // Raycast for block targeting
    this._updateRaycast();

    // Mine/place cooldowns
    this._mineTimer = Math.max(0, this._mineTimer - dt);
    this._placeTimer = Math.max(0, this._placeTimer - dt);
  }

  _moveAxis(axis, delta) {
    const oldVal = this.position[axis];
    this.position[axis] += delta;

    // Check collision at feet and head
    const checkPoints = [
      this.position.clone(),
      this.position.clone().setY(this.position.y - PLAYER_HEIGHT + 0.1),
    ];

    for (const point of checkPoints) {
      const bx = Math.floor(point.x);
      const by = Math.floor(point.y);
      const bz = Math.floor(point.z);

      // Check surrounding blocks
      for (let dx = -1; dx <= 1; dx++) {
        for (let dz = -1; dz <= 1; dz++) {
          for (let dy = -1; dy <= 1; dy++) {
            const cx = bx + dx, cy = by + dy, cz = bz + dz;
            if (!isSolid(this.world.getBlock(cx, cy, cz))) continue;

            // AABB collision
            const minX = cx, maxX = cx + 1;
            const minY = cy, maxY = cy + 1;
            const minZ = cz, maxZ = cz + 1;

            const pMinX = this.position.x - PLAYER_RADIUS;
            const pMaxX = this.position.x + PLAYER_RADIUS;
            const pMinY = this.position.y - PLAYER_HEIGHT;
            const pMaxY = this.position.y;
            const pMinZ = this.position.z - PLAYER_RADIUS;
            const pMaxZ = this.position.z + PLAYER_RADIUS;

            if (pMaxX > minX && pMinX < maxX &&
                pMaxY > minY && pMinY < maxY &&
                pMaxZ > minZ && pMinZ < maxZ) {
              // Collision — revert
              this.position[axis] = oldVal;
              if (axis === 'y' && delta < 0) {
                this.velocity.y = 0;
                this.onGround = true;
              } else if (axis === 'y') {
                this.velocity.y = 0;
              }
              return;
            }
          }
        }
      }
    }
  }

  _updateRaycast() {
    this.targetBlock = null;
    this.placeBlock = null;

    const dir = new THREE.Vector3(0, 0, -1).applyQuaternion(this.camera.quaternion);
    const origin = this.camera.position.clone();

    // Step along the ray
    const step = 0.1;
    let prevX = -999, prevY = -999, prevZ = -999;

    for (let d = 0; d < REACH; d += step) {
      const px = origin.x + dir.x * d;
      const py = origin.y + dir.y * d;
      const pz = origin.z + dir.z * d;

      const bx = Math.floor(px);
      const by = Math.floor(py);
      const bz = Math.floor(pz);

      if (bx === prevX && by === prevY && bz === prevZ) continue;

      const blockId = this.world.getBlock(bx, by, bz);
      if (isSolid(blockId)) {
        this.targetBlock = { x: bx, y: by, z: bz };
        this.placeBlock = { x: prevX, y: prevY, z: prevZ };
        break;
      }

      prevX = bx; prevY = by; prevZ = bz;
    }

    // Update highlight
    if (this.targetBlock) {
      this.highlightMesh.position.set(
        this.targetBlock.x + 0.5,
        this.targetBlock.y + 0.5,
        this.targetBlock.z + 0.5,
      );
      this.highlightMesh.visible = true;
    } else {
      this.highlightMesh.visible = false;
    }
  }

  /** Returns mine target if left mouse is held and cooldown passed. */
  getMineTarget() {
    if (this.mouseButtons.left && this.targetBlock && this._mineTimer <= 0) {
      this._mineTimer = 0.25; // 4 mines per second
      return { ...this.targetBlock };
    }
    return null;
  }

  /** Returns place target if right mouse is held and cooldown passed. */
  getPlaceTarget() {
    if (this.mouseButtons.right && this.placeBlock && this._placeTimer <= 0) {
      this._placeTimer = 0.25;
      return { ...this.placeBlock };
    }
    return null;
  }
}
