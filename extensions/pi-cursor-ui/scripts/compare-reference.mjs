#!/usr/bin/env node
/**
 * Diff a live pi-cursor-ui capture against the committed cursor-agent baseline.
 *
 * The expectations come from the reference frame, not from constants in this
 * file, so a cursor-agent upgrade moves the target instead of silently passing.
 * Each frame is reduced to a skeleton of classified rows and the two skeletons
 * are compared in order. A difference is reported as a named failure.
 *
 *   node scripts/compare-reference.mjs --state 01-idle --candidate artifacts/idle/01-idle.txt
 *   node scripts/compare-reference.mjs --candidate artifacts/idle/01-idle.txt --verbose
 *
 * A difference this skin has deliberately chosen not to close is passed in as
 * `--known <name>` and reported as a declared gap, so it stays visible in the
 * output instead of being deleted from the harness.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const PKG_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const BUILDS = join(PKG_ROOT, 'reference');

const arg = (name, fallback) => {
  const at = process.argv.indexOf(name);
  return at === -1 ? fallback : process.argv[at + 1];
};

function newestBuild() {
  const candidates = existsSync(BUILDS) ? readdirSync(BUILDS).filter((name) => name.startsWith('cursor-agent-')) : [];
  if (candidates.length === 0) throw new Error(`no baseline under ${BUILDS}; run scripts/capture-reference.mjs`);
  return join(BUILDS, candidates.sort().at(-1));
}

const REFERENCE = arg('--reference', join(newestBuild(), '01-idle.txt'));
const CANDIDATE = arg('--candidate', join(PKG_ROOT, 'artifacts/idle/01-idle.txt'));

/** Rows that carry no content are structural, not decorative: keep their count. */
const rows = (path) =>
  readFileSync(path, 'utf8')
    .replace(/\n+$/, '')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''));

const BAND_TOP = /^( *)▄{4,}/;
const BAND_BOTTOM = /^( *)▀{4,}/;
const INPUT = /^( *)→ (.*)$/;
const MODE = /^( *)(\S.*) \(shift\+tab to cycle\)$/;
const LOCATION = /^( *)(\S+) · (\S+)( · #\d+)?$/;
const TIP = /^( *)Tip: (\S.*)$/;
const MODEL = /^( *)(\S[^·]*?)( · (\d+)%)?$/;
const VERSION = /^( *)v\d/;

/**
 * Classify one row into the semantic slot it fills. The reference frame decides
 * which slots exist; ordering and indent are then comparable across builds. The
 * region matters because the banner and the footer both start with a lone word.
 */
function classify(line, region) {
  if (line.trim() === '') return { kind: 'blank', indent: 0, text: '' };
  const bandTop = BAND_TOP.exec(line);
  if (bandTop) return { kind: 'band-top', indent: bandTop[1].length, width: line.trim().length, body: line.trim() };
  const bandBottom = BAND_BOTTOM.exec(line);
  if (bandBottom) return { kind: 'band-bottom', indent: bandBottom[1].length, width: line.trim().length, body: line.trim() };
  const input = INPUT.exec(line);
  if (input) return { kind: 'input', indent: input[1].length, text: input[2], hasHint: /\S\s{2,}\S/.test(input[2]) };
  const tip = TIP.exec(line);
  if (tip) return { kind: 'tip', indent: tip[1].length, text: tip[2] };
  if (region === 'banner') {
    const version = VERSION.exec(line);
    if (version) return { kind: 'version', indent: version[1].length, text: line.trim() };
    return { kind: 'title', indent: line.length - line.trimStart().length, text: line.trim() };
  }
  const mode = MODE.exec(line);
  if (mode) return { kind: 'mode', indent: mode[1].length, label: mode[2] };
  const location = LOCATION.exec(line);
  if (location) return { kind: 'location', indent: location[1].length, path: location[2], branch: location[3], pr: location[4] ?? null };
  const model = MODEL.exec(line);
  if (model) return { kind: 'model', indent: model[1].length, label: model[2], percent: model[4] ?? null };
  return { kind: 'other', indent: line.length - line.trimStart().length, text: line.trim(), width: line.length };
}

const frame = (lines, paneWidth) => {
  let region = 'banner';
  return lines.map((line, index) => {
    const shape = classify(line, region);
    if (shape.kind === 'band-bottom') region = 'footer';
    return { line, shape, index, paneWidth };
  });
};

const reference = frame(rows(REFERENCE), Number(arg('--width', '110')));
const candidate = frame(rows(CANDIDATE), Number(arg('--width', '110')));

/** Collapse runs of blanks so padding differences do not mask a real row diff. */
const skeleton = (items) => items.filter((item) => item.shape.kind !== 'blank').map((item) => item.shape.kind);

const failures = [];
const known = new Set(
  arg('--known', '')
    .split(',')
    .map((name) => name.trim())
    .filter((name) => name.length > 0),
);
const note = (name, detail) => failures.push({ name, detail });

const referenceKinds = skeleton(reference);
const candidateKinds = skeleton(candidate);

if (referenceKinds.join(' < ') !== candidateKinds.join(' < ')) {
  note('row skeleton', `reference ${referenceKinds.join(' < ')} but candidate ${candidateKinds.join(' < ')}`);
}

const byKind = (items, kind) => items.filter((item) => item.shape.kind === kind);
const pick = (items, kind) => byKind(items, kind)[0];

const bandTopRef = pick(reference, 'band-top');
const bandTopCand = pick(candidate, 'band-top');
if (bandTopRef && bandTopCand) {
  if (bandTopRef.shape.indent !== bandTopCand.shape.indent) note('band-top indent', `reference ${bandTopRef.shape.indent}, candidate ${bandTopCand.shape.indent}`);
  const expected = bandTopRef.paneWidth - 2;
  if (bandTopCand.shape.width !== expected) note('band-top width', `reference ${bandTopRef.shape.width} of ${bandTopRef.paneWidth} columns, candidate ${bandTopCand.shape.width}`);
  if (bandTopRef.shape.body[0] !== bandTopCand.shape.body[0]) note('band glyph', `reference ${bandTopRef.shape.body[0]}, candidate ${bandTopCand.shape.body[0]}`);
}

const bandBottomRef = pick(reference, 'band-bottom');
const bandBottomCand = pick(candidate, 'band-bottom');
if (bandBottomRef && bandBottomCand && bandBottomRef.shape.body[0] !== bandBottomCand.shape.body[0]) {
  note('band-bottom glyph', `reference ${bandBottomRef.shape.body[0]}, candidate ${bandBottomCand.shape.body[0]}`);
}

const inputRef = pick(reference, 'input');
const inputCand = pick(candidate, 'input');
if (inputRef && inputCand) {
  if (inputRef.shape.indent !== inputCand.shape.indent) note('input indent', `reference ${inputRef.shape.indent}, candidate ${inputCand.shape.indent}`);
  if (inputRef.shape.text !== inputCand.shape.text) note('input text', `reference ${JSON.stringify(inputRef.shape.text)}, candidate ${JSON.stringify(inputCand.shape.text)}`);
}

const tipRef = pick(reference, 'tip');
const tipCand = pick(candidate, 'tip');
if (Boolean(tipRef) !== Boolean(tipCand)) note('tip row present', `reference ${Boolean(tipRef)}, candidate ${Boolean(tipCand)}`);
else if (tipRef && tipRef.shape.indent !== tipCand.shape.indent) note('tip indent', `reference ${tipRef.shape.indent}, candidate ${tipCand.shape.indent}`);

const modelRef = pick(reference, 'model');
const modelCand = pick(candidate, 'model');
if (Boolean(modelRef) !== Boolean(modelCand)) note('model row present', `reference ${Boolean(modelRef)}, candidate ${Boolean(modelCand)}`);
else if (modelRef) {
  if (modelRef.shape.indent !== modelCand.shape.indent) note('model indent', `reference ${modelRef.shape.indent}, candidate ${modelCand.shape.indent}`);
  if (modelRef.shape.percent !== null && modelCand.shape.percent === null) note('model context percent', 'reference shows a percent, candidate does not');
}

const titleRef = pick(reference, 'title');
const titleCand = pick(candidate, 'title');
if (Boolean(titleRef) !== Boolean(titleCand)) note('banner title row', `reference ${Boolean(titleRef)}, candidate ${Boolean(titleCand)}`);
else if (titleRef && titleRef.shape.indent !== titleCand.shape.indent) note('banner title indent', `reference ${titleRef.shape.indent}, candidate ${titleCand.shape.indent}`);

const versionRef = pick(reference, 'version');
const versionCand = pick(candidate, 'version');
if (Boolean(versionRef) !== Boolean(versionCand)) note('banner version row', `reference ${Boolean(versionRef)}, candidate ${Boolean(versionCand)}`);

const locationRef = pick(reference, 'location');
const locationCand = pick(candidate, 'location');
if (Boolean(locationRef) !== Boolean(locationCand)) note('location row present', `reference ${Boolean(locationRef)}, candidate ${Boolean(locationCand)}`);
else if (locationRef) {
  if (locationRef.shape.indent !== locationCand.shape.indent) note('location indent', `reference ${locationRef.shape.indent}, candidate ${locationCand.shape.indent}`);
  if (locationRef.shape.pr !== null && locationCand.shape.pr === null) note('location PR segment', 'reference shows a PR number, candidate does not');
}

// Ordering matters: the mode row sits directly above the model row, which sits
// directly above the location row.
const tail = (items) => skeleton(items).slice(-3);
if (tail(reference).join(' < ') !== tail(candidate).join(' < ')) {
  note('footer row order', `reference ${tail(reference).join(' < ')}, candidate ${tail(candidate).join(' < ')}`);
}

if (process.argv.includes('--verbose')) {
  process.stdout.write(`reference ${reference.length} rows -> ${skeleton(reference).join(' < ')}\n`);
  process.stdout.write(`candidate ${candidate.length} rows -> ${skeleton(candidate).join(' < ')}\n`);
}

for (const failure of failures) {
  const isKnown = known.has(failure.name);
  process.stdout.write(`${isKnown ? 'known' : 'FAIL '} ${failure.name}: ${failure.detail}${isKnown ? ' [declared gap]' : ''}\n`);
}
const unexpected = failures.filter((failure) => !known.has(failure.name));
const declared = failures.filter((failure) => known.has(failure.name));
process.stdout.write(`\nreference: ${REFERENCE}\n`);
process.stdout.write(`candidate: ${CANDIDATE}\n`);
process.stdout.write(`failures: ${unexpected.length} (declared gaps: ${declared.length})\n`);
process.exitCode = unexpected.length === 0 ? 0 : 1;
