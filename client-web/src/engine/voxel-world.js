/**
 * Voxel world renderer — converts chunk data into Three.js meshes.
 *
 * Each chunk (16 x 64 x 16 blocks) becomes a single BufferGeometry
 * with texture-mapped faces and vertex-based ambient occlusion.
 * Only exposed faces are generated (hidden surface removal).
 *
 * Uses a procedural texture atlas multiplied by vertex colors for
 * a Minecraft-like visual style.
 */

import * as THREE from 'three';
import { CHUNK_SIZE, CHUNK_HEIGHT } from '@shared/protocol.js';
import { AIR, blockColor, isSolid, isTransparent, isEmissive, WATER } from '@shared/blocks.js';
import { createTextureAtlas, getTileForFace, tileUV } from './texture-atlas.js';

// Face directions: [dx, dy, dz, face-name]
const FACES = [
  [ 1,  0,  0, 'px'],
  [-1,  0,  0, 'nx'],
  [ 0,  1,  0, 'py'],
  [ 0, -1,  0, 'ny'],
  [ 0,  0,  1, 'pz'],
  [ 0,  0, -1, 'nz'],
];

// Per-face directional lighting shade
const FACE_SHADE = { px: 0.85, nx: 0.85, py: 1.0, ny: 0.5, pz: 0.9, nz: 0.75 };

// Quad vertex offsets for each face (CCW winding)
const FACE_VERTS = {
  px: [[1,0,0],[1,1,0],[1,1,1],[1,0,1]],
  nx: [[0,0,1],[0,1,1],[0,1,0],[0,0,0]],
  py: [[0,1,0],[0,1,1],[1,1,1],[1,1,0]],
  ny: [[0,0,1],[0,0,0],[1,0,0],[1,0,1]],
  pz: [[1,0,1],[1,1,1],[0,1,1],[0,0,1]],
  nz: [[0,0,0],[0,1,0],[1,1,0],[1,0,0]],
};

// UV coordinates for each face vertex (maps to a single tile)
const FACE_UVS = [
  [0, 0],
  [0, 1],
  [1, 1],
  [1, 0],
];

// Generate AO neighbor offsets programmatically
function _computeAONeighbors() {
  // For each face with normal (nx, ny, nz), and for each vertex,
  // compute the 3 neighbors to check for AO
  const faceNormals = {
    px: [1, 0, 0], nx: [-1, 0, 0],
    py: [0, 1, 0], ny: [0, -1, 0],
    pz: [0, 0, 1], nz: [0, 0, -1],
  };

  const result = {};

  for (const [faceName, verts] of Object.entries(FACE_VERTS)) {
    const [nx, ny, nz] = faceNormals[faceName];
    result[faceName] = [];

    for (const [vx, vy, vz] of verts) {
      // The vertex is at the corner of the block. We need to find the
      // two edge directions and one corner direction relative to the face.
      // Edge/corner neighbors are in the plane perpendicular to the normal,
      // offset by the normal direction.

      // Compute the 3 neighbor positions to check
      // For a vertex at (vx, vy, vz) on a face with normal (nx, ny, nz):
      // - The vertex is at a corner of the face
      // - We check the blocks at offsets from the block position
      const neighbors = [];

      // Determine which axes are tangent to the face
      if (nx !== 0) {
        // Face normal is X: tangent axes are Y and Z
        const dy = vy === 0 ? -1 : 1;
        const dz = vz === 0 ? -1 : 1;
        neighbors.push(
          [nx > 0 ? 1 : -1, dy, 0],
          [nx > 0 ? 1 : -1, 0, dz],
          [nx > 0 ? 1 : -1, dy, dz],
        );
      } else if (ny !== 0) {
        // Face normal is Y: tangent axes are X and Z
        const dx = vx === 0 ? -1 : 1;
        const dz = vz === 0 ? -1 : 1;
        neighbors.push(
          [dx, ny > 0 ? 1 : -1, 0],
          [0, ny > 0 ? 1 : -1, dz],
          [dx, ny > 0 ? 1 : -1, dz],
        );
      } else {
        // Face normal is Z: tangent axes are X and Y
        const dx = vx === 0 ? -1 : 1;
        const dy = vy === 0 ? -1 : 1;
        neighbors.push(
          [dx, 0, nz > 0 ? 1 : -1],
          [0, dy, nz > 0 ? 1 : -1],
          [dx, dy, nz > 0 ? 1 : -1],
        );
      }

      result[faceName].push(neighbors);
    }
  }

  return result;
}

const AO_OFFSETS = _computeAONeighbors();

// AO brightness levels: 0 neighbors blocked = 1.0, up to 3 = darkest
const AO_LEVELS = [1.0, 0.75, 0.55, 0.35];

export class VoxelWorld {
  constructor(scene) {
    this.scene = scene;
    /** @type {Map<string, Uint8Array>} */
    this.chunks = new Map();
    /** @type {Map<string, THREE.Mesh>} */
    this.meshes = new Map();
    /** @type {Map<string, THREE.Mesh>} water meshes */
    this.waterMeshes = new Map();

    // Create texture atlas
    const atlas = createTextureAtlas();

    this.solidMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true,
      map: atlas,
    });
    this.waterMaterial = new THREE.MeshLambertMaterial({
      vertexColors: true, transparent: true, opacity: 0.55, side: THREE.DoubleSide,
      map: atlas,
    });
    this.emissiveMaterial = new THREE.MeshBasicMaterial({
      vertexColors: true,
      map: atlas,
    });
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

  _getBlockFast(chunk, ox, oz, lx, y, lz) {
    // Fast block lookup that checks chunk boundaries
    if (y < 0 || y >= CHUNK_HEIGHT) return AIR;
    if (lx >= 0 && lx < CHUNK_SIZE && lz >= 0 && lz < CHUNK_SIZE) {
      return chunk[(y * CHUNK_SIZE + lz) * CHUNK_SIZE + lx];
    }
    return this.getBlock(ox + lx, y, oz + lz);
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
    const solidUvs = [];
    const solidIndices = [];
    const waterPositions = [];
    const waterColors = [];
    const waterUvs = [];
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
          const uvs = isWater ? waterUvs : solidUvs;
          const indices = isWater ? waterIndices : solidIndices;

          const color = new THREE.Color(blockColor(blockId));
          const emits = isEmissive(blockId);

          for (const [dx, dy, dz, face] of FACES) {
            const nlx = lx + dx;
            const ny = y + dy;
            const nlz = lz + dz;

            const neighbourId = this._getBlockFast(chunk, ox, oz, nlx, ny, nlz);

            // Show face if neighbour is air or transparent (and not same block type for water)
            const show = neighbourId === AIR ||
              (isTransparent(neighbourId) && neighbourId !== blockId) ||
              (!isSolid(neighbourId) && neighbourId !== blockId);
            if (!show) continue;

            // Get texture tile UVs for this block face
            const tileIdx = getTileForFace(blockId, face);
            const tile = tileUV(tileIdx);

            // Compute ambient occlusion for each vertex
            const ao = [0, 0, 0, 0];
            if (!emits && !isWater) {
              const aoNeighbors = AO_OFFSETS[face];
              for (let vi = 0; vi < 4; vi++) {
                const [n0, n1, n2] = aoNeighbors[vi];
                const s0 = isSolid(this._getBlockFast(chunk, ox, oz, lx + n0[0], y + n0[1], lz + n0[2])) ? 1 : 0;
                const s1 = isSolid(this._getBlockFast(chunk, ox, oz, lx + n1[0], y + n1[1], lz + n1[2])) ? 1 : 0;
                const s2 = (s0 && s1) ? 1 : (isSolid(this._getBlockFast(chunk, ox, oz, lx + n2[0], y + n2[1], lz + n2[2])) ? 1 : 0);
                ao[vi] = s0 + s1 + s2;
              }
            }

            const shade = emits ? 1.2 : FACE_SHADE[face];
            const vi = positions.length / 3;
            const faceVerts = FACE_VERTS[face];

            for (let v = 0; v < 4; v++) {
              const [vx, vy, vz] = faceVerts[v];
              positions.push(ox + lx + vx, y + vy, oz + lz + vz);

              // Vertex color = base color * directional shade * AO
              const aoMul = AO_LEVELS[ao[v]];
              const finalShade = shade * aoMul;
              colors.push(
                Math.min(1, color.r * finalShade),
                Math.min(1, color.g * finalShade),
                Math.min(1, color.b * finalShade),
              );

              // UV coordinates mapped to the tile in the atlas
              const [fu, fv] = FACE_UVS[v];
              uvs.push(
                tile.u + fu * tile.uSize,
                tile.v + fv * tile.vSize,
              );
            }

            // Flip quad triangulation if AO requires it (fixes diagonal shadow artifact)
            if (ao[0] + ao[2] > ao[1] + ao[3]) {
              indices.push(vi + 1, vi + 2, vi + 3, vi + 1, vi + 3, vi);
            } else {
              indices.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
            }
          }
        }
      }
    }

    // Build solid mesh
    if (solidPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(solidPositions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(solidColors, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(solidUvs, 2));
      geo.setIndex(solidIndices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.solidMaterial);
      this.scene.add(mesh);
      this.meshes.set(key, mesh);
    }

    // Build water mesh
    if (waterPositions.length > 0) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(waterPositions, 3));
      geo.setAttribute('color', new THREE.Float32BufferAttribute(waterColors, 3));
      geo.setAttribute('uv', new THREE.Float32BufferAttribute(waterUvs, 2));
      geo.setIndex(waterIndices);
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, this.waterMaterial);
      this.scene.add(mesh);
      this.waterMeshes.set(key, mesh);
    }
  }
}
