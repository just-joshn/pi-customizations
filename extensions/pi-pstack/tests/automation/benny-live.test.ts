import { execFileSync, spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createInterface } from 'node:readline';

import { afterAll, expect, test } from 'vitest';
import { spawnInTmux, workerDir } from '../../src/automation/dispatch.ts';
import type { RunId } from '../../src/automation/model.ts';
import { verifyReproduction } from '../../src/automation/proof.ts';
import { completeSettledRuns } from '../../src/automation/settle.ts';
import { readLog } from '../../src/automation/store.ts';
import { wireBenny } from '../../src/automation/wiring.ts';
import { killTmuxServer, makeProject, PI, stopProject, TEST_PI_ARGS, TMUX, until, workerTestEnv } from '../worker-lifecycle/harness.ts';
import { bennyProject, fakeGh, fakeSlack, OPS_CHANNEL, REPORT, ROOT_TS, TRIAGE_USER, wiringDeps, writeProof } from './benny-fakes.ts';
import { auditLiveWorker, checkExistingFix, checkLiveCaptures, RWA_BASELINE, RWA_FIX, RWA_PATCHED, type RwaCapture, type RwaServer } from './rwa-evidence.ts';

const FIXTURE = resolve('tests/automation/rwa-fixture.cjs');
const quote = (value: string) => `'${value.replaceAll("'", "'\\''")}'`;
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
afterAll(killTmuxServer);

function prerequisites(): { cache: string; node: string; tools: string; browser: string } | { reason: string } {
  const cache = process.env['PSTACK_RWA_CACHE'] ?? join(homedir(), 'pstack-runs/app-cache/realworld-app');
  if (!existsSync(join(cache, '.git')) || !existsSync(join(cache, 'node_modules/vite/bin/vite.js'))) return { reason: `RWA cache absent or dependencies missing at ${cache}; populate the pinned public app cache outside the repository` };
  const tools = process.env['PSTACK_RWA_PLAYWRIGHT'] ?? join(homedir(), '.cache/verify-rwa/node_modules/playwright');
  if (!existsSync(tools)) return { reason: `RWA browser toolchain absent at ${tools}; install Playwright and Chromium outside the repository` };
  const browser = (createRequire(import.meta.url)(tools) as { chromium: { executablePath(): string } }).chromium.executablePath();
  if (!existsSync(browser)) return { reason: `RWA Chromium executable absent at ${browser}` };
  let node = process.env['PSTACK_RWA_NODE'];
  if (!node) {
    try {
      node = execFileSync('mise', ['which', 'node', '--tool', 'node@24'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return { reason: 'RWA requires app-supported Node 24; set PSTACK_RWA_NODE to an installed Node 24 executable' };
    }
  }
  if (!existsSync(node) || !execFileSync(node, ['--version'], { encoding: 'utf8' }).startsWith('v24.')) return { reason: `RWA requires Node 24, not the toolchain at ${node}` };
  for (const commit of [RWA_BASELINE, RWA_PATCHED]) {
    try {
      git(cache, 'cat-file', '-e', `${commit}^{commit}`);
    } catch {
      return { reason: `RWA cache lacks pinned commit ${commit}` };
    }
  }
  return { cache, node, tools, browser };
}

async function startServer(cache: string, node: string, out: string, commit: string) {
  mkdirSync(out, { recursive: true });
  const process = spawn(node, [FIXTURE, 'serve', cache, out, commit], { stdio: ['ignore', 'pipe', 'pipe'] });
  let errors = '';
  process.stderr.on('data', (chunk: Buffer) => {
    errors += chunk.toString();
  });
  const server = await new Promise<RwaServer>((resolve, reject) => {
    createInterface({ input: process.stdout }).once('line', (line) => resolve(JSON.parse(line) as RwaServer));
    process.once('exit', (code) => reject(Error(`RWA server exited ${code}: ${errors}`)));
  });
  return {
    server,
    stop: async () => {
      const exited = new Promise<void>((resolve) => process.once('exit', () => resolve()));
      process.kill('SIGTERM');
      await exited;
    },
  };
}

test('captures alone do not establish a live application reproduction', () => {
  const project = bennyProject();
  try {
    const since = new Date();
    writeProof(project.dir, 'live-red' as RunId, since);
    const ctx = { artifactDirectory: `${project.dir}/artifacts`, runId: 'live-red', since, now: new Date(since.getTime() + 10000) };
    expect(verifyReproduction(ctx).ok).toBe(true);
    expect(() =>
      checkLiveCaptures(join(project.dir, 'artifacts/live-red'), { commit: RWA_BASELINE, origin: 'http://localhost:1', apiOrigin: 'http://localhost:2', started: since.getTime(), ready: since.getTime(), managerPid: 0 }, RWA_BASELINE),
    ).toThrow(/captures.json/);
  } finally {
    rmSync(project.dir, { recursive: true, force: true });
  }
});

test('a scripted Benny worker reproduces real cents loss twice and verifies the mirrored existing fix without authoring', async (t) => {
  const available = prerequisites();
  if ('reason' in available) {
    t.skip(available.reason);
    return;
  }
  const { cache, node, tools, browser } = available;
  const out = mkdtempSync(join(tmpdir(), 'benny-live-'));
  const project = makeProject('pstack-benny-live-');
  const servers: Awaited<ReturnType<typeof startServer>>[] = [];
  try {
    const baseline = join(out, 'baseline');
    const patched = join(out, 'patched');
    const baselineHost = await startServer(cache, node, baseline, RWA_BASELINE);
    servers.push(baselineHost);
    const patchedHost = await startServer(cache, node, patched, RWA_PATCHED);
    servers.push(patchedHost);
    const benny = bennyProject({ root: project.dir, operationsChannel: OPS_CHANNEL });
    const slack = fakeSlack();
    const report = { ...REPORT, text: `Paying $12.34 displays Paid $12.00. Existing fix ${RWA_FIX} at ${RWA_PATCHED}.` };
    slack.messages[0] = { ts: ROOT_TS, user: 'U123', text: report.text };
    slack.messages.push({ ts: '1762900001.999999', user: TRIAGE_USER, text: `Cents bug. ${RWA_FIX}\n[benny:bug]` });
    const gh = fakeGh([{ title: 'Payment loses cents', body: `Existing fix ${RWA_FIX} at ${RWA_PATCHED}`, state: 'open' }]);
    writeFileSync(join(project.dir, 'thread.json'), JSON.stringify(slack.messages));
    writeFileSync(join(project.dir, 'tracker.json'), JSON.stringify(gh.issues));
    git(project.dir, 'fetch', '--quiet', '--no-tags', cache, `${RWA_PATCHED}:refs/fixtures/pr-5`);
    const spawn = spawnInTmux(project.dir, {
      tmuxSocket: TMUX,
      piCommand: [PI],
      extraPiArgs: TEST_PI_ARGS,
      extraEnv: { ...workerTestEnv(project), PSTACK_RWA_CHROMIUM: browser },
      agentsDir: project.agentsDir,
      resolveModel: () => ({ provider: 'scripted', id: 'echo', thinkingLevel: null }),
    });
    const commands: string[] = [];
    const automation = wireBenny(
      benny.config('reproduce'),
      wiringDeps(slack, gh, {
        inputCommit: () => project.commit,
        spawnWorker: async (runId, assignmentPath) => {
          const artifact = join(project.dir, 'artifacts', runId);
          const drive = (folder: string) => [node, FIXTURE, 'drive', join(folder, 'server.json'), tools, folder].map(quote).join(' ');
          commands.push(`git -C ${quote(project.dir)} log --all --format='%H %s' --grep='request rejection, cents'`, drive(baseline), drive(patched), [node, FIXTURE, 'record', baseline, patched, artifact].map(quote).join(' '));
          const actions = [
            { tool: 'read', args: { path: join(project.dir, 'thread.json') } },
            { tool: 'read', args: { path: join(project.dir, 'tracker.json') } },
            ...commands.map((command) => ({ tool: 'bash', args: { command } })),
            {
              text: JSON.stringify({
                text: 'Verified existing PR #5. The real UI loses cents twice on the baseline and preserves cents twice on the patched commit.',
                status: 'Verifying existing fix',
                operations: 'Verified the mirrored existing fix without authoring.',
              }),
            },
          ];
          writeFileSync(join(assignmentPath, '..', 'brief.md'), `@@script ${JSON.stringify(actions)}`);
          await spawn(runId, assignmentPath);
        },
      }),
    );
    const run = await automation.handle(report);
    if (run.status !== 'dispatched') throw Error(`not dispatched: ${JSON.stringify(run)}`);
    await until(async () => (await completeSettledRuns(automation)) > 0 || automation.pendingRuns().length === 0, Boolean, 60000, 'live UI worker to finish; measured baseline journey 9.452s, four captures have a 60s ceiling');
    const worker = workerDir(project.dir, run.runId);
    const session = readFileSync(join(worker, 'session', readdirSync(join(worker, 'session'))[0] as string), 'utf8');
    writeFileSync(join(out, 'worker-session.jsonl'), session);
    expect(session).not.toContain('"isError":true');
    expect(session).toContain(RWA_PATCHED);
    for (const command of commands) expect(session).toContain(JSON.stringify(command).slice(1, -1));
    checkLiveCaptures(baseline, baselineHost.server, RWA_BASELINE);
    checkLiveCaptures(patched, patchedHost.server, RWA_PATCHED);
    const searches = auditLiveWorker(session, commands);
    expect(() => auditLiveWorker(session, commands.slice(0, 1))).toThrow(/unapproved shell/);
    const existing = { searches, fix: RWA_FIX, before: project.commit, after: git(join(worker, 'worktree'), 'rev-parse', 'HEAD'), patched: patchedHost.server };
    checkExistingFix(existing);
    expect(git(join(worker, 'worktree'), 'diff', '--stat')).toBe('');
    expect(readLog(automation.store)).toContainEqual(expect.objectContaining({ kind: 'repro-outcome', status: 'Verifying existing fix', existingFix: true }));
    expect(gh.pulls).toEqual([]);
    expect(slack.posts).toHaveLength(1);
    expect(slack.posts[0]?.text).toContain('Verified existing PR #5');
    expect(() => checkExistingFix({ ...existing, searches: [] })).toThrow(/missing observable search/);
    expect(() => checkExistingFix({ ...existing, after: RWA_PATCHED })).toThrow(/author over/);
    expect(() => checkExistingFix({ ...existing, patched: baselineHost.server })).toThrow(/patched build/);
    const captures = JSON.parse(readFileSync(join(baseline, 'captures.json'), 'utf8')) as RwaCapture[];
    expect(() => checkLiveCaptures(baseline, baselineHost.server, RWA_BASELINE, captures.slice(0, 1))).toThrow(/two live captures/);
    const first = captures[0];
    if (first === undefined) throw Error('missing first live capture');
    expect(() => checkLiveCaptures(baseline, baselineHost.server, RWA_BASELINE, [first, first])).toThrow(/distinct browser sessions/);
    expect(() =>
      checkLiveCaptures(
        baseline,
        baselineHost.server,
        RWA_BASELINE,
        captures.map((capture) => ({ ...capture, stem: first.stem })),
      ),
    ).toThrow(/distinct screenshot bytes/);
    const domFile = join(baseline, `${first.stem}.aria.yml`);
    const dom = readFileSync(domFile, 'utf8');
    writeFileSync(domFile, dom.replace('Paid $12.00', 'Paid $12.34'));
    expect(() => checkLiveCaptures(baseline, baselineHost.server, RWA_BASELINE)).toThrow(/DOM capture/);
    writeFileSync(domFile, dom);
    expect(() =>
      checkLiveCaptures(
        baseline,
        baselineHost.server,
        RWA_BASELINE,
        captures.map((capture) => ({ ...capture, origin: 'http://localhost:1' })),
      ),
    ).toThrow(/app port/);
    expect(() =>
      checkLiveCaptures(
        baseline,
        { ...baselineHost.server, origin: 'http://localhost:1' },
        RWA_BASELINE,
        captures.map((capture) => ({ ...capture, origin: 'http://localhost:1' })),
      ),
    ).toThrow(/trace network/);
    expect(() =>
      checkLiveCaptures(
        baseline,
        baselineHost.server,
        RWA_BASELINE,
        captures.map((capture) => ({ ...capture, state: 'Paid $12.34' })),
      ),
    ).toThrow(/discriminating cents/);
    const requests = readFileSync(join(baseline, 'requests.json'), 'utf8');
    writeFileSync(join(baseline, 'requests.json'), requests.replaceAll('"/transactions"', '"/testData/seed"'));
    expect(() => checkLiveCaptures(baseline, baselineHost.server, RWA_BASELINE)).toThrow(/only login and UI payment/);
    writeFileSync(join(baseline, 'requests.json'), requests);
  } finally {
    await stopProject(project);
    for (const server of servers.reverse()) await server.stop();
    if (process.env['PSTACK_RWA_KEEP_EVIDENCE'] !== '1') rmSync(out, { recursive: true, force: true });
    else console.log(`RWA local evidence ${out}`);
  }
}, 120000);
