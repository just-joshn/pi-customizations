import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { scan } from './static-scan.mjs';

const manifest = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));
const script = fileURLToPath(new URL('./static-scan.mjs', import.meta.url));
const cases = [
  { name: 'renderer and lifecycle', source: 'pi.registerToolRenderer((name, next) => next()); pi.on("agent_start", (_e, ctx) => { ctx.ui.setWorkingIndicator(); ctx.ui.setWorkingMessage(); });', passes: true },
  { name: 'ordinary computed access', source: 'const words = ["a"]; words[0];', passes: true },
  { name: 'host runtime import', source: 'import { rgbColor } from "@earendil-works/pi-tui";', passes: true },
  { name: 'deep import', source: 'import type { Theme } from "@earendil-works/pi-coding-agent/dist/index.js";', passes: false },
  { name: 'nonhost type import', source: 'import type { X } from "foreign";', passes: false },
  { name: 'agent theme override', source: 'const flip = (_e, ctx) => ctx.ui.setTheme("x"); pi.on("agent_start", flip);', passes: false },
  { name: 'indirect lifecycle override', source: 'const flip = (ctx) => ctx.ui.setTheme("x"); pi.on("agent_start", (_e, ctx) => flip(ctx));', passes: false },
  { name: 'ui replacement', source: 'ctx.ui.setHeader(() => {});', passes: false },
  { name: 'unknown api', source: 'pi.getSettings();', passes: false },
  { name: 'aliased ui', source: 'const ui = ctx.ui; ui.select("x", []);', passes: false },
  { name: 'computed api', source: 'pi["sendUserMessage"]("x");', passes: false },
  { name: 'host type import', source: 'import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";', passes: true },
  { name: 'forbidden import', source: 'import { readFile } from "node:fs/promises";', passes: false },
  { name: 'stdout', source: 'process.stdout.write("draw");', passes: false },
  { name: 'extra manifest key', source: '', extra: { scripts: {} }, passes: false },
  { name: 'theme override', source: 'pi.on("session_start", async (_event, ctx) => { ctx.ui.setTheme("dark"); });', passes: false },
  { name: 'prompt hook', source: 'pi.on("before_agent_start", () => ({}));', passes: false },
  { name: 'network', source: 'fetch("https://example.invalid");', passes: false },
  { name: 'model tool', source: 'pi.registerTool({});', passes: false },
  { name: 'message', source: 'pi.sendMessage({});', passes: false },
  { name: 'shipped command', source: await readFile(new URL('../../extensions/index.ts', import.meta.url), 'utf8'), passes: true },
  { name: 'named session_start handler', source: 'const flip = (_e, ctx) => ctx.ui.setTheme("x"); pi.on("session_start", flip);', passes: false },
  { name: 'stdout by bracket access', source: '(process as any)["stdout"].write("x");', passes: false },
  { name: 'tool_call hook', source: 'pi.on("tool_call", (e) => { e.input.command = "x"; });', passes: false },
  { name: 'shell exec', source: 'pi.exec("sh", ["-c", "id"]);', passes: false },
  { name: 'session persistence', source: 'pi.appendEntry("k", {});', passes: false },
  { name: 'active tools', source: 'pi.setActiveTools([]);', passes: false },
  { name: 'model change', source: 'pi.setModel({});', passes: false },
  { name: 'aliased api', source: 'const api = pi; api.exec("sh", []);', passes: false },
  { name: 'destructured api', source: 'const { registerTool } = pi; registerTool({});', passes: false },
  { name: 'destructured ui', source: 'const handler = (ctx) => { const { setHeader } = ctx.ui; setHeader(() => {}); };', passes: false },
  { name: 'api passed to a helper', source: 'const use = (api) => api.exec("sh", []); use(pi);', passes: false },
  { name: 'computed global', source: 'globalThis["process"].stdout.write("x");', passes: false },
  { name: 'unscanned module', source: 'import "./evil.js";', files: { 'extensions/evil.js': 'process.stdout.write("x");' }, passes: false },
  { name: 'shipped json resource', source: '', files: { 'extensions/data.json': '{}' }, passes: true },
];
for (const fixture of cases) {
  const root = await mkdtemp(join(tmpdir(), 'claude-theme-scan-'));
  try {
    await mkdir(join(root, 'extensions'));
    await writeFile(join(root, 'package.json'), JSON.stringify({ ...manifest, ...fixture.extra }));
    await writeFile(join(root, 'extensions/index.ts'), fixture.source);
    for (const [path, text] of Object.entries(fixture.files ?? {})) await writeFile(join(root, path), text);
    assert.equal((await scan(root)).length === 0, fixture.passes, fixture.name);
    const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
    assert.equal(result.status, fixture.passes ? 0 : 1, `${fixture.name}: ${result.stderr}`);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}
console.log('static-scan.selftest: PASS');
