import http from 'node:http';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const root = join(import.meta.dirname, 'public');
const server = http.createServer((req, res) => {
  const body = readFileSync(join(root, 'index.html'));
  res.writeHead(200, { 'content-type': 'text/html' });
  res.end(body);
});
server.listen(8765, '127.0.0.1', () => console.log('listening 8765'));
