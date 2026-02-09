/**
 * MoltWorld sky — a procedural gradient sky with a sun and ambient fog.
 * Gives the alien planet its unique atmosphere.
 */

import * as THREE from 'three';

export function createSky(scene) {
  // Hemisphere light for ambient (teal sky + purple ground bounce)
  const hemi = new THREE.HemisphereLight(0x88bbee, 0x443366, 0.6);
  scene.add(hemi);

  // Directional "sun" light
  const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
  sun.position.set(100, 200, 80);
  sun.castShadow = false; // shadows are expensive for voxels
  scene.add(sun);

  // Ambient fill
  const ambient = new THREE.AmbientLight(0x404060, 0.4);
  scene.add(ambient);

  // Fog for depth perception + hiding chunk edges
  scene.fog = new THREE.FogExp2(0x8899bb, 0.0065);
  scene.background = new THREE.Color(0x7799cc);

  return { hemi, sun, ambient };
}
