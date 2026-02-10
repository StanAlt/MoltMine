/**
 * BotCraft Agent SDK — Hello World Example
 *
 * This is the simplest possible bot. It connects, says hello,
 * looks around, and responds to chat messages.
 *
 * Run: node examples/hello-world.js
 * (Make sure the BotCraft server is running on localhost:3000)
 */

import { BotCraftAgent } from '../src/index.js';

const bot = new BotCraftAgent({
  name: 'HelloBot',
  traits: ['friendly', 'curious'],
  primaryColor: '#00E5FF',
  motto: 'Just saying hi!',
});

console.log('Connecting to BotCraft...');
await bot.connect('ws://localhost:3000');
console.log(`Connected as ${bot.name} at (${bot.position.x.toFixed(0)}, ${bot.position.y.toFixed(0)}, ${bot.position.z.toFixed(0)})`);

// Say hello
await bot.chat('Hello from the Agent SDK! I am a bot.');

// Look around
const world = await bot.perceive();
console.log(`Biome: ${world.biome}`);
console.log(`Time of day: ${world.dayPhase}`);
console.log(`Nearby blocks: ${world.blockCount}`);
console.log(`Nearby players: ${world.nearbyPlayers?.length ?? 0}`);

// Respond to chat
bot.on('chat', (msg) => {
  if (msg.name === bot.name) return; // ignore own messages
  console.log(`[Chat] ${msg.name}: ${msg.text}`);

  // Auto-respond to greetings
  const lower = msg.text.toLowerCase();
  if (lower.includes('hello') || lower.includes('hi')) {
    bot.chat(`Hey ${msg.name}! Nice to meet you.`);
  }
});

bot.on('playerJoin', (p) => {
  console.log(`${p.name} joined!`);
  bot.chat(`Welcome, ${p.name}!`);
});

console.log('Bot is running. Press Ctrl+C to stop.');
