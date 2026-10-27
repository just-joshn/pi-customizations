#!/usr/bin/env node
/**
 * Independent lock verifier (does not call sync-upstream buildPlan as authority).
 * Re-implements transform using the same exported helpers, then compares every entry.
 */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOURCE,
  AUTHORED,
  PATCHES,
  normalizeFrontmatter,
  applyPatch,
} from '../../../../extensions/pi-pstack/scripts/sync-upstream.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = join(here, '../../../../extensions/pi-pstack');
const up = process.argv[2] || '/tmp/cursor-plugins';
const commit = SOURCE.commit;
const lock = JSON.parse(readFileSync(join(pkg, 'upstream.lock.json'), 'utf8'));
const sha256 = (b) => createHash('sha256').update(b).digest('hex');

function gitShow(path) {
  return execFileSync('git', ['-C', up, 'show', `${commit}:${path}`], {
    encoding: 'buffer',
    maxBuffer: 64 * 1024 * 1024,
  });
}

function modeOf(path) {
  const mode = statSync(path).mode;
  return (mode & 0o111) !== 0 ? '100755' : '100644';
}

function expectedTarget(entry, sourceBytes) {
  const patch = PATCHES.find((p) => p.source === entry.source);
  if (patch) {
    return {
      bytes: Buffer.from(applyPatch(sourceBytes.toString('utf8'), patch)),
      transform: `patch:${patch.id}`,
    };
  }
  const skill = /^skills\/([^/]+)\/SKILL\.md$/.exec(entry.target);
  if (skill) {
    const n = normalizeFrontmatter(sourceBytes.toString('utf8'), skill[1]);
    return { bytes: Buffer.from(n.text), transform: 'frontmatter', sourceFrontmatter: n.sourceFrontmatter };
  }
  return { bytes: sourceBytes, transform: 'none' };
}

const diskMismatch = [];
const rebuildMismatch = [];
const transformMismatch = [];
let checked = 0;

for (const entry of lock.files) {
  checked++;
  const diskPath = join(pkg, entry.target);
  if (!existsSync(diskPath)) {
    diskMismatch.push({ target: entry.target, reason: 'missing on disk' });
    continue;
  }
  const diskBytes = readFileSync(diskPath);
  const diskSha = sha256(diskBytes);
  const diskMode = modeOf(diskPath);
  if (diskSha !== entry.targetSha256) {
    diskMismatch.push({
      target: entry.target,
      reason: 'targetSha256 vs disk',
      lock: entry.targetSha256,
      disk: diskSha,
    });
  }
  if (diskMode !== entry.mode) {
    diskMismatch.push({
      target: entry.target,
      reason: 'mode vs disk',
      lock: entry.mode,
      disk: diskMode,
    });
  }

  let sourceBytes;
  try {
    sourceBytes = gitShow(entry.source);
  } catch (e) {
    rebuildMismatch.push({ target: entry.target, reason: `git show failed: ${e.message}` });
    continue;
  }
  const sourceSha = sha256(sourceBytes);
  if (sourceSha !== entry.sourceSha256) {
    rebuildMismatch.push({
      target: entry.target,
      reason: 'sourceSha256 vs git show',
      lock: entry.sourceSha256,
      git: sourceSha,
    });
  }

  const rebuilt = expectedTarget(entry, sourceBytes);
  if (rebuilt.transform !== entry.transform) {
    transformMismatch.push({
      target: entry.target,
      lock: entry.transform,
      rebuilt: rebuilt.transform,
    });
  }
  const targetSha = sha256(rebuilt.bytes);
  if (targetSha !== entry.targetSha256) {
    rebuildMismatch.push({
      target: entry.target,
      reason: 'targetSha256 vs rebuilt',
      lock: entry.targetSha256,
      rebuilt: targetSha,
    });
  }
  if (diskSha !== targetSha) {
    rebuildMismatch.push({
      target: entry.target,
      reason: 'disk vs rebuilt',
      disk: diskSha,
      rebuilt: targetSha,
    });
  }
  if (entry.transform === 'frontmatter' && entry.sourceFrontmatter !== undefined) {
    // ok — optional field present
  }
}

// Orphan / authored inventory
function walkFiles(root, rel = '') {
  const { readdirSync } = awaitImportFs();
  const out = [];
  for (const name of readdirSync(join(root, rel), { withFileTypes: true })) {
    const r = rel ? `${rel}/${name.name}` : name.name;
    if (name.isDirectory()) {
      if (name.name === 'node_modules') {
        out.push({ path: r, kind: 'node_modules_dir' });
        continue;
      }
      const kids = walkFilesSync(join(root, rel, name.name), r);
      if (kids.length === 0) out.push({ path: r, kind: 'empty_dir' });
      else out.push(...kids);
    } else out.push({ path: r, kind: 'file' });
  }
  return out;
}
function awaitImportFs() {
  return requireFs();
}
import { readdirSync as _readdirSync, statSync as _statSync } from 'node:fs';
function requireFs() {
  return { readdirSync: _readdirSync };
}
function walkFilesSync(abs, rel) {
  const out = [];
  for (const name of _readdirSync(abs, { withFileTypes: true })) {
    const r = `${rel}/${name.name}`;
    if (name.isDirectory()) {
      if (name.name === 'node_modules') {
        out.push({ path: r, kind: 'node_modules_dir' });
        continue;
      }
      const kids = walkFilesSync(join(abs, name.name), r);
      if (kids.length === 0) out.push({ path: r, kind: 'empty_dir' });
      else out.push(...kids);
    } else out.push({ path: r, kind: 'file' });
  }
  return out;
}

const lockTargets = new Set(lock.files.map((f) => f.target));
const authored = new Set(lock.authored || AUTHORED);
const scopes = ['skills', 'agents', 'automations', 'docs', 'licenses'];
const extras = [];
const notes = [];
for (const scope of scopes) {
  const abs = join(pkg, scope);
  if (!existsSync(abs)) continue;
  for (const item of walkFilesSync(abs, scope)) {
    if (item.kind === 'empty_dir') {
      notes.push(`empty dir: ${item.path}`);
      continue;
    }
    if (item.kind === 'node_modules_dir') {
      notes.push(`node_modules: ${item.path}`);
      continue;
    }
    if (!lockTargets.has(item.path) && !authored.has(item.path)) {
      extras.push(item.path);
    }
  }
}

// Skill counts
const skillDirs = _readdirSync(join(pkg, 'skills'), { withFileTypes: true })
  .filter((d) => d.isDirectory())
  .map((d) => d.name)
  .toSorted();
const skillMd = [];
const hidden = [];
const invocable = [];
for (const name of skillDirs) {
  const p = join(pkg, 'skills', name, 'SKILL.md');
  if (!existsSync(p)) continue;
  skillMd.push(name);
  const text = readFileSync(p, 'utf8');
  const fm = /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? '';
  const disabled = /^disable-model-invocation:\s*true\s*$/m.test(fm);
  if (disabled) hidden.push(name);
  else invocable.push(name);
}

const report = {
  commit,
  sourceMatch: JSON.stringify(lock.source) === JSON.stringify(SOURCE),
  lockSource: lock.source,
  SOURCE,
  fileCount: lock.files.length,
  checked,
  diskMismatchCount: diskMismatch.length,
  rebuildMismatchCount: rebuildMismatch.length,
  transformMismatchCount: transformMismatch.length,
  diskMismatch: diskMismatch.slice(0, 50),
  rebuildMismatch: rebuildMismatch.slice(0, 50),
  transformMismatch: transformMismatch.slice(0, 50),
  authoredDeclared: [...authored],
  authoredExists: [...authored].map((a) => ({ path: a, exists: existsSync(join(pkg, a)) })),
  authoredInLock: [...authored].filter((a) => lockTargets.has(a)),
  extrasOutsideLockAndAuthored: extras,
  notes,
  skills: {
    dirsWithSkillMd: skillMd.length,
    skillMdNames: skillMd,
    hiddenDisableModelInvocation: hidden.length,
    hiddenNames: hidden,
    invocable: invocable.length,
    invocableNames: invocable,
  },
  syncCheckNote: 'also ran sync-upstream --check separately',
};

const outPath = join(here, 'verify-lock-result.json');
writeFileSync(outPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      ok: diskMismatch.length === 0 && rebuildMismatch.length === 0 && transformMismatch.length === 0 && extras.length === 0,
      checked,
      diskMismatch: diskMismatch.length,
      rebuildMismatch: rebuildMismatch.length,
      transformMismatch: transformMismatch.length,
      extras: extras.length,
      skills: report.skills.dirsWithSkillMd,
      hidden: report.skills.hiddenDisableModelInvocation,
      invocable: report.skills.invocable,
      outPath,
    },
    null,
    2,
  ),
);
