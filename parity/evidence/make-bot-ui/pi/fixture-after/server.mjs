import { createServer } from 'node:http';
import { relayEvent } from '/<redacted len=97>.mjs';

const ROUTINE_DIR = '/<redacted len=134>';
const PORT = Number(process.argv[2] ?? 4173);
const PAGE = `<!doctype html><meta charset=utf-8><title>Wake bot</title>
<input id=note placeholder="note"><button id=go>Wake bot</button><p id=out></p>
<script>go.onclick=async()=>{const r=await fetch('/wake',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({kind:'click',note:note.value})});out.textContent=r.status===200?'Bot woke':'Failed ('+r.status+')'}</script>`;

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(PAGE);
  }
  if (req.method === 'POST' && req.url === '/wake') {
    try {
      const chunks = [];
      for await (const c of req) chunks.push(c);
      const { kind, note } = JSON.parse(Buffer.concat(chunks).toString());
      const result = await relayEvent(ROUTINE_DIR, { kind: String(kind), note: String(note) });
      res.writeHead(result.accepted ? 200 : 202);
      return res.end(JSON.stringify(result));
    } catch {
      res.writeHead(400);
      return res.end('{"accepted":false}');
    }
  }
  res.writeHead(404);
  res.end();
}).listen(PORT, '0.0.0.0');
