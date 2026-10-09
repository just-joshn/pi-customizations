#!/usr/bin/env node
/**
 * Rerunnable Agent Helper MCP exercise: screenshot before, type marker, screenshot after.
 * Writes artifacts under OUT_DIR. Exit 0 only when before/after image bytes differ and marker typed.
 */
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

const HELPER =
  process.env.CURSOR_AGENT_HELPER ||
  `${process.env.HOME}/.cursor/agent-helper/Cursor Agent Helper.app/Contents/MacOS/cursor-agent-helper`;
const OUT =
  process.env.OUT_DIR ||
  new URL('../../../evidence/computer-use/live-001/', import.meta.url).pathname;
const APP = process.env.TARGET_APP || 'TextEdit';
const MARKER = process.env.MARKER || `CU_LIVE_001_${randomUUID().slice(0, 8)}`;
const USE_SPAWN_DISCLAIMED = process.env.SPAWN_DISCLAIMED !== '0';

mkdirSync(OUT, { recursive: true });

function nowIso() {
  return new Date().toISOString();
}

class McpClient {
  constructor(proc) {
    this.proc = proc;
    this.nextId = 1;
    this.pending = new Map();
    this.rl = createInterface({ input: proc.stdout });
    this.rl.on('line', (line) => {
      const trimmed = line.trim();
      if (!trimmed) return;
      let msg;
      try {
        msg = JSON.parse(trimmed);
      } catch {
        writeFileSync(join(OUT, 'mcp-nonjson-line.txt'), trimmed + '\n', { flag: 'a' });
        return;
      }
      if (msg.id != null && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (msg.error) reject(new Error(JSON.stringify(msg.error)));
        else resolve(msg.result);
      }
    });
    proc.stderr.on('data', (buf) => {
      writeFileSync(join(OUT, 'mcp-stderr.log'), buf, { flag: 'a' });
    });
  }

  request(method, params) {
    const id = this.nextId++;
    const payload = JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n';
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.proc.stdin.write(payload, (err) => {
        if (err) {
          this.pending.delete(id);
          reject(err);
        }
      });
      setTimeout(() => {
        if (this.pending.has(id)) {
          this.pending.delete(id);
          reject(new Error(`timeout waiting for ${method} id=${id}`));
        }
      }, 60000);
    });
  }

  notify(method, params) {
    this.proc.stdin.write(JSON.stringify({ jsonrpc: '2.0', method, params }) + '\n');
  }

  async callTool(name, args) {
    return this.request('tools/call', { name, arguments: args });
  }

  close() {
    try {
      this.proc.stdin.end();
    } catch {
      /* ignore */
    }
    this.rl.close();
  }
}

function extractImages(result) {
  const images = [];
  const content = result?.content ?? [];
  for (const part of content) {
    if (part.type === 'image' && part.data) {
      images.push({ mimeType: part.mimeType || 'image/png', data: part.data });
    }
  }
  return images;
}

function extractText(result) {
  const parts = [];
  for (const part of result?.content ?? []) {
    if (part.type === 'text' && part.text) parts.push(part.text);
  }
  return parts.join('\n');
}

function saveImages(prefix, images) {
  const paths = [];
  images.forEach((img, i) => {
    const ext = (img.mimeType || '').includes('jpeg') ? 'jpg' : 'png';
    const path = join(OUT, `${prefix}-${i}.${ext}`);
    writeFileSync(path, Buffer.from(img.data, 'base64'));
    paths.push(path);
  });
  return paths;
}

async function main() {
  const summary = {
    startedAt: nowIso(),
    helper: HELPER,
    app: APP,
    marker: MARKER,
    spawnDisclaimed: USE_SPAWN_DISCLAIMED,
    steps: [],
  };

  if (!existsSync(HELPER)) {
    summary.error = 'helper_missing';
    writeFileSync(join(OUT, 'exercise-summary.json'), JSON.stringify(summary, null, 2));
    process.exit(2);
  }

  const args = USE_SPAWN_DISCLAIMED ? ['spawn-disclaimed', '--', 'mcp'] : ['mcp'];
  const proc = spawn(HELPER, args, { stdio: ['pipe', 'pipe', 'pipe'] });
  const client = new McpClient(proc);

  try {
    await client.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'parity-cu-live-001', version: '0.1.0' },
    });
    client.notify('notifications/initialized', {});
    summary.steps.push({ step: 'initialize', ok: true, at: nowIso() });

    const apps = await client.callTool('list_apps', {});
    writeFileSync(join(OUT, 'list-apps.json'), JSON.stringify(apps, null, 2));
    summary.steps.push({ step: 'list_apps', ok: true, at: nowIso() });

    const before = await client.callTool('get_app_state', { app: APP });
    writeFileSync(join(OUT, 'before-raw.json'), JSON.stringify(before, null, 2));
    const beforeImages = extractImages(before);
    const beforePaths = saveImages('before', beforeImages);
    const beforeText = extractText(before);
    writeFileSync(join(OUT, 'before-text.txt'), beforeText);
    summary.steps.push({
      step: 'get_app_state_before',
      ok: beforeImages.length > 0,
      imageCount: beforeImages.length,
      paths: beforePaths,
      at: nowIso(),
    });

    const typed = await client.callTool('type_text', { app: APP, text: MARKER });
    writeFileSync(join(OUT, 'type-raw.json'), JSON.stringify(typed, null, 2));
    summary.steps.push({
      step: 'type_text',
      ok: !typed?.isError,
      isError: Boolean(typed?.isError),
      text: extractText(typed).slice(0, 500),
      at: nowIso(),
    });

    const after = await client.callTool('get_app_state', { app: APP });
    writeFileSync(join(OUT, 'after-raw.json'), JSON.stringify(after, null, 2));
    const afterImages = extractImages(after);
    const afterPaths = saveImages('after', afterImages);
    const afterText = extractText(after);
    writeFileSync(join(OUT, 'after-text.txt'), afterText);
    const markerVisible =
      afterText.includes(MARKER) ||
      beforeText.includes(MARKER) === false && afterText.includes(MARKER);
    const bytesDiffer =
      beforeImages[0] && afterImages[0]
        ? beforeImages[0].data !== afterImages[0].data
        : false;
    summary.steps.push({
      step: 'get_app_state_after',
      ok: afterImages.length > 0,
      imageCount: afterImages.length,
      paths: afterPaths,
      markerVisible: afterText.includes(MARKER),
      screenshotBytesDiffer: bytesDiffer,
      at: nowIso(),
    });

    summary.liveExercise =
      beforeImages.length > 0 &&
      afterImages.length > 0 &&
      !typed?.isError &&
      (afterText.includes(MARKER) || bytesDiffer);
    summary.finishedAt = nowIso();
    writeFileSync(join(OUT, 'exercise-summary.json'), JSON.stringify(summary, null, 2));
    writeFileSync(join(OUT, 'marker.txt'), MARKER + '\n');

    client.close();
    proc.kill('SIGTERM');
    process.exit(summary.liveExercise ? 0 : 1);
  } catch (err) {
    summary.error = String(err && err.stack ? err.stack : err);
    summary.finishedAt = nowIso();
    writeFileSync(join(OUT, 'exercise-summary.json'), JSON.stringify(summary, null, 2));
    client.close();
    try {
      proc.kill('SIGTERM');
    } catch {
      /* ignore */
    }
    process.exit(3);
  }
}

main();
