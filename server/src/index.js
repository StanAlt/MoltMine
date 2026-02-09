import http from 'http';

const port = process.env.PORT || 8787;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' });
  res.end('MoltMine server placeholder: alive\n');
});

server.listen(port, () => {
  console.log(`MoltMine server placeholder listening on http://127.0.0.1:${port}`);
});
