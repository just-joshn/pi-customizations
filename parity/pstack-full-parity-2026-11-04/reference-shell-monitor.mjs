import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, resolve } from 'node:path';
import { Script } from 'node:vm';

const [evidenceArg, destinationArg, casesArg] = process.argv.slice(2);
if (!evidenceArg || !destinationArg) throw new Error('Usage: node reference-shell-monitor.mjs <reference-evidence-directory> <output.json>');
const evidence = resolve(evidenceArg);
const require = createRequire(import.meta.url);
assert.equal(
  createHash('sha256')
    .update(readFileSync(join(evidence, 're2js/package.tgz')))
    .digest('hex'),
  'a99650dbb6d8cbd77d5954bc76f9706eb0e4b4bb942c8ccb0cfba8006b607cc6',
);
const re2Path = join(evidence, 're2js/package');
assert.equal(
  createHash('sha256')
    .update(readFileSync(join(re2Path, 'build/index.cjs.cjs')))
    .digest('hex'),
  '230f725da3faab52ab1ea7efcfff1a4dc41e489d79015926a3269adb58544565',
);
const re2Package = JSON.parse(readFileSync(join(re2Path, 'package.json'), 'utf8'));
assert.equal(re2Package.version, '1.2.2');
const { RE2JS } = require(re2Path);
const inventory = JSON.parse(readFileSync(join(evidence, 'host-modules.json'), 'utf8'));
const factoryHashes = {
  '../local-exec/dist/index.js': '9209baa549d98f4780aea681d99427808525faee764d3c847ecaaa20c6392ba7',
  '../agent-exec/dist/index.js': 'b939ba2fbf1a792bec307b6f6bd18acfda801fb8296da58ae66e477c166cdaf9',
};
const moduleNamed = (name) => {
  const record = inventory.modules.find((row) => row.name === name);
  assert.ok(record, `Missing reference factory ${name}`);
  assert.equal(record.fileSha256, '943765eeedb4fe5d4ab6d95fc839c3eaf0c070e734577409badb9dea5b0ed293');
  assert.equal(record.factorySha256, factoryHashes[name]);
  const raw = readFileSync(join(evidence, record.evidence), 'utf8');
  assert.equal(createHash('sha256').update(raw.slice(2, -3)).digest('hex'), record.factorySha256);
  const formatted = spawnSync(resolve('node_modules/.bin/biome'), ['format', '--stdin-file-path=reference.js'], { input: raw, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  assert.equal(formatted.status, 0, formatted.stderr);
  return { record, text: formatted.stdout };
};
const local = moduleNamed('../local-exec/dist/index.js');
const executor = moduleNamed('../agent-exec/dist/index.js');
const between = (text, start, end) => {
  const offset = text.indexOf(start);
  const limit = text.indexOf(end, offset);
  assert.ok(offset >= 0 && limit > offset, `Missing reference boundaries ${start}, ${end}`);
  return text.slice(offset, limit);
};
const observerSource = between(local.text, 'const qr = 65536;', 'class Dr {');
const taskIdSource = between(executor.text, 'function Mt(', 'function Ut(');
const factorySource = between(local.text, 'const qr = 65536;', 'class Nr {');
const cases = casesArg
  ? JSON.parse(readFileSync(casesArg, 'utf8'))
  : [
      { id: 'SHELL-WATCH-001', name: 'matches output before a newline', pattern: 'READY', reason: 'ready', steps: [{ write: 'READY' }] },
      { id: 'SHELL-WATCH-002', name: 'counts every occurrence in one chunk', pattern: 'HIT', reason: 'hits', steps: [{ write: 'HIT HIT HIT' }, { finish: true }] },
      { id: 'SHELL-WATCH-003', name: 'matches a pattern split across chunks', pattern: 'READY', reason: 'ready', steps: [{ write: 'REA' }, { write: 'DY' }, { finish: true }] },
      { id: 'SHELL-WATCH-004', name: 'does not recount matches in carryover', pattern: 'HIT', reason: 'hits', steps: [{ write: 'HIT ' }, { write: 'HIT ' }, { write: 'tail HIT' }, { finish: true }] },
      { id: 'SHELL-WATCH-005', name: 'uses the reason fallback', pattern: 'READY', reason: '   ', steps: [{ write: 'READY' }] },
      { id: 'SHELL-WATCH-006', name: 'limits notification titles', pattern: 'READY', reason: 'r'.repeat(510), steps: [{ write: 'READY' }] },
      { id: 'SHELL-WATCH-007', name: 'stops after one hundred matches', pattern: 'HIT', reason: 'hits', steps: [{ write: 'HIT '.repeat(150) }, { finish: true }] },
      { id: 'SHELL-WATCH-008', name: 'supports RE2 inline flags', pattern: '(?i)ready', reason: 'ready', steps: [{ write: 'READY' }] },
      { id: 'SHELL-WATCH-009', expectError: true, name: 'rejects unsupported RE2 lookahead', pattern: '(?=a)', reason: 'lookahead', steps: [{ write: 'a' }] },
      { id: 'SHELL-WATCH-010', expectError: true, name: 'rejects patterns longer than five hundred characters', pattern: 'a'.repeat(501), reason: 'large pattern', steps: [] },
      { id: 'SHELL-WATCH-011', name: 'omits oversized matched text', pattern: 'a+', reason: 'long match', steps: [{ write: 'a'.repeat(5_001) }] },
      { id: 'SHELL-WATCH-012', name: 'debounces from the second occurrence', pattern: 'HIT', reason: 'hits', steps: [{ write: 'HIT ' }, { advance: 4_000 }, { write: 'HIT ' }, { advance: 1_000 }, { advance: 4_000 }, { finish: true }] },
      { id: 'SHELL-WATCH-013', name: 'uses the occurrence number for a single deferred match', pattern: 'HIT', reason: 'hits', steps: [{ write: 'HIT HIT' }, { advance: 5_000 }, { finish: true }] },
      { id: 'SHELL-WATCH-014', name: 'enforces the minimum debounce', pattern: 'HIT', reason: 'hits', debounceMs: 1, steps: [{ write: 'HIT HIT' }, { advance: 4_999 }, { advance: 1 }, { finish: true }] },
      { id: 'SHELL-WATCH-015', name: 'matches across internal processing slices', pattern: 'READY', reason: 'ready', steps: [{ repeat: { text: 'x', count: 65_535, suffix: 'READY' } }, { finish: true }] },
      { id: 'SHELL-WATCH-016', name: 'handles zero width matches without looping', pattern: '$', reason: 'end', steps: [{ write: 'abc' }, { write: 'def' }, { finish: true }] },
      {
        id: 'SHELL-WATCH-017',
        name: 'ignores output and duplicate finish after completion',
        pattern: 'HIT',
        reason: 'hits',
        steps: [{ write: '' }, { write: 'HIT HIT' }, { finish: true }, { write: 'HIT' }, { finish: true }, { advance: 5_000 }],
      },
      { id: 'SHELL-WATCH-018', name: 'remains silent when nothing matches', pattern: 'READY', reason: 'ready', steps: [{ write: 'not ready' }, { finish: true }, { advance: 5_000 }] },
    ];
for (const scenario of cases) {
  const notifications = [];
  const timers = new Map();
  let clock = 0;
  let timerId = 0;
  const context = {
    jt: RE2JS,
    Date: { now: () => clock },
    setTimeout: (callback, ms) => {
      const id = ++timerId;
      timers.set(id, { callback, at: clock + ms });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    notifications,
    config: { pattern: scenario.pattern, reason: scenario.reason },
    debounceMs: scenario.debounceMs,
  };
  const program = `${taskIdSource}\nconst a = { mhW: Mt };\n${observerSource}\nglobalThis.observer = new Or({shellId: 'reference-shell', outputPath: '/reference/output.txt', conversationId: 'reference-session', toolCallId: 'reference-call', config, debounceMs, registry: { enqueue: value => notifications.push(value.payload) }});`;
  try {
    new Script(program).runInNewContext(context, { timeout: 1_000, contextCodeGeneration: { strings: false, wasm: false } });
    scenario.checkpoints = [];
    for (const step of scenario.steps) {
      if ('write' in step) context.observer.observe(step.write);
      else if ('repeat' in step) context.observer.observe(step.repeat.text.repeat(step.repeat.count) + step.repeat.suffix);
      else if ('advance' in step) {
        clock += step.advance;
        for (const [id, timer] of [...timers])
          if (timer.at <= clock) {
            timers.delete(id);
            timer.callback();
          }
      } else context.observer.finish();
      scenario.checkpoints.push(notifications.map((notice) => ({ sequence: Number(notice.taskId.split(':').at(-1)), title: notice.title, detail: notice.detail })));
    }
    context.observer.finish();
  } catch (error) {
    if (!scenario.expectError) throw error;
    scenario.error = error.message;
  }
  assert.equal(scenario.error !== undefined, scenario.expectError === true);
}
const factoryCases = [
  { id: 'SHELL-WATCH-019', name: 'empty', pattern: '' },
  { id: 'SHELL-WATCH-020', name: 'whitespace', pattern: '  ' },
  { id: 'SHELL-WATCH-021', name: 'malformed', pattern: '[' },
  { id: 'SHELL-WATCH-022', name: 'oversized', pattern: 'a'.repeat(501) },
];
for (const scenario of factoryCases) {
  const warnings = [];
  const context = { jt: RE2JS, a: {}, s: { join }, config: { pattern: scenario.pattern, reason: 'invalid watch' }, Jr: { warn: (_ctx, message) => warnings.push(message) } };
  const program = `${factorySource}\nglobalThis.created = new Dr(undefined, '/reference', {}).createObserver({}, 'shell', 'conversation', 'call', config) !== undefined;`;
  new Script(program).runInNewContext(context, { timeout: 1_000, contextCodeGeneration: { strings: false, wasm: false } });
  scenario.observerCreated = context.created;
  scenario.warning = warnings.length > 0;
}
writeFileSync(
  destinationArg,
  `${JSON.stringify({ provenance: { kind: 'Original Cursor observer executed in isolation, not a live Cursor service', cliVersion: inventory.cliVersion, indexSha256: local.record.fileSha256, module: local.record.name, moduleSha256: local.record.factorySha256, regexEngine: 're2js@1.2.2', sourceRevision: 'ae5650febf4320793844c12c4adaa937f417f8da', generator: 'parity/pstack-full-parity-2026-11-04/reference-shell-monitor.mjs' }, cases, factoryCases }, null, 2)}\n`,
);
console.log(`Executed ${cases.length} monitor scenarios and ${factoryCases.length} factory scenarios against Cursor's shipped code. Expected results were not read from pi-pstack.`);
