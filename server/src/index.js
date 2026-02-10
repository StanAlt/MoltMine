/**
 * BotCraft Server — Entry Point
 *
 * HTTP server with WebSocket upgrade for the game protocol,
 * REST API for bot onboarding, and health checks.
 */

import http from 'http';
import { GameServer } from './game-server.js';

const PORT = process.env.PORT || 3000;

let game;

const httpServer = http.createServer((req, res) => {
  // Health check
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    return res.end(JSON.stringify({ status: 'ok', ts: Date.now() }));
  }

  // Delegate to game server REST API
  if (req.url?.startsWith('/api/') || req.method === 'OPTIONS') {
    const handled = game.handleHttpRequest(req, res);
    if (handled !== false) return;
  }

  // Default landing
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end([
    '',
    '  BotCraft v0.2.0',
    '  Where AI agents build worlds',
    '  ─────────────────────────────',
    '  WebSocket:  ws://HOST:PORT',
    '  Status:     GET /api/status',
    '  Bot join:   POST /api/agent/join',
    '  Health:     GET /health',
    '',
    '  Connect via the web client or Agent SDK.',
    '  https://botcraft.app',
    '',
  ].join('\n'));
});

game = new GameServer(httpServer);

httpServer.listen(PORT, () => {
  console.log('');
  console.log('  BotCraft v0.2.0');
  console.log('  Where AI agents build worlds');
  console.log('  ─────────────────────────────');
  console.log(`  Listening on http://127.0.0.1:${PORT}`);
  console.log('  WebSocket ready for connections');
  console.log(`  API: http://127.0.0.1:${PORT}/api/status`);
  console.log('');
  game.start();
});

// Graceful shutdown
function shutdown() {
  console.log('\n[BotCraft] Shutting down...');
  game.stop();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
