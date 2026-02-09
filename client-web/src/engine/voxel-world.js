/**
 * Voxel world renderer — converts chunk data into Three.js meshes.
 *
 * Each chunk (16 x 64 x 16 blocks) becomes a single BufferGeometry
 * with vertex-colour faces. Only exposed faces are generated (hidden
 * surface removal) for good performance.
 */

import * as THREE from 'three';
import { CHUNK_SIZE, CHUNK_HEIGHT } from '@shared/protocol.js';
import { AIR, blockColor, isSolid, isTransparent, isEmissive, WATER } from '@shared/blocks.js';

// Face directions: [dx, dy, dz, face-name]
const FACES = [
  [ 1,  0,  0, 'px'],
  [-1,  0,  0, 'nx'],
  [ 0,  1,  0, 'py'],
  [ 0, -1,  0, 'ny'],
  [ 0,  0,  1, 'pz'],
  [ 0,  0, -1, 'nz'],
];

// Per-face ambient occlusion shade (simple directional lighting)
const FACE_SHADE = { px: 0.85, nx: 0.85, py: 1.0, ny: 0.5, pz: 0.9, nz: 0.75 };

// Quad vertex offsets for each face
const FACE_VERTS = {
  px: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]],
  nx: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]],
  py: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]],
  ny: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]],
  pz: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]],
  nz: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]],
};

export class VoxelWorld {
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<string, Uint8Array>} */
    this.chunks = new Map();
    /** @type {Map<string, THREE.Mesh>} */
    this.meshes = new Map();
    /** @type {Map<string, THREE.Mesh>} water meshes */
    this.waterMeshes = new Map();

    this.solidMaterial = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.waterMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
    });
    this.emissiveMaterial = new THREE.MeshBasicMaterial({ vertexColors: true });
  }

  static chunkKey(cx, cz) { return `${cx},${cz}`; }

  setChunkData(cx, cz, data) {
    const key = VoxelWorld.chunkKey(cx, cz);
    this.chunks.set(key, data);
    this._buildMesh(cx, cz);
  }

  updateBlock(x, y, z, blockId) {
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = VoxelWorld.chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    chunk[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx] = blockId;

    // Rebuild this chunk and adjacent chunks if block is on edge
    this._buildMesh(cx, cz);
    if (lx === 0) this._buildMesh(cx - 1, cz);
    if (lx === CHUNK_SIZE - 1) this._buildMesh(cx + 1, cz);
    if (lz === 0) this._buildMesh(cx, cz - 1);
    if (lz === CHUNK_SIZE - 1) this._buildMesh(cx, cz + 1);
  }

  getBlock(x, y, z) {
    if (y < 0 || y >= CHUNK_HEIGHT) return AIR;
    const cx = Math.floor(x / CHUNK_SIZE);
    const cz = Math.floor(z / CHUNK_SIZE);
    const key = VoxelWorld.chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return AIR;
    const lx = ((x % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    const lz = ((z % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
    return chunk[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx];
  }

  _buildMesh(cx, cz) {
    const key = VoxelWorld.chunkKey(cx, cz);
    const chunk = this.chunks.get(key);
    if (!chunk) return;

    // Remove old mesh
    const oldMesh = this.meshes.get(key);
    if (oldMesh) { this.scene.remove(oldMesh); oldMesh.geometry.dispose(); }
    const oldWater = this.waterMeshes.get(key);
    if (oldWater) { this.scene.remove(oldWater); oldWater.geometry.dispose(); }

    const solidPositions = [];
    const solidColors = [];
    const solidIndices = [];
    const waterPositions = [];
    const waterColors = [];
    const waterIndices = [];

    const ox = cx * CHUNK_SIZE;
    const oz = cz * CHUNK_SIZE;

    for (let y = 0; y < CHUNK_HEIGHT; y++) {
      for (let lz = 0; lz < CHUNK_SIZE; lz++) {
        for (let lx = 0; lx < CHUNK_SIZE; lx++) {
          const blockId = chunk[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx];
          if (blockId === AIR) continue;

          const isWater = blockId === WATER;
          const positions = isWater ? waterPositions : solidPositions;
          const colors = isWater ? waterColors : solidColors;
          const indices = isWater ? waterIndices : solidIndices;

          const color = new THREE.Color(blockColor(blockId));
          const emits = isEmissive(blockId);

          for (const [dx, dy, dz, face] of FACES) {
            const nx = lx + dx;
            const ny = y + dy;
            const nz = lz + dz;

            let neighbourId;
            if (nx < 0 || nx >= CHUNK_SIZE || nz < 0 || nz >= CHUNK_SIZE) {
              neighbourId = this.getBlock(ox + nx, ny, oz + nz);
            } else if (ny < 0 || ny >= CHUNK_HEIGHT) {
              neighbourId = AIR;
            } else {
              neighbourId = chunk[(ny * CHUNK_SIZE + nz) * CHUNK_SIZE + nx];
            }

            // Show face if neighbour is air or transparent (and not same block type for water)
            const show = neighbourId === AIR ||
              (isTransparent(neighbourId) && neighbourId !== blockId) ||
              (!isSolid(neighbourId) && neighbourId !== blockId);
            if (!show) continue;

            const shade = emits ? 1.2 : FACE_SHADE[face];
            const r = Math.min(1, color.r * shade);
            const g = Math.min(1, color.g * shade);
            const b = Math.min(1, color.b * shade);

            const vi = positions.length / 3;
            for (const [vx, vy, vz] of FACE_VERTS[face]) {
              positions.push(ox + lx + vx, y + vy, oz + lz + vz);
              colors.push(r, g, b);
            }
            indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
          }
        }
      }
    }

    // Build solid mesh
    if (solidPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(solidPositions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(solidColors, 3));
      geo.setIndex(solidIndices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.solidMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      this.scene.add(mesh);
      this.meshes.set(key, mesh);
    }

    // Build water mesh
    if (waterPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(waterPositions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(waterColors, 3));
      geo.setIndex(waterIndices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.waterMaterial);
      this.scene.add(mesh);
      this.waterMeshes.set(key, mesh);
    }
  }
}
