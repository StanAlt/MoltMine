/**
 * Dynamic sky with day/night cycle.
 *
 * The sun orbits, sky colour shifts between warm day and cool
 * purple-tinted night, and fog adjusts accordingly.
 */

import * as THREE from 'three';

// Phase colours
const SKY_DAY   = new THREE.Color(0x7799cc);
const SKY_DAWN  = new THREE.Color(0xcc8866);
const SKY_DUSK  = new THREE.Color(0x885577);
const SKY_NIGHT = new THREE.Color(0x0a0a1e);

const FOG_DAY   = new THREE.Color(0x8899bb);
const FOG_NIGHT = new THREE.Color(0x0e0e20);

export function createSky(scene) {
  const hemi = new THREE.HemisphereLight(0x88bbee, 0x443366, 0.6);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff4e0, 1.0);
  sun.position.set(100, 200, 80);
  scene.add(sun);

  const ambient = new THREE.AmbientLight(0x404060, 0.4);
  scene.add(ambient);

  scene.fog = new THREE.FogExp2(0x8899bb, 0.0065);
  scene.background = new THREE.Color(0x7799cc);

  return { hemi, sun, ambient };
}

/**
 * Update sky based on world time.
 * @param {object} sky — { hemi, sun, ambient } from createSky
 * @param {THREE.Scene} scene
 * @param {number} worldTime — current tick
 * @param {number} dayLength — total ticks in a full day
 */
export function updateSky(sky, scene, worldTime, dayLength) {
  if (!dayLength) return;
  const t = worldTime / dayLength; // 0..1

  // Sun orbit
  const angle = t * Math.PI * 2 - Math.PI / 2;
  sky.sun.position.set(Math.cos(angle) * 200, Math.sin(angle) * 200, 80);

  // Determine blend
  let skyColor, fogColor, sunIntensity, ambientIntensity, hemiIntensity;

  if (t < 0.2) {
    // Dawn
    const f = t / 0.2;
    skyColor = SKY_NIGHT.clone().lerp(SKY_DAWN, f);
    fogColor = FOG_NIGHT.clone().lerp(FOG_DAY, f * 0.5);
    sunIntensity = 0.2 + f * 0.6;
    ambientIntensity = 0.15 + f * 0.25;
    hemiIntensity = 0.2 + f * 0.4;
  } else if (t < 0.45) {
    // Day
    const f = (t - 0.2) / 0.25;
    skyColor = SKY_DAWN.clone().lerp(SKY_DAY, f);
    fogColor = FOG_DAY.clone();
    sunIntensity = 0.8 + f * 0.2;
    ambientIntensity = 0.4;
    hemiIntensity = 0.6;
  } else if (t < 0.55) {
    // Dusk
    const f = (t - 0.45) / 0.1;
    skyColor = SKY_DAY.clone().lerp(SKY_DUSK, f);
    fogColor = FOG_DAY.clone().lerp(FOG_NIGHT, f * 0.5);
    sunIntensity = 1.0 - f * 0.6;
    ambientIntensity = 0.4 - f * 0.2;
    hemiIntensity = 0.6 - f * 0.3;
  } else if (t < 0.8) {
    // Night
    const f = (t - 0.55) / 0.25;
    skyColor = SKY_DUSK.clone().lerp(SKY_NIGHT, f);
    fogColor = FOG_NIGHT.clone();
    sunIntensity = 0.1;
    ambientIntensity = 0.12;
    hemiIntensity = 0.15;
  } else {
    // Pre-dawn
    const f = (t - 0.8) / 0.2;
    skyColor = SKY_NIGHT.clone().lerp(SKY_DAWN, f * 0.5);
    fogColor = FOG_NIGHT.clone();
    sunIntensity = 0.1 + f * 0.15;
    ambientIntensity = 0.12 + f * 0.05;
    hemiIntensity = 0.15 + f * 0.1;
  }

  scene.background.copy(skyColor);
  scene.fog.color.copy(fogColor);
  sky.sun.intensity = sunIntensity;
  sky.ambient.intensity = ambientIntensity;
  sky.hemi.intensity = hemiIntensity;
}
