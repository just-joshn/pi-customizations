#!/usr/bin/env node
// Enumerates every parity unit pi-maintainer must account for: each paragraph, list item,
// table row, and code block of the four reconstruction documents, each recorded evidence
// probe case, and each Aider test function in the modules the evidence ran.
// Usage: node scripts/census.mjs [--json]
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const sources = JSON.parse(readFileSync(join(packageRoot, 'parity/sources.json'), 'utf8'));

export const sourcesDir = resolve(process.env.PI_MAINTAINER_SOURCES ?? sources.documentsDir);
export const aiderCheckout = resolve(process.env.AIDER_CHECKOUT ?? sources.aider.checkout);

const sha256 = (text) => createHash('sha256').update(text).digest('hex');

function slug(text) {
  return text
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

const LIST_ITEM = /^(\s*)([-*+]|\d+\.)\s+/;
const TABLE_ROW = /^\s*\|/;
const TABLE_SEPARATOR = /^\s*\|?\s*:?-{3,}/;
const FENCE = /^\s*(```|~~~)(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const ANCHOR = /^\s*<a id=/;

function createCollector(docKey) {
  const units = [];
  const sectionCounts = new Map();
  const slugUses = new Map();
  let section = 'preamble';
  let current = null;
  const flush = () => {
    const body = current?.lines.join('\n').trim();
    if (body) {
      const count = (sectionCounts.get(section) ?? 0) + 1;
      sectionCounts.set(section, count);
      units.push({ id: `${docKey}/${section}/${current.kind[0]}${count}`, kind: current.kind, line: current.start, text: body, sha256: sha256(body) });
    }
    current = null;
  };
  return {
    units,
    flush,
    start(kind, index, line) {
      flush();
      current = { kind, start: index + 1, lines: [line] };
    },
    append(line) {
      current.lines.push(line);
    },
    hasOpen: () => current !== null,
    openKind: () => current?.kind,
    heading(title) {
      flush();
      const base = slug(title) || 'section';
      const uses = (slugUses.get(base) ?? 0) + 1;
      slugUses.set(base, uses);
      section = uses === 1 ? base : `${base}-${uses}`;
    },
  };
}

function consumeFence(lines, index, collector) {
  const fence = FENCE.exec(lines[index] ?? '');
  const marker = fence[1];
  collector.start((fence[2] ?? '').trim().startsWith('mermaid') ? 'mermaid' : 'code', index, lines[index]);
  let cursor = index + 1;
  for (; cursor < lines.length; cursor += 1) {
    collector.append(lines[cursor] ?? '');
    if ((lines[cursor] ?? '').trim().startsWith(marker)) break;
  }
  collector.flush();
  return cursor;
}

function consumeTableRow(lines, index, collector) {
  if (TABLE_SEPARATOR.test(lines[index + 1] ?? '') && collector.openKind() !== 'row') {
    collector.flush();
    return index + 1;
  }
  collector.start('row', index, lines[index]);
  collector.flush();
  return index;
}

export function documentUnits(docKey, text) {
  const lines = text.split('\n');
  const collector = createCollector(docKey);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    const heading = HEADING.exec(line);
    if (FENCE.test(line)) index = consumeFence(lines, index, collector);
    else if (heading) collector.heading(heading[2] ?? '');
    else if (!line.trim() || ANCHOR.test(line)) collector.flush();
    else if (TABLE_ROW.test(line)) index = consumeTableRow(lines, index, collector);
    else if (LIST_ITEM.test(line)) collector.start('item', index, line);
    else if (!collector.hasOpen()) collector.start(line.trimStart().startsWith('>') ? 'quote' : 'paragraph', index, line);
    else collector.append(line);
  }
  collector.flush();
  return collector.units;
}

function evidenceUnits(dirKey, dir, specs) {
  const units = [];
  for (const spec of specs) {
    const path = join(sourcesDir, dir, spec.file);
    const data = spec.json === false ? readFileSync(path, 'utf8') : JSON.parse(readFileSync(path, 'utf8'));
    for (const [name, value] of spec.cases(data)) {
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      units.push({ id: `${dirKey}/${spec.label}/${slug(name)}`, kind: 'evidence', line: 0, text: `${spec.file}: ${name}`, sha256: sha256(text) });
    }
  }
  return units;
}

const EVIDENCE = {
  'ev-edit': {
    dir: 'Aider-Precise-Code-Editing-Evidence',
    specs: [
      { file: 'probes.json', label: 'probe', cases: (d) => Object.entries(d).filter(([k]) => k !== 'installed_source_comparison') },
      { file: 'cli-apply-results.json', label: 'cli-apply', cases: (d) => d.map((c) => [`${c.format}-${c.operation}`, c]) },
      { file: 'patch-lifecycle.json', label: 'patch-lifecycle', cases: (d) => Object.entries(d) },
    ],
  },
  'ev-git': {
    dir: 'aider-git-architecture-evidence-2026-10-09',
    specs: [{ file: 'probe-results.json', label: 'probe', cases: (d) => d.experiments.map((e) => [e.experiment, e]) }],
  },
  'ev-map': {
    dir: 'aider-repository-map-evidence',
    specs: [
      {
        file: 'probe-results.json',
        label: 'probe',
        cases: (d) => ['provider_tags', 'map_with_chat_file', 'global_map', 'refresh_files_stale_until_forced', 'forced_map', 'zero_budget_disables_map'].map((k) => [k, d[k]]),
      },
      { file: 'query-results.json', label: 'query', cases: (d) => d.languages.filter((l) => l.query_exists).map((l) => [l.language, l]) },
      { file: 'boundary-results.txt', label: 'boundary', json: false, cases: (t) => Object.entries(JSON.parse(t.slice(t.indexOf('{'), t.lastIndexOf('}') + 1))) },
      { file: 'julia-feature-result.txt', label: 'julia', json: false, cases: (t) => [['get-repo-map', t]] },
    ],
  },
  'ev-lint': {
    dir: 'Aider-Automated-Linting-Testing-Evidence',
    specs: [
      { file: 'probe-results.json', label: 'probe', cases: (d) => d.cases.map((c) => [c.case, c]) },
      { file: 'orchestration-results.json', label: 'orchestration', cases: (d) => d.cases.map((c) => [c.case, c]) },
      { file: 'oneshot-test-cli-result.json', label: 'oneshot', cases: (d) => [['test-exit', d]] },
    ],
  },
};

export function aiderTestUnits(modules) {
  const units = [];
  for (const module of modules) {
    const text = readFileSync(join(aiderCheckout, 'tests/basic', `${module}.py`), 'utf8');
    let className = '';
    for (const [index, line] of text.split('\n').entries()) {
      const klass = /^class\s+(\w+)/.exec(line);
      if (klass) className = klass[1] ?? '';
      const test = /^(\s*)def\s+(test_\w+)\s*\(/.exec(line);
      if (test) {
        const name = className && (test[1] ?? '').length > 0 ? `${className}.${test[2]}` : (test[2] ?? '');
        units.push({ id: `aider-test/${module}/${name}`, kind: 'aider-test', line: index + 1, text: `tests/basic/${module}.py:${index + 1} ${name}`, sha256: sha256(name) });
      }
    }
  }
  return units;
}

export function census() {
  const units = [];
  for (const [docKey, file] of Object.entries(sources.documents)) {
    units.push(...documentUnits(docKey, readFileSync(join(sourcesDir, file), 'utf8')));
  }
  for (const [dirKey, { dir, specs }] of Object.entries(EVIDENCE)) units.push(...evidenceUnits(dirKey, dir, specs));
  units.push(...aiderTestUnits(sources.aider.testModules));
  const seen = new Map();
  return units.map((unit) => {
    const uses = (seen.get(unit.id) ?? 0) + 1;
    seen.set(unit.id, uses);
    return uses === 1 ? unit : { ...unit, id: `${unit.id}~${uses}` };
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const units = census();
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(units, null, 1)}\n`);
  } else {
    const counts = {};
    for (const unit of units) {
      const group = unit.id.split('/')[0];
      counts[group] = (counts[group] ?? 0) + 1;
    }
    const duplicates = units.length - new Set(units.map((u) => u.id)).size;
    process.stdout.write(`${JSON.stringify({ total: units.length, duplicates, counts }, null, 1)}\n`);
  }
}
