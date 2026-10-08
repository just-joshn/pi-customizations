#!/usr/bin/env node
// Compares the deterministic artifacts of the paired /setup-pstack capture: the written
// rule bytes, the AskQuestion panel chrome, and the ordered user input. Model-authored
// content (title, prompts, option labels, batching, chat text) is normalized to tokens and
// recorded as rubric items per parity/designs/setup-parity-panel.md; it is never silently
// dropped. Byte-exact comparison stays with parity/comparator/compare.mjs.
//
// Usage: node scripts/compare-setup-panel.mjs [pairJson]
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';

import { renderScreen } from '../recorder/screen.mjs';

const pairPath = process.argv[2] ?? new URL('../evidence/setup-prepair/pair-setup-first-run-canonical-1.json', import.meta.url).pathname;
const evidenceRoot = dirname(pairPath);
const GEOMETRY = { rows: 36, cols: 120 };
const CURSOR_ROW = Buffer.from('› [', 'utf8');
const SIDES = ['cursor', 'pi'];

const sha256 = (value) => `sha256:${createHash('sha256').update(value).digest('hex')}`;

async function readAttempt(side, attemptDir) {
  const events = (await readFile(join(attemptDir, 'events.jsonl'), 'utf8'))
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  return { side, attemptDir, events };
}

async function panelBlock(events, seq) {
  const { lines } = await renderScreen(events, { ...GEOMETRY, upToSeq: seq });
  const hint = lines.findIndex((line) => line.includes('↑/↓ option'));
  if (hint === -1) return null;
  const top = lines.findLastIndex((line, index) => index < hint && line.includes('┌'));
  if (top === -1) return null;
  const bottom = lines.findIndex((line, index) => index > hint && line.includes('┘'));
  if (bottom === -1) return null;
  return lines.slice(top, bottom + 1);
}

function normalizeChrome(block) {
  const normalizeLine = (line) => {
    const first = line.indexOf('│');
    const last = line.lastIndexOf('│');
    if (first === -1 || last <= first) {
      if (/[┌┐└┘]/u.test(line)) return line;
      return '<TEXT>';
    }
    const inner = line.slice(first + 1, last);
    const prefix = line.slice(0, first + 1);
    if (inner.trim() === '') return line;
    if (inner.includes('Question ') && inner.includes(' of ')) {
      return `${prefix}${inner.replace(/Question (\d+) of (\d+)/u, 'Question <N> of <M>')}${line.slice(last)}`;
    }
    if (/^\s*\d+\.\s/u.test(inner)) return `${prefix} <PROMPT>${line.slice(last)}`;
    if (inner.includes('Other:')) return line;
    if (inner.includes('↑/↓')) return line;
    if (/(\s*)(› )?\[([x ])\] /u.test(inner)) {
      const replaced = inner.replace(/(\s*)(› )?\[([x ])\] .+$/u, `$1$2[$3] <OPTION>`);
      return `${prefix}${replaced}${line.slice(last)}`;
    }
    return `${prefix} <TEXT>${line.slice(last)}`;
  };
  const batching = block
    .map((line) => line.match(/Question (\d+) of (\d+)/u))
    .filter(Boolean)
    .map((match) => Number(match[2]));
  return { normalized: block.map(normalizeLine), batching };
}

function firstDifference(a, b) {
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    if (a[index] !== b[index]) return { index, cursor: a[index] ?? null, pi: b[index] ?? null };
  }
  return null;
}

function inputActions(events) {
  return events.filter(({ kind }) => kind === 'input_dispatched').map(({ dataB64 }) => dataB64);
}

const pair = JSON.parse(await readFile(pairPath, 'utf8'));
const attemptList = await Promise.all(SIDES.map((side) => readAttempt(side, pair[side].dir)));
const attempts = Object.fromEntries(SIDES.map((side, index) => [side, attemptList[index]]));
const written = {};
for (const side of SIDES) {
  try {
    written[side] = await readFile(join(evidenceRoot, side, 'written-rule.mdc'), 'utf8');
  } catch {
    written[side] = null;
  }
}
const ruleMatch = written.cursor !== null && written.cursor === written.pi;
const ruleReport = {
  match: ruleMatch,
  digests: Object.fromEntries(SIDES.map((side) => [side, written[side] === null ? null : sha256(written[side])])),
};
if (!ruleMatch && written.cursor !== null && written.pi !== null) {
  ruleReport.firstLineDifference = firstDifference(written.cursor.split('\n'), written.pi.split('\n'));
}

const chrome = {};
const BOX_BOTTOM = Buffer.from('┘', 'utf8');
const HINT_ROW = Buffer.from('↑/↓ option', 'utf8');
for (const side of SIDES) {
  let tail = Buffer.alloc(0);
  let cursorSeq = null;
  let hintSeen = false;
  const frameCandidates = [];
  for (const event of attempts[side].events) {
    if (event.kind !== 'output') continue;
    const bytes = Buffer.from(event.dataB64, 'base64');
    const window = Buffer.concat([tail, bytes]);
    if (cursorSeq === null && window.includes(CURSOR_ROW)) cursorSeq = event.seq;
    if (!hintSeen && window.includes(HINT_ROW)) hintSeen = true;
    if (hintSeen && window.includes(BOX_BOTTOM)) frameCandidates.push(event.seq);
    tail = window.subarray(Math.max(0, window.length - 11));
  }
  let block = null;
  let frameSeq = null;
  for (const candidate of frameCandidates) {
    block = await panelBlock(attempts[side].events, candidate);
    if (block !== null) { frameSeq = candidate; break; }
  }
  const extracted = block === null ? null : normalizeChrome(block);
  chrome[side] = { attemptDir: attempts[side].attemptDir, panelSeq: cursorSeq, frameSeq, block, batching: extracted?.batching ?? null, normalized: extracted?.normalized ?? null };
}
const chromeDifference = chrome.cursor.normalized === null || chrome.pi.normalized === null ? { missing: SIDES.filter((side) => chrome[side].normalized === null) } : firstDifference(chrome.cursor.normalized, chrome.pi.normalized);
const chromeReport = {
  match: chromeDifference === null,
  firstDifference: chromeDifference,
  blocks: Object.fromEntries(SIDES.map((side) => [side, chrome[side].normalized])),
  rubric: {
    batching: Object.fromEntries(SIDES.map((side) => [side, chrome[side].batching])),
    panelSeq: Object.fromEntries(SIDES.map((side) => [side, chrome[side].panelSeq])),
  },
};

const inputs = Object.fromEntries(SIDES.map((side) => [side, inputActions(attempts[side].events)]));
const inputMatch = JSON.stringify(inputs.cursor) === JSON.stringify(inputs.pi);
const inputReport = { match: inputMatch, digests: Object.fromEntries(SIDES.map((side) => [side, sha256(JSON.stringify(inputs[side]))])), actions: inputs };

const report = {
  schema: 1,
  pairId: pair.pairId,
  pairPath,
  rule: ruleReport,
  chrome: chromeReport,
  inputs: inputReport,
  modelAuthored: {
    note: 'Normalized here and compared by rubric per parity/designs/setup-parity-panel.md, never deleted from evidence.',
    screens: Object.fromEntries(SIDES.map((side) => [side, chrome[side].block])),
  },
  unexplainedDifferences: (ruleMatch ? 0 : 1) + (chromeDifference === null ? 0 : 1) + (inputMatch ? 0 : 1),
};
await writeFile(join(evidenceRoot, 'panel-parity.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
process.exitCode = report.unexplainedDifferences === 0 ? 0 : 1;