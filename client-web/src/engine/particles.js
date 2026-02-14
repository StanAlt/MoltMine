/**
 * Particle effects for block breaking and ambient atmosphere.
 */

import * as THREE from 'three';

const MAX_PARTICLES = 200;

// Reusable geometry for particle cubes
const PARTICLE_GEO = new THREE.BoxGeometry(1, 1, 1);

export class ParticleSystem {
  constructor(scene) {
    this.scene = scene;
    this.particles = [];
  }

  /**
   * Emit block-break particles at the given position with the block's color.
   */
  emitBlockBreak(x, y, z, colorHex) {
    const baseColor = new THREE.Color(colorHex);
    const count = 8 + Math.floor(Math.random() * 5);

    for (let i = 0; i < count; i++) {
      const size = 0.06 + Math.random() * 0.1;
      const mat = new THREE.MeshBasicMaterial({
        color: baseColor.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.2),
        transparent: true,
        opacity: 1,
      });
      const mesh = new THREE.Mesh(PARTICLE_GEO, mat);
      mesh.scale.setScalar(size);

      mesh.position.set(
        x + 0.5 + (Math.random() - 0.5) * 0.6,
        y + 0.5 + (Math.random() - 0.5) * 0.6,
        z + 0.5 + (Math.random() - 0.5) * 0.6,
      );

      this.scene.add(mesh);

      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 4,
          Math.random() * 5 + 2,
          (Math.random() - 0.5) * 4,
        ),
        life: 0.6 + Math.random() * 0.4,
        maxLife: 0.6 + Math.random() * 0.4,
        gravity: -15,
      });
    }

    // Limit total particles
    while (this.particles.length > MAX_PARTICLES) {
      const old = this.particles.shift();
      this._dispose(old);
    }
  }

  /**
   * Emit a small placement puff (white translucent cubes).
   */
  emitBlockPlace(x, y, z) {
    for (let i = 0; i < 4; i++) {
      const size = 0.04 + Math.random() * 0.06;
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.6,
      });
      const mesh = new THREE.Mesh(PARTICLE_GEO, mat);
      mesh.scale.setScalar(size);
      mesh.position.set(
        x + 0.5 + (Math.random() - 0.5) * 0.4,
        y + 0.5 + (Math.random() - 0.5) * 0.4,
        z + 0.5 + (Math.random() - 0.5) * 0.4,
      );
      this.scene.add(mesh);
      this.particles.push({
        mesh,
        velocity: new THREE.Vector3(
          (Math.random() - 0.5) * 1.5,
          Math.random() * 2,
          (Math.random() - 0.5) * 1.5,
        ),
        life: 0.3 + Math.random() * 0.2,
        maxLife: 0.3 + Math.random() * 0.2,
        gravity: -5,
      });
    }
  }

  update(dt) {
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];

      p.velocity.y += p.gravity * dt;
      p.mesh.position.addScaledVector(p.velocity, dt);
      p.mesh.rotation.x += dt * 5;
      p.mesh.rotation.y += dt * 3;

      p.life -= dt;
      const alpha = Math.max(0, p.life / p.maxLife);
      p.mesh.material.opacity = alpha;

      const s = p.mesh.scale.x * (0.2 + alpha * 0.8) / p.mesh.scale.x;
      // keep original scale ratio
      p.mesh.scale.multiplyScalar(1); // no-op, opacity handles fade

      if (p.life <= 0) {
        this._dispose(p);
        this.particles.splice(i, 1);
      }
    }
  }

  _dispose(p) {
    this.scene.remove(p.mesh);
    p.mesh.material.dispose();
    // Don't dispose shared geometry
  }
}
