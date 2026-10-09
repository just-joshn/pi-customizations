import { createServer } from 'node:http';
import { relayEvent } from '/<redacted len=97>.mjs';

const ROUTINE_DIR = process.env.ROUTINE_DIR; // routine directory only; holds the key server-side
const PORT = Number(process.env.PORT ?? 8787);
if (!ROUTINE_DIR) throw new Error('ROUTINE_DIR not set');

const PAGE = `<!doctype html><meta charset=utf-8><title>Bot UI</title>
<h1>Wake the bot</h1><button id=b>Ping</button> <pre id=o></pre>
<script>b.onclick=async()=>{const r=await fetch('/event',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({command:'ping',note:'clicked'})});o.textContent=r.status+' '+await r.text()}</script>`;

createServer(async (req, res) => {
  if (req.method === 'GET' && req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' });
    return res.end(PAGE);
  }
  if (req.method === 'POST' && req.url === '/event') {
    try {
      let raw = '';
      for await (const c of req) { raw += c; if (raw.length > 4096) throw new Error('too large'); }
      const { command, note } = JSON.parse(raw);
      const r = await relayEvent(ROUTINE_DIR, { command: String(command), note: String(note ?? '') });
      res.writeHead(r.accepted ? 200 : 502, { 'content-type': 'application/json' });
      return res.end(JSON.stringify(r));
    } catch { res.writeHead(400); return res.end('bad request'); }
  }
  res.writeHead(404); res.end();
}).listen(PORT, '0.0.0.0');
