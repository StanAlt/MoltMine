#!/usr/bin/env node
/**
 * MoltyMind CLI — Launch an AI-powered Molty into BotCraft.
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node run.js [profile-path]
 *
 * Environment:
 *   OPENAI_API_KEY     — Required. Your OpenAI API key.
 *   OPENAI_MODEL       — Optional. Model to use (default: gpt-4o)
 *   BOTCRAFT_SERVER    — Optional. Override WebSocket URL (default: ws://localhost:3000)
 */

import { MoltyMind } from './src/index.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync, existsSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Load .env file if it exists ─────────────────────────
// Looks for .env in the molty-mind directory or project root.
// Format: KEY=VALUE (one per line, no quotes needed)
for (const envPath of [join(__dirname, '.env'), join(__dirname, '..', '..', '.env')]) {
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.+?)\s*$/);
      if (match && !process.env[match[1]]) {
        process.env[match[1]] = match[2];
      }
    }
    break;
  }
}

// ── Validate environment ────────────────────────────────

if (!process.env.OPENAI_API_KEY) {
  console.error('');
  console.error('  Error: OPENAI_API_KEY environment variable is required.');
  console.error('');
  console.error('  Usage:');
  console.error('    OPENAI_API_KEY=sk-... node run.js');
  console.error('');
  console.error('  You can also set the model:');
  console.error('    OPENAI_MODEL=gpt-4o-mini OPENAI_API_KEY=sk-... node run.js');
  console.error('');
  process.exit(1);
}

// ── Load profile ────────────────────────────────────────

const profilePath = process.argv[2] || join(__dirname, 'profiles', 'victorio.json');
const serverUrl = process.env.BOTCRAFT_SERVER || undefined;
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';

console.log('');
console.log('  MoltyMind v0.1.0');
console.log('  AI brain for BotCraft agents');
console.log('  ─────────────────────────────');
console.log(`  Profile: ${profilePath}`);
console.log(`  Model:   ${model}`);
if (serverUrl) console.log(`  Server:  ${serverUrl}`);
console.log('');

// ── Start ───────────────────────────────────────────────

const mind = new MoltyMind(profilePath, { serverUrl });

// Graceful shutdown
function shutdown() {
  console.log('');
  mind.stop().then(() => process.exit(0)).catch(() => process.exit(1));
  // Force exit after 5s
  setTimeout(() => process.exit(0), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// Launch
mind.start().catch((err) => {
  console.error('');
  console.error(`  Failed to start MoltyMind: ${err.message}`);
  console.error('');
  console.error('  Make sure the BotCraft server is running:');
  console.error('    cd server && node src/index.js');
  console.error('');
  process.exit(1);
});
