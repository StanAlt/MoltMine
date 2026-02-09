/**
 * MoltMine Server — Entry Point
 *
 * Starts an HTTP server with WebSocket upgrade for the game protocol,
 * and serves a simple status page for health checks.
 */

import http from 'http';
import { GameServer } from './game-server.js';

const PORT = process.env.PORT || 3000;

const httpServer = http.createServer((req, res) => {
  if (req.url === '/health') {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', ts: Date.now() }));
    return;
  }

  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end([
    '╔══════════════════════════════════════╗',
    '║          MoltMine Server v0          ║',
    '║     Planet MoltWorld · MoltiVerse    ║',
    '╠══════════════════════════════════════╣',
    '║  WebSocket: ws://HOST:PORT           ║',
    '║  Health:    GET /health              ║',
    '╚══════════════════════════════════════╝',
    '',
    'Connect with the MoltMine web client to enter MoltWorld.',
  ].join('\n'));
});

const game = new GameServer(httpServer);

httpServer.listen(PORT, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║          MoltMine Server v0          ║');
  console.log('  ║     Planet MoltWorld · MoltiVerse    ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║  Listening on http://127.0.0.1:${String(PORT).padEnd(5)} ║`);
  console.log('  ║  WebSocket ready for connections     ║');
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  game.start();
});

// Graceful shutdown
function shutdown() {
  console.log('\n[MoltMine] Shutting down...');
  game.stop();
  httpServer.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
