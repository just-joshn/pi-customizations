const { spawn, execFileSync } = require('node:child_process');
const { createHash, randomUUID } = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');

const BASELINE = '39d86229dd9966a441821d85fed11bb6d01bac57';
const PATCHED = '035b8d947f86fbbe666efa1e7fa8d8ca358af393';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2));
const read = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const git = (root, ...args) => execFileSync('git', ['-C', root, ...args], { maxBuffer: 256 * 1024 * 1024 });
const freePort = () =>
  new Promise((resolve, reject) => {
    const server = net.createServer();
    server.on('error', reject);
    server.listen(0, 'localhost', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });

async function serve(cache, out, commit) {
  if (![BASELINE, PATCHED].includes(commit)) throw Error('unrecognized pinned commit');
  const app = path.join(out, 'app');
  fs.mkdirSync(app, { recursive: true });
  const archive = git(cache, 'archive', commit);
  execFileSync('tar', ['-x', '-C', app], { input: archive });
  fs.symlinkSync(path.join(cache, 'node_modules'), path.join(app, 'node_modules'));
  for (const [from, to] of [
    ['scripts/mock-aws-exports.js', 'src/aws-exports.js'],
    ['scripts/mock-aws-exports-es5.js', 'aws-exports-es5.js'],
    ['data/database-seed.json', 'data/database.json'],
  ])
    fs.copyFileSync(path.join(app, from), path.join(app, to));
  const seed = fs.readFileSync(path.join(app, 'data/database.json'));
  const frontend = await freePort();
  const backend = await freePort();
  const requests = [];
  const gateway = http.createServer((request, response) => {
    const chunks = [];
    request.on('data', (chunk) => chunks.push(chunk));
    request.on('end', () => {
      const body = Buffer.concat(chunks);
      const entry = { at: Date.now(), method: request.method, path: request.url, session: request.headers['x-benny-session'], body: body.toString() };
      const upstream = http.request({ hostname: 'localhost', port: backend, path: request.url, method: request.method, headers: request.headers }, (reply) => {
        entry.status = reply.statusCode;
        requests.push(entry);
        json(path.join(out, 'requests.json'), requests);
        response.writeHead(reply.statusCode, reply.headers);
        reply.pipe(response);
      });
      upstream.on('error', (error) => {
        response.writeHead(502);
        response.end(error.message);
      });
      upstream.end(body);
    });
  });
  await new Promise((resolve) => gateway.listen(0, 'localhost', resolve));
  const apiPort = gateway.address().port;
  const children = [];
  const stop = () => {
    for (const child of children) child.kill('SIGTERM');
    gateway.close();
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);
  const started = Date.now();
  const start = (args, env, marker, log) =>
    new Promise((resolve, reject) => {
      const child = spawn(process.execPath, args, { cwd: app, env: { ...process.env, NODE_ENV: 'development', PORT: String(frontend), ...env }, stdio: ['ignore', 'pipe', 'pipe'] });
      children.push(child);
      const file = fs.createWriteStream(path.join(out, log));
      const deadline = setTimeout(() => reject(Error(`${log} exceeded 30s startup ceiling; baseline probe measured 9.452s including browser journey`)), 30000);
      child.once('exit', (code) => {
        clearTimeout(deadline);
        reject(Error(`${log} exited ${code}`));
      });
      let output = '';
      for (const stream of [child.stdout, child.stderr])
        stream.on('data', (chunk) => {
          file.write(chunk);
          output += chunk;
          if (output.includes(marker)) {
            clearTimeout(deadline);
            resolve(child.pid);
          }
        });
    });
  try {
    const apiPid = await start(['node_modules/ts-node/dist/bin.js', '-P', 'tsconfig.tsnode.json', '--files', 'backend/app.ts'], { VITE_BACKEND_PORT: String(backend) }, 'Backend server running', 'api.log');
    const uiPid = await start(['node_modules/vite/bin/vite.js', '--host', 'localhost', '--port', String(frontend), '--strictPort'], { VITE_BACKEND_PORT: String(apiPort) }, 'Local:', 'ui.log');
    const identity = {
      commit,
      tree: git(cache, 'rev-parse', `${commit}^{tree}`).toString().trim(),
      archiveSha: digest(archive),
      seedSha: digest(seed),
      origin: `http://localhost:${frontend}`,
      apiOrigin: `http://localhost:${apiPort}`,
      backend,
      apiPid,
      uiPid,
      managerPid: process.pid,
      node: process.version,
      started,
      ready: Date.now(),
    };
    json(path.join(out, 'server.json'), identity);
    console.log(JSON.stringify(identity));
  } catch (error) {
    stop();
    throw error;
  }
}

async function drive(serverFile, tools, out) {
  const server = read(serverFile);
  const { chromium } = require(tools);
  const browser = await chromium.launch({ executablePath: process.env.PSTACK_RWA_CHROMIUM });
  const captures = [];
  try {
    for (let index = 0; index < 2; index++) {
      const session = randomUUID();
      const note = `benny-cents-${session}`;
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: { 'x-benny-session': session } });
      await context.tracing.start({ screenshots: true, snapshots: true });
      const page = await context.newPage();
      page.setDefaultTimeout(15000);
      const start = Date.now();
      await page.goto(`${server.origin}/signin`);
      await page.locator('[data-test=signin-username] input').fill('Heath93');
      await page.locator('[data-test=signin-password] input').fill('s3cret');
      await page.locator('[data-test=signin-submit]').click();
      await page.locator('[data-test=sidenav-user-balance]').waitFor();
      await page.locator('[data-test=nav-top-new-transaction]').click();
      await page.locator('[data-test=user-list-search-input]').fill('Kristian');
      await page.locator('[data-test=user-list-item-GjWovtg2hr]').click();
      await page.locator('#amount').fill('12.34');
      await page.locator('[data-test=transaction-create-description-input] input').fill(note);
      await page.locator('[data-test=transaction-create-submit-payment]').click();
      await page.getByText(/Paid \$/).waitFor();
      const state = await page.getByText(/Paid \$/).textContent();
      const stem = `capture-${index}`;
      await page.screenshot({ path: path.join(out, `${stem}.png`), animations: 'disabled' });
      fs.writeFileSync(path.join(out, `${stem}.aria.yml`), await page.locator('body').ariaSnapshot());
      await context.tracing.stop({ path: path.join(out, `${stem}.zip`) });
      captures.push({ session, note, start, at: Date.now(), origin: server.origin, state, stem });
      await context.close();
    }
    json(path.join(out, 'captures.json'), captures);
    console.log(JSON.stringify(captures));
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  const [mode, ...args] = process.argv.slice(2);
  const record = async (baseline, patched, target) => {
    fs.mkdirSync(target, { recursive: true });
    const runs = (folder, tag) =>
      read(path.join(folder, 'captures.json')).map((capture, index) => {
        const artifact = `${tag}-${index}.png`;
        fs.copyFileSync(path.join(folder, `${capture.stem}.png`), path.join(target, artifact));
        return { at: new Date(capture.at).toISOString(), artifact, state: capture.state };
      });
    const reproductions = runs(baseline, 'baseline');
    json(path.join(target, 'repro.json'), { reproductions, existingFix: { url: 'https://github.com/just-joshn/realworld-app/pull/5', outcome: 'confirmed', baseline: reproductions, patched: runs(patched, 'patched') } });
  };
  (mode === 'serve' ? serve(...args) : mode === 'record' ? record(...args) : drive(...args)).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
module.exports = { BASELINE, PATCHED };
