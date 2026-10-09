#!/usr/bin/env node
// Family 05 /typescript-best-practices pair: invoke the skill on a tiny .ts/.tsx
// edit and observe loaded skill frontmatter (paths, disable-model-invocation)
// plus type-system-discipline-first body contract. Real PTY both sides.
//
// Usage: node scripts/capture-typescript-paths.mjs [--cursor-only|--pi-only|--both|--self-test]
// Evidence root: parity/evidence/typescript/
import { createHash } from 'node:crypto';
import { access, mkdir, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join, relative } from 'node:path';

import { sha256 } from '../recorder/files.mjs';
import { startAttempt } from '../recorder/index.mjs';
import { dumpScreen, screenLines, waitEither, waitSettled } from './journey-helpers.mjs';

const only = process.argv[2] ?? '--both';
const root = new URL('../', import.meta.url).pathname;
const localBin = (name) => join(homedir(), '.local', 'bin', name);
const referenceRulePath = join(homedir(), '.cursor', 'rules', 'pstack-models.mdc');
const piAgentDir = '/tmp/pi-ref-agent';
const piRulePath = join(piAgentDir, 'pstack', 'models.mdc');
const evidenceRoot = join(root, 'evidence', 'typescript');
const fixtureApp = join(evidenceRoot, 'fixture-app');
const PRODUCT_REL = ['src/id.ts', 'src/Badge.tsx'];
const GEOMETRY = { rows: 40, cols: 120 };
const LOCKED_FIXTURE_DIGEST = 'sha256:2b6b4668aab2c08758d602531426082a3d4a25d8eeb2104b963cbf35255f6004';
const LOCKED_SKILL_DIGEST = '28f9e61710e205f6f3c5476f333483cff0e988f6a5b639e2faad536344b40c5e';
const SETTLE_MS = 1_500_000;
const POLL_MS = 500;

const CURSOR_SKILL = join(
  root,
  'reference',
  'cursor-plugins',
  'pstack',
  'skills',
  'typescript-best-practices',
  'SKILL.md',
);
const PI_PACKAGE_SKILL = join(
  root,
  '..',
  'extensions',
  'pi-pstack',
  'skills',
  'typescript-best-practices',
  'SKILL.md',
);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writeRootFor(side) {
  return join(evidenceRoot, 'fixture-out', side);
}

function donePath(side) {
  return join(writeRootFor(side), 'done.txt');
}

function skillPathFor(side) {
  return side === 'cursor' ? CURSOR_SKILL : PI_PACKAGE_SKILL;
}

function tsPrompt(side) {
  const out = donePath(side);
  return (
    `/typescript-best-practices brand UserId in src/id.ts (stop using bare string) ` +
    `and tighten src/Badge.tsx so status is a required discriminant, not optional bags. ` +
    `Keep the change small. Work only inside this fixture cwd. ` +
    `Do not edit ledgers, parity/, or files outside this cwd. ` +
    `When finished, write exactly one line to ${out} naming the files you edited, then stop.`
  );
}

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function walkFiles(dir, base = dir) {
  const out = [];
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.git') continue;
      out.push(...(await walkFiles(abs, base)));
    } else if (entry.isFile()) {
      out.push(relative(base, abs));
    }
  }
  return out;
}

async function fileDigest(path) {
  const body = await readFile(path);
  return createHash('sha256').update(body).digest('hex');
}

function parseFrontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return { raw: null, fields: {} };
  const raw = m[1];
  const fields = {};
  for (const line of raw.split(/\r?\n/)) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    let value = line.slice(idx + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    fields[key] = value;
  }
  return { raw, fields };
}

function scoreSkillText(text, digestHex) {
  const { fields, raw } = parseFrontmatter(text);
  const pathsField = fields.paths ?? '';
  const hasTsGlob = /\*\*\/\*\.ts/.test(pathsField) || /"\*\*\/\*\.ts"/.test(pathsField);
  const hasTsxGlob = /\*\*\/\*\.tsx/.test(pathsField) || /"\*\*\/\*\.tsx"/.test(pathsField);
  const disableModelInvocation =
    String(fields['disable-model-invocation'] ?? '').toLowerCase() === 'true';
  const body = text.replace(/^---[\s\S]*?---\r?\n?/, '').trimStart();
  // Prefer the explicit first body sentence after the H1.
  const afterH1 = body.replace(/^#[^\n]*\r?\n+/, '').trimStart();
  const firstSentence = afterH1.split(/\r?\n/).find((l) => l.trim()) ?? '';
  const typeSystemDisciplineFirst = /type-system-discipline/i.test(firstSentence);
  return {
    digest: digestHex,
    matchesLockedDigest: digestHex === LOCKED_SKILL_DIGEST,
    frontmatterRaw: raw,
    pathsField,
    hasPathsTs: hasTsGlob,
    hasPathsTsx: hasTsxGlob,
    pathsOk: hasTsGlob && hasTsxGlob,
    disableModelInvocation,
    typeSystemDisciplineFirst,
    firstBodyLine: firstSentence,
    contractOk: hasTsGlob && hasTsxGlob && disableModelInvocation && typeSystemDisciplineFirst,
  };
}

async function scoreSkillFile(path) {
  const text = await readFile(path, 'utf8');
  const digestHex = await fileDigest(path);
  return { path, ...scoreSkillText(text, digestHex) };
}

async function baselineProduct() {
  const map = {};
  for (const rel of PRODUCT_REL) {
    map[rel] = await fileDigest(join(fixtureApp, rel));
  }
  return map;
}

async function restoreProduct() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of [...PRODUCT_REL, 'README.md', 'package.json']) {
    const src = join(baselineDir, rel);
    const dst = join(fixtureApp, rel);
    if (await pathExists(src)) {
      await mkdir(dirname(dst), { recursive: true });
      await writeFile(dst, await readFile(src));
    }
  }
  const files = await walkFiles(fixtureApp);
  for (const rel of files) {
    if (PRODUCT_REL.includes(rel) || rel === 'README.md' || rel === 'package.json') continue;
    if (rel.endsWith('.tsv') || rel.startsWith('out/') || rel.startsWith('.audit/')) {
      await rm(join(fixtureApp, rel), { force: true, recursive: true });
    }
  }
  await rm(join(fixtureApp, '.audit'), { recursive: true, force: true });
  await rm(join(fixtureApp, 'out'), { recursive: true, force: true });
}

async function snapshotBaseline() {
  const baselineDir = join(evidenceRoot, 'fixture-baseline');
  for (const rel of [...PRODUCT_REL, 'README.md', 'package.json']) {
    const dst = join(baselineDir, rel);
    await mkdir(dirname(dst), { recursive: true });
    await writeFile(dst, await readFile(join(fixtureApp, rel)));
  }
}

async function pollOnce(baseline) {
  const now = new Date().toISOString();
  const changed = [];
  for (const rel of PRODUCT_REL) {
    const dig = await fileDigest(join(fixtureApp, rel));
    if (dig !== baseline[rel]) changed.push(rel);
  }
  return { now, changed };
}

async function readDone(side) {
  const path = donePath(side);
  if (!(await pathExists(path))) return { exists: false, path, line: null };
  const line = (await readFile(path, 'utf8')).trim();
  return { exists: true, path, line };
}

function observeScreen(lines) {
  const text = lines.join('\n');
  return {
    typescriptSkill:
      /\/typescript-best-practices\b/i.test(text) ||
      /\[skill\]\s*typescript-best-practices/i.test(text) ||
      /\bUsed typescript-best-practices\b/i.test(text) ||
      /\btypescript-best-practices\b/i.test(text),
    typeSystemDisciplineMention: /type-system-discipline/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function spec({ side, cwd, argv, env, fixtureDigest, fixturePath }) {
  return {
    root: join(evidenceRoot, side),
    side,
    scenarioRef: 'cmd-typescript-paths',
    fixtureRef: { path: fixturePath, digest: fixtureDigest },
    artifactPaths: [],
    launch: { argv, cwd, env },
    geometry: GEOMETRY,
  };
}

const cursorSpec = (fixtureDigest) =>
  spec({
    side: 'cursor',
    cwd: fixtureApp,
    argv: [
      localBin('cursor-agent'),
      '--plugin-dir',
      join(root, 'reference', 'cursor-plugins', 'pstack'),
      '--plugin-dir',
      join(root, 'reference', 'cursor-plugins', 'cursor-team-kit'),
    ],
    env: { TERM: 'xterm-256color', HOME: process.env.HOME ?? '', PATH: process.env.PATH ?? '' },
    fixtureDigest,
    fixturePath: referenceRulePath,
  });

const piSpec = (fixtureDigest) =>
  spec({
    side: 'pi',
    cwd: fixtureApp,
    argv: [localBin('pi'), '--model', 'claude-subscription/claude-sonnet-5-5:medium'],
    env: {
      TERM: 'xterm-256color',
      HOME: process.env.HOME ?? '',
      PATH: process.env.PATH ?? '',
      PI_CODING_AGENT_DIR: piAgentDir,
    },
    fixtureDigest,
    fixturePath: piRulePath,
  });

async function restoreRule(bytes) {
  const backupPath = `${referenceRulePath}.typescript-paths-backup`;
  try {
    await rename(backupPath, referenceRulePath);
  } catch {
    await writeFile(referenceRulePath, bytes);
  }
}

async function selfTest() {
  const locked = await scoreSkillFile(CURSOR_SKILL);
  const piPkg = await scoreSkillFile(PI_PACKAGE_SKILL);
  const cases = [
    {
      name: 'locked-cursor-skill-passes',
      ok: locked.contractOk === true && locked.matchesLockedDigest === true,
    },
    {
      name: 'pi-package-retains-paths-contract',
      ok: piPkg.pathsOk === true && piPkg.contractOk === true,
    },
    {
      name: 'synthetic-no-disable',
      ok:
        scoreSkillText(
          '---\nname: x\npaths: ["**/*.ts", "**/*.tsx"]\ndisable-model-invocation: false\n---\n\n# X\n\nApply the **type-system-discipline** principle skill first.\n',
          'abc',
        ).disableModelInvocation === false,
    },
  ];
  const failed = cases.filter((c) => !c.ok);
  console.log(JSON.stringify({ selfTest: true, locked, piPkg, cases, failed: failed.map((c) => c.name) }, null, 2));
  if (failed.length) process.exit(1);
}

async function runSide(side, ruleBytes, ruleDigest) {
  const dir = join(evidenceRoot, side);
  const backupPath = `${referenceRulePath}.typescript-paths-backup`;
  await mkdir(dir, { recursive: true });
  await mkdir(writeRootFor(side), { recursive: true });
  await rm(donePath(side), { force: true });
  await snapshotBaseline();
  await restoreProduct();
  const baseline = await baselineProduct();
  const skillScore = await scoreSkillFile(skillPathFor(side));
  await writeFile(backupPath, ruleBytes);
  const rulePath = side === 'cursor' ? referenceRulePath : piRulePath;
  const prompt = tsPrompt(side);
  const pollLog = [];
  let firstEditAt = null;
  const edited = new Set();
  let attempt;
  try {
    await writeFile(rulePath, ruleBytes);
    attempt = await startAttempt(side === 'cursor' ? cursorSpec(ruleDigest) : piSpec(ruleDigest));
    if (side === 'cursor') {
      await waitEither(attempt, GEOMETRY, ['Tip:', 'agent'], 90_000);
    } else {
      await waitEither(attempt, GEOMETRY, ['Badge', 'id.ts', 'pi', 'README'], 120_000);
    }
    await dumpScreen(attempt, dir, '00-ready', GEOMETRY);

    const stopPoll = new AbortController();
    const pollLoop = (async () => {
      while (!stopPoll.signal.aborted) {
        const snap = await pollOnce(baseline);
        for (const p of snap.changed) {
          edited.add(p);
          if (!firstEditAt) firstEditAt = snap.now;
        }
        if (snap.changed.length) pollLog.push({ ts: snap.now, changed: [...snap.changed] });
        await sleep(POLL_MS);
      }
    })();

    attempt.input(Buffer.from(prompt), 'literal_user');
    await sleep(600);
    await dumpScreen(attempt, dir, '01-typed', GEOMETRY);
    attempt.input(Buffer.from('\r'), 'literal_user');
    await sleep(2000);
    await dumpScreen(attempt, dir, '02-submitted', GEOMETRY);

    try {
      await waitEither(
        attempt,
        GEOMETRY,
        ['typescript', 'type-system', 'UserId', 'Badge', 'brand', 'id.ts'],
        300_000,
      );
    } catch {
      // settle may still land artifacts
    }
    await dumpScreen(attempt, dir, '03-signal', GEOMETRY);

    const deadline = Date.now() + SETTLE_MS;
    let calm = 0;
    while (Date.now() < deadline) {
      const lines = await screenLines(attempt, GEOMETRY);
      const obs = observeScreen(lines);
      const done = await readDone(side);
      const snap = await pollOnce(baseline);
      for (const p of snap.changed) {
        edited.add(p);
        if (!firstEditAt) firstEditAt = snap.now;
      }
      if ((done.exists || edited.size > 0) && !obs.working) {
        calm += 1;
        if (calm >= 3) break;
      } else {
        calm = 0;
      }
      await sleep(800);
    }
    try {
      await waitSettled(attempt, GEOMETRY, 90_000);
    } catch {
      // best-effort
    }
    await sleep(1500);
    await dumpScreen(attempt, dir, '04-settled', GEOMETRY);

    stopPoll.abort();
    await pollLoop.catch(() => {});

    const finalSnap = await pollOnce(baseline);
    for (const p of finalSnap.changed) {
      edited.add(p);
      if (!firstEditAt) firstEditAt = finalSnap.now;
    }

    const screenFinal = observeScreen(await screenLines(attempt, GEOMETRY));
    const observations = {
      screenFinal,
      skillFile: skillScore,
      firstEditAt,
      editedPaths: [...edited],
      typescriptSkill: screenFinal.typescriptSkill,
      typeSystemDisciplineMention: screenFinal.typeSystemDisciplineMention,
      pathsOk: skillScore.pathsOk,
      disableModelInvocation: skillScore.disableModelInvocation,
      typeSystemDisciplineFirst: skillScore.typeSystemDisciplineFirst,
      contractOk: skillScore.contractOk,
      done: await readDone(side),
      pollSamples: pollLog.length,
    };

    const afterRule = await readFile(rulePath, 'utf8');
    const afterRuleDigest = await sha256(rulePath);
    await writeFile(join(dir, 'rule-after.mdc'), afterRule);
    await writeFile(join(dir, 'observations.json'), `${JSON.stringify(observations, null, 2)}\n`);
    await writeFile(join(dir, 'prompt.txt'), `${prompt}\n`);
    await writeFile(join(dir, 'poll-log.json'), `${JSON.stringify(pollLog, null, 2)}\n`);
    await writeFile(join(dir, 'skill-score.json'), `${JSON.stringify(skillScore, null, 2)}\n`);
    await writeFile(
      join(dir, 'baseline-product.json'),
      `${JSON.stringify(baseline, null, 2)}\n`,
    );

    const snapDir = join(attempt.dir, 'fixture-snapshot');
    await mkdir(snapDir, { recursive: true });
    for (const rel of [...PRODUCT_REL, 'README.md', 'package.json']) {
      const abs = join(fixtureApp, rel);
      if (await pathExists(abs)) {
        await mkdir(dirname(join(snapDir, rel)), { recursive: true });
        await writeFile(join(snapDir, rel), await readFile(abs));
      }
    }

    return {
      side,
      attemptDir: attempt.dir,
      attemptId: attempt.id,
      ruleUnchanged: afterRule === ruleBytes,
      afterDigest: afterRuleDigest,
      fixtureDigest: ruleDigest,
      prompt,
      observations,
    };
  } finally {
    if (attempt) {
      await attempt.cancel().catch(() => {});
      await attempt.done().catch(() => {});
    }
    await restoreRule(ruleBytes);
    await restoreProduct();
  }
}

if (only === '--self-test') {
  await selfTest();
  process.exit(0);
}

await snapshotBaseline();
const preRule = await readFile(referenceRulePath, 'utf8');
const preDigest = await sha256(referenceRulePath);
if (preDigest !== LOCKED_FIXTURE_DIGEST) {
  console.error(`Reference rule digest ${preDigest} does not match the locked fixture ${LOCKED_FIXTURE_DIGEST}`);
  process.exit(1);
}
const sides = only === '--cursor-only' ? ['cursor'] : only === '--pi-only' ? ['pi'] : ['cursor', 'pi'];
const results = [];
for (const side of sides) {
  const result = await runSide(side, preRule, preDigest);
  results.push(result);
  console.log(JSON.stringify(result));
}
console.log(
  JSON.stringify({
    scenario: 'cmd-typescript-paths',
    fixtureDigest: preDigest,
    results,
  }),
);
