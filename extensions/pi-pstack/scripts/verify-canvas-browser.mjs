// biome-ignore-all lint/security/noSecrets: Fixture HTML, DOM expressions and Chrome filenames are public test data.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../skills/pr-review-canvas');
const output = resolve(process.argv[2] ?? '/tmp/pstack-canvas-browser');
await mkdir(output, { recursive: true });
const [template, css, renderer] = await Promise.all(['template.html', 'styles.css', 'renderer.js'].map((name) => readFile(join(root, name), 'utf8')));
const body =
  '<div class="header"><h1>Pi review canvas probe</h1></div><div class="content"><div class="file-card"><div class="file-hdr" onclick="toggle(this)"><span class="fname">fixture.js</span><span class="chev open">&gt;</span></div><div class="file-body open"><div data-diff="fixture"></div></div></div></div>';
const patch = '@@ -1,3 +1,3 @@\n-import old from "old";\n+import next from "next";\n-const value = 1;\n+const value = 2;\n+const unsafe = "</script><img src=x onerror=alert(1)>";';
const safe = JSON.stringify({ fixture: patch }).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
const html = template
  .replace('/* INJECT_CSS */', css)
  .replace('/* INJECT_JS */', renderer)
  .replace('<!-- INJECT_BODY -->', body)
  .replace('{"__PR_DIFFS_PLACEHOLDER__":true}', safe)
  .replace(/<link href="https:\/\/fonts[^>]+>/, '');
const file = join(output, 'canvas.html');
await writeFile(file, html, { flag: 'wx' });
const url = pathToFileURL(file).href;
const profile = await mkdtemp(join(tmpdir(), 'pstack-canvas-chrome-'));
const child = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', url],
  { stdio: 'ignore' },
);
let socket;
const pending = new Map();
let next = 0;
function selectPage(pages, expected) {
  const page = pages.find((entry) => entry.type === 'page' && entry.url === expected);
  if (!page) throw new Error(`No matching app page. Available pages ${JSON.stringify(pages.map(({ title, url }) => ({ title, url })))}`);
  return page;
}
function send(method, params = {}) {
  return new Promise((resolveCall, reject) => {
    const id = ++next;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`CDP command timed out. ${method}`));
    }, 10000);
    pending.set(id, { resolve: resolveCall, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true });
  assert.equal(response.exceptionDetails, undefined, 'browser evaluation succeeds');
  return response.result.value;
}
try {
  let port;
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const text = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '');
    if (text) {
      port = text.split('\n')[0];
      break;
    }
    await new Promise((done) => setTimeout(done, 40));
  }
  assert.ok(port, 'Chrome exposes its local debugging port');
  const base = `http://127.0.0.1:${port}`;
  const decoy = await (await fetch(`${base}/json/new?about:blank`, { method: 'PUT' })).json();
  const pages = await (await fetch(`${base}/json/list`)).json();
  assert.ok(pages.some((page) => page.id === decoy.id && page.url === 'about:blank'));
  const page = selectPage(pages, url);
  assert.notEqual(page.id, decoy.id, 'page selection ignores the decoy');
  let diagnostic;
  try {
    selectPage(pages, `${url}.missing`);
  } catch (error) {
    diagnostic = error.message;
  }
  assert.ok(diagnostic?.includes(url) && diagnostic.includes('about:blank') && diagnostic.includes('title'), 'no-match diagnostic lists actual titles and URLs');
  await writeFile(join(output, 'page-selection.json'), JSON.stringify({ selected: page.id, decoy: decoy.id, available: pages.map(({ title, url }) => ({ title, url })), diagnostic }, null, 2));
  socket = new WebSocket(page.webSocketDebuggerUrl);
  await new Promise((done, reject) => {
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data);
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    clearTimeout(waiter.timer);
    if (response.error) waiter.reject(new Error(JSON.stringify(response.error)));
    else waiter.resolve(response.result);
  });
  await send('Page.enable');
  const readyDeadline = Date.now() + 15000;
  while ((await evaluate('document.readyState === "complete" && document.querySelector("h1")?.textContent')) !== 'Pi review canvas probe') {
    assert.ok(Date.now() < readyDeadline, 'the selected canvas loads its positive app marker');
    await new Promise((done) => setTimeout(done, 40));
  }
  assert.equal(await evaluate('document.querySelector("h1").textContent'), 'Pi review canvas probe');
  assert.equal(await evaluate('document.querySelectorAll(".diff-add").length'), 2);
  assert.equal(await evaluate('document.querySelectorAll("img").length'), 0);
  const rendered = await evaluate('document.querySelector(".diff-table").textContent');
  assert.ok(rendered.includes('</script><img src=x onerror=alert(1)>'));
  assert.ok(!rendered.includes('import next'));
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".file-body")).display'), 'block');
  const target = await evaluate('(() => { const box = document.querySelector(".file-hdr").getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()');
  const before = await send('Page.captureScreenshot');
  await writeFile(join(output, 'before.png'), Buffer.from(before.data, 'base64'));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...target, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', clickCount: 1 });
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".file-body")).display'), 'none');
  const after = await send('Page.captureScreenshot');
  await writeFile(join(output, 'after.png'), Buffer.from(after.data, 'base64'));
  await writeFile(
    join(output, 'results.json'),
    `${JSON.stringify({ passed: true, checks: ['decoy tab excluded', 'no-match titles/URLs', 'positive app heading', 'diff rendering', 'literal unsafe HTML', 'import filtering', 'expanded state', 'fresh screenshot', 'real pointer collapse'], scope: 'Real isolated Chrome and source canvas assets. No keyboard/focus, perf, hosted UI or model-adherence claim.' }, null, 2)}\n`,
  );
  process.stdout.write('Canvas browser passes nine checks.\n');
  await send('Browser.close');
} finally {
  for (const waiter of pending.values()) {
    clearTimeout(waiter.timer);
    waiter.reject(new Error('Browser harness closed'));
  }
  socket?.close();
  if (child.exitCode === null && child.signalCode === null) child.kill('SIGTERM');
  await new Promise((done) => (child.exitCode !== null || child.signalCode !== null ? done() : child.once('exit', done)));
  await rm(profile, { recursive: true, force: true });
}
