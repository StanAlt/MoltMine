/**
 * World persistence — saves/loads chunks and player profiles to disk.
 *
 * Modified chunks are tracked as dirty and flushed on interval or shutdown.
 * Profiles persist across sessions so returning players keep their stats.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'fs';
import { join } from 'path';

const DATA_DIR = new URL('../../data', import.meta.url).pathname;
const CHUNKS_DIR = join(DATA_DIR, 'chunks');
const PROFILES_PATH = join(DATA_DIR, 'profiles.json');

export class Persistence {
  constructor() {
    /** @type {Set<string>} chunk keys that need saving */
    this.dirtyChunks = new Set();

    /** @type {Map<string, object>} name -> profile (persistent) */
    this.profiles = new Map();

    mkdirSync(CHUNKS_DIR, { recursive: true });
    mkdirSync(DATA_DIR, { recursive: true });
  }

  // ── Profiles ────────────────────────────────────────────

  loadProfiles() {
    try {
      if (existsSync(PROFILES_PATH)) {
        const data = JSON.parse(readFileSync(PROFILES_PATH, 'utf-8'));
        for (const [name, profile] of Object.entries(data)) {
          this.profiles.set(name, profile);
        }
        console.log(`[Persistence] Loaded ${this.profiles.size} profiles`);
      }
    } catch (err) {
      console.error('[Persistence] Failed to load profiles:', err.message);
    }
  }

  saveProfiles() {
    try {
      const obj = Object.fromEntries(this.profiles);
      writeFileSync(PROFILES_PATH, JSON.stringify(obj, null, 2));
    } catch (err) {
      console.error('[Persistence] Failed to save profiles:', err.message);
    }
  }

  getProfile(name) {
    return this.profiles.get(name) ?? null;
  }

  setProfile(name, profile) {
    this.profiles.set(name, profile);
  }

  // ── Chunks ──────────────────────────────────────────────

  loadChunk(key) {
    const filePath = join(CHUNKS_DIR, `${key.replace(',', '_')}.bin`);
    try {
      if (existsSync(filePath)) {
        const buf = readFileSync(filePath);
        return new Uint8Array(buf);
      }
    } catch (err) {
      console.error(`[Persistence] Failed to load chunk ${key}:`, err.message);
    }
    return null;
  }

  markDirty(key) {
    this.dirtyChunks.add(key);
  }

  /**
   * Save all dirty chunks to disk.
   * @param {Map<string, Uint8Array>} chunks
   * @returns {number} number of chunks saved
   */
  flushChunks(chunks) {
    let saved = 0;
    for (const key of this.dirtyChunks) {
      const data = chunks.get(key);
      if (!data) continue;
      const filePath = join(CHUNKS_DIR, `${key.replace(',', '_')}.bin`);
      try {
        writeFileSync(filePath, Buffer.from(data));
        saved++;
      } catch (err) {
        console.error(`[Persistence] Failed to save chunk ${key}:`, err.message);
      }
    }
    this.dirtyChunks.clear();
    return saved;
  }

  /**
   * Load all saved chunks from disk.
   * @returns {Map<string, Uint8Array>}
   */
  loadAllChunks() {
    const chunks = new Map();
    try {
      const files = readdirSync(CHUNKS_DIR).filter(f => f.endsWith('.bin'));
      for (const file of files) {
        const key = file.replace('.bin', '').replace('_', ',');
        const buf = readFileSync(join(CHUNKS_DIR, file));
        chunks.set(key, new Uint8Array(buf));
      }
      if (chunks.size > 0) {
        console.log(`[Persistence] Loaded ${chunks.size} saved chunks`);
      }
    } catch (err) {
      console.error('[Persistence] Failed to load chunks:', err.message);
    }
    return chunks;
  }
}
