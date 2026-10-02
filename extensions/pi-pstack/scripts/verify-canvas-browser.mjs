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
let socket;
const pending = new Map();
const heapChunks = [];
const networkResponses = [];
const finishedRequests = new Set();
const traceEvents = [];
let traceComplete = false;
// Handlers must exist before Chrome does. A signal that lands after the spawn but before they are installed kills this process and orphans Chrome.
import { appendFileSync } from 'node:fs';
const dbg = (m) => appendFileSync(`/tmp/u11/cvdebug-${process.pid}.log`, `${m}\n`);
const controller = new AbortController();
function rejectPending(reason) {
  for (const waiter of pending.values()) waiter.reject(reason);
  pending.clear();
}
const interrupt = () => {
  controller.abort(new Error('Canvas browser verification interrupted'));
  rejectPending(controller.signal.reason);
};
process.on('SIGINT', interrupt);
process.on('SIGTERM', interrupt);
const profile = await mkdtemp(join(tmpdir(), 'pstack-canvas-chrome-'));
const child = spawn(
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-background-networking', url],
  { stdio: 'ignore' },
);
const chromeRunning = () => child.exitCode === null && child.signalCode === null;
child.once('exit', () => rejectPending(new Error('Chrome exited before the harness finished')));
let next = 0;
function selectPage(pages, expected) {
  const page = pages.find((entry) => entry.type === 'page' && entry.url === expected);
  if (!page) throw new Error(`No matching app page. Available pages ${JSON.stringify(pages.map(({ title, url }) => ({ title, url })))}`);
  return page;
}
// Nothing here has a deadline of its own. A wait ends when its condition holds, the harness is interrupted, or
// Chrome exits, so a slow machine only makes the run longer. The caller owns the overall time budget.
async function until(description, probe) {
  dbg(`DEBUG until ${description} ${new Date().toISOString()}`);
  for (;;) {
    controller.signal.throwIfAborted();
    assert.ok(chromeRunning(), `Chrome stays running while waiting for ${description}`);
    const value = await probe();
    if (value) return value;
    await new Promise((done) => setTimeout(done, 40));
  }
}
function send(method, params = {}) {
  controller.signal.throwIfAborted();
  return new Promise((resolveCall, reject) => {
    const id = ++next;
    pending.set(id, { resolve: resolveCall, reject });
    dbg(`DEBUG send ${id} ${method} ${new Date().toISOString()}`);
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const response = await send('Runtime.evaluate', { expression, returnByValue: true });
  assert.equal(response.exceptionDetails, undefined, 'browser evaluation succeeds');
  return response.result.value;
}
try {
  const port = await until('Chrome to expose its local debugging port', async () => (await readFile(join(profile, 'DevToolsActivePort'), 'utf8').catch(() => '')).split('\n')[0]);
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
    controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true });
    controller.signal.throwIfAborted();
    socket.addEventListener('open', done, { once: true });
    socket.addEventListener('error', reject, { once: true });
  });
  socket.addEventListener('message', ({ data }) => {
    const response = JSON.parse(data);
    if (response.method === 'Network.responseReceived') networkResponses.push(response.params);
    if (response.method === 'Network.loadingFinished') finishedRequests.add(response.params.requestId);
    if (response.method === 'Tracing.dataCollected') traceEvents.push(...response.params.value);
    if (response.method === 'Tracing.tracingComplete') traceComplete = true;
    if (response.method === 'HeapProfiler.addHeapSnapshotChunk') {
      heapChunks.push(response.params.chunk);
      return;
    }
    if (response.id) dbg(`DEBUG recv ${response.id} ${new Date().toISOString()}`);
    const waiter = pending.get(response.id);
    if (!waiter) return;
    pending.delete(response.id);
    if (response.error) waiter.reject(new Error(JSON.stringify(response.error)));
    else waiter.resolve(response.result);
  });
  await send('Page.enable');
  await until('the selected canvas to load its positive app marker', async () => (await evaluate('document.readyState === "complete" && document.querySelector("h1")?.textContent')) === 'Pi review canvas probe');
  await send('Network.enable');
  await send('Page.reload', { ignoreCache: true });
  const documentResponse = await until('the selected app document to complete its network load', () => networkResponses.find((entry) => entry.response.url === url && entry.type === 'Document' && finishedRequests.has(entry.requestId)));
  const responseBody = await send('Network.getResponseBody', { requestId: documentResponse.requestId });
  assert.equal(responseBody.base64Encoded, false, 'fixture response is text');
  assert.equal(responseBody.body, html, 'network capture returns exact canvas fixture bytes');
  await writeFile(join(output, 'canvas-response.html'), responseBody.body);
  await writeFile(join(output, 'network.json'), JSON.stringify(documentResponse, null, 2));
  await until('the reloaded app to complete rendering', () => evaluate('document.readyState === "complete" && document.querySelector("h1")?.textContent === "Pi review canvas probe"'));
  assert.equal(await evaluate('document.querySelector("h1").textContent'), 'Pi review canvas probe');
  assert.equal(await evaluate('document.querySelectorAll(".diff-add").length'), 2);
  assert.equal(await evaluate('document.querySelectorAll("img").length'), 0);
  const rendered = await evaluate('document.querySelector(".diff-table").textContent');
  assert.ok(rendered.includes('</script><img src=x onerror=alert(1)>'));
  assert.ok(!rendered.includes('import next'));
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".file-body")).display'), 'block');
  await send('Accessibility.enable');
  const accessibility = await send('Accessibility.getFullAXTree');
  assert.ok(
    accessibility.nodes.some((node) => node.role?.value === 'heading' && node.name?.value === 'Pi review canvas probe'),
    'accessibility tree contains the real canvas heading',
  );
  await writeFile(join(output, 'accessibility.json'), JSON.stringify(accessibility, null, 2));
  await send('Profiler.enable');
  await send('Profiler.start');
  await evaluate('(() => { const body = document.querySelector(".file-body"); let total = 0; for (let index = 0; index < 100000; index++) total += getComputedStyle(body).display.length; return total; })()');
  const cpu = await send('Profiler.stop');
  assert.ok(cpu.profile.nodes.length > 0 && cpu.profile.samples?.length > 0, 'read-only synthetic style work produces sampled CPU data');
  await writeFile(join(output, 'canvas.cpuprofile'), JSON.stringify(cpu.profile));
  await send('HeapProfiler.enable');
  await send('HeapProfiler.takeHeapSnapshot');
  const heapText = heapChunks.join('');
  const heap = JSON.parse(heapText);
  assert.ok(heap.snapshot.meta.node_fields.includes('self_size') && heap.nodes.length > 0, 'heap snapshot contains a node graph');
  assert.equal(heap.nodes.length, heap.snapshot.node_count * heap.snapshot.meta.node_fields.length, 'heap node table is complete');
  assert.equal(heap.edges.length, heap.snapshot.edge_count * heap.snapshot.meta.edge_fields.length, 'heap edge table is complete');
  await writeFile(join(output, 'canvas.heapsnapshot'), heapText);
  await writeFile(
    join(output, 'profile-evidence.json'),
    JSON.stringify(
      {
        url,
        cpuSamples: cpu.profile.samples.length,
        cpuNodes: cpu.profile.nodes.length,
        heapNodes: heap.snapshot.node_count,
        heapEdges: heap.snapshot.edge_count,
        heapBytes: Buffer.byteLength(heapText),
        scope: 'Accessibility and capture mechanisms on the isolated app. Synthetic read-only CPU work, single heap graph, no leak or performance-improvement verdict.',
      },
      null,
      2,
    ),
  );
  const target = await evaluate('(() => { const box = document.querySelector(".file-hdr").getBoundingClientRect(); return { x: box.x + box.width / 2, y: box.y + box.height / 2 }; })()');
  await send('Tracing.start', { categories: 'devtools.timeline', transferMode: 'ReportEvents' });
  const before = await send('Page.captureScreenshot');
  await writeFile(join(output, 'before.png'), Buffer.from(before.data, 'base64'));
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', ...target, button: 'left', clickCount: 1 });
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', ...target, button: 'left', clickCount: 1 });
  assert.equal(await evaluate('getComputedStyle(document.querySelector(".file-body")).display'), 'none');
  await send('Tracing.end');
  await until('Chrome to complete the selected app interaction trace', () => traceComplete);
  assert.ok(
    traceEvents.some((entry) => entry.name === 'EventDispatch' && entry.args?.data?.type === 'click'),
    'trace contains the actual pointer click',
  );
  await writeFile(join(output, 'canvas.trace.json'), JSON.stringify({ traceEvents, scope: 'Isolated browser pointer interaction. Not performance improvement, hosted UI, or model-adherence evidence.' }));
  const after = await send('Page.captureScreenshot');
  await writeFile(join(output, 'after.png'), Buffer.from(after.data, 'base64'));
  await writeFile(
    join(output, 'results.json'),
    `${JSON.stringify({ passed: true, checks: ['decoy tab excluded', 'no-match titles/URLs', 'positive app heading', 'diff rendering', 'literal unsafe HTML', 'import filtering', 'expanded state', 'fresh screenshot', 'real pointer collapse', 'accessibility heading', 'sampled CPU profile', 'heap snapshot graph', 'network fixture bytes', 'pointer click trace'], scope: 'Real isolated Chrome and source canvas assets. CPU uses read-only synthetic style work; a heap capture is not leak proof. No keyboard/focus, performance improvement, hosted UI or model-adherence claim.' }, null, 2)}\n`,
  );
  process.stdout.write('Canvas browser passes fourteen checks.\n');
  await send('Browser.close');
} finally {
  rejectPending(new Error('Browser harness closed'));
  socket?.close();
  if (chromeRunning()) child.kill('SIGTERM');
  await new Promise((done) => (chromeRunning() ? child.once('exit', done) : done()));
  try {
    await rm(profile, { recursive: true, force: true });
  } finally {
    process.off('SIGINT', interrupt);
    process.off('SIGTERM', interrupt);
  }
}
