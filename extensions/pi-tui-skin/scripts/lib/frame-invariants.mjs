#!/usr/bin/env node
/**
 * Mechanical frame invariants for a captured pi TUI pane.
 *
 * Every check reads pane text only: `plain` for layout, `ansi` for color. A
 * check that cannot evaluate on a frame returns a `skipped: <invariant>:
 * <reason>` line instead of passing silently, so the driver can report skips
 * separately from passes.
 *
 * Invariant names, and what each one proves:
 *
 * - `overflow` measures visible width against `cols`. A tmux pane grid clips at
 *   `cols`, so on a real capture this always reports `skipped: pane grid clips
 *   at cols`; the check only produces a finding for synthetic frames.
 * - `crash-marker` looks for a JS crash or a pi exit in the pane. A tool-error
 *   row (`Error:` directly under a `◇` call row) is expected UI, not a crash,
 *   so a line starting with `Error:` is only a marker when no `◇` row precedes
 *   it within three lines.
 * - `footer-missing` requires the footer hint line on a frame explicitly marked
 *   `expectChrome`, unless a modal menu is open. Pi pins the footer to the pane
 *   bottom, so it is present in every TUI frame, scrolled or not.
 * - `header-missing` requires the header, and runs only when a step opts in with
 *   `chrome: 'top'`. The header scrolls off once enough tool rows accumulate, so
 *   only the first idle frame and the frames just after a reload, model switch,
 *   or resize are marked that way.
 * - `orphan-row` rejects a tool row marker with nothing after it.
 * - `escape-leak` rejects a raw ESC byte or a persisted SGR color in the plain
 *   capture, which means the pane was not stripped.
 * - `double-header` rejects a second `Pi Coding Agent` header, the signature of
 *   a failed `/reload`.
 * - `hint-flush-right` requires the `shift+tab to cycle` footer line to fill
 *   exactly `cols` visible columns. The left-aligned hints line is deliberately
 *   unpadded and is excluded from every check.
 * - `footer-position` requires the footer hint line within the last three
 *   non-empty pane rows and an editor rule row within the last five, which
 *   catches a layout shift or a wrap.
 * - `color-missing` requires the editor's top rule row to carry an SGR color in
 *   the ANSI capture.
 *
 *   node scripts/lib/frame-invariants.mjs --self-test
 */
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';

const ESC = String.fromCharCode(27);

// Prefer pi-tui's own width measurement. Fall back to a local implementation
// only when the bare specifier does not resolve from this file.
export let visibleWidthSource = 'pi-tui';
export let visibleWidth;
try {
  ({ visibleWidth } = await import('@earendil-works/pi-tui'));
  if (typeof visibleWidth !== 'function') throw new TypeError('visibleWidth is not a function');
} catch {
  visibleWidthSource = 'local';
  visibleWidth = localVisibleWidth;
}

const SGR = new RegExp(`${ESC}\\[[0-9;]*m`, 'g');

/** Strip ANSI SGR sequences, then count East Asian wide and emoji as two columns. */
export function localVisibleWidth(text) {
  const stripped = String(text).replace(SGR, '');
  let width = 0;
  for (const char of stripped) {
    width += charWidth(char.codePointAt(0));
  }
  return width;
}

function charWidth(codePoint) {
  if (codePoint === 0x200d || codePoint === 0xfe0f || codePoint === 0xfe0e) return 0;
  if (
    (codePoint >= 0x1100 && codePoint <= 0x115f) ||
    (codePoint >= 0x2e80 && codePoint <= 0x303e) ||
    (codePoint >= 0x3041 && codePoint <= 0x33ff) ||
    (codePoint >= 0x3400 && codePoint <= 0x4dbf) ||
    (codePoint >= 0x4e00 && codePoint <= 0x9fff) ||
    (codePoint >= 0xa000 && codePoint <= 0xa4cf) ||
    (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
    (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
    (codePoint >= 0xfe30 && codePoint <= 0xfe4f) ||
    (codePoint >= 0xff00 && codePoint <= 0xff60) ||
    (codePoint >= 0xffe0 && codePoint <= 0xffe6) ||
    (codePoint >= 0x1f300 && codePoint <= 0x1faff) ||
    (codePoint >= 0x20000 && codePoint <= 0x3fffd)
  ) {
    return 2;
  }
  return 1;
}

const CRASH_TOKENS = ['PI-EXITED-', 'TypeError', 'ReferenceError', 'SyntaxError', 'Cannot read propert', 'undefined is not', '[object Object]', 'NaN', 'Unhandled'];
const STACK_FRAME = '    at ';
const HINT_LITERAL = 'shift+tab to cycle';
const HINTS_LITERAL = '/ commands';
const HEADER_LITERAL = 'Pi Coding Agent';
const PLACEHOLDERS = new Set(['→ Ask, build, or change anything', '→ Add a follow-up']);

function lines(text) {
  return String(text ?? '').split('\n');
}

function quote(line) {
  return JSON.stringify(line.length > 120 ? `${line.slice(0, 117)}…` : line);
}

function finding(invariant, detail, line, index) {
  return `${invariant}: line ${index + 1} ${detail} (${quote(line)})`;
}

function skip(invariant, reason) {
  return `skipped: ${invariant}: ${reason}`;
}

/** Whether the pane shows an open modal menu. The editor placeholder also starts with an arrow, so it is excluded. */
export function modalOpen(plain) {
  return lines(plain).some((line) => {
    const trimmed = line.trim();
    if (trimmed === '' || PLACEHOLDERS.has(trimmed)) return false;
    if (/\(\d+\/\d+\)/.test(trimmed)) return true;
    return /^[→›❯]/.test(trimmed) && / {2,}/.test(trimmed);
  });
}

/**
 * An editor border row: a bare rule, Pi's centered `↓ N more` label, the skin's
 * `esc to stop` hint, or a combination of the last two. Any other label shape is
 * left unrecognized so the dependent checks report a skip instead of a pass.
 */
function isEditorRule(line) {
  return /^─+(?: ↓ \d+ more ─+)?(?: esc to stop)?$/.test(line);
}

function hasSgrColor(line) {
  return new RegExp(`${ESC}\\[(?:38;5;\\d+|38;2;\\d+;\\d+;\\d+|9[0-9]|3[0-79])m`).test(line);
}

/** Every invariant name this module can evaluate. */
export const ALL_INVARIANTS = ['overflow', 'crash-marker', 'footer-missing', 'header-missing', 'orphan-row', 'escape-leak', 'double-header', 'hint-flush-right', 'footer-position', 'color-missing'];

/**
 * Check one captured frame.
 *
 * @param {{plain: string, ansi?: string, cols: number, rows: number, scenario?: string, step?: string, expectChrome?: boolean, expectHeader?: boolean, expectExit?: boolean, paneClipped?: boolean}} frame
 * @returns {string[]} findings (`<invariant>: ...`) and skips (`skipped: <invariant>: ...`)
 */
export function checkFrame(frame) {
  const { plain, ansi, cols, expectChrome = false, expectHeader = false, expectExit = false, paneClipped = true } = frame;
  const paneLines = lines(plain);
  const results = [];
  const modal = modalOpen(plain);
  const nonEmpty = paneLines.flatMap((line, index) => (line.trim() === '' ? [] : [index]));

  // overflow: never fires on a real tmux capture because the pane grid clips.
  const overWide = paneLines.flatMap((line, index) => {
    const width = visibleWidth(line);
    return Number.isFinite(cols) && width > cols ? [finding('overflow', `visible width ${width} exceeds cols ${cols}`, line, index)] : [];
  });
  if (overWide.length > 0) results.push(...overWide);
  else if (paneClipped) results.push(skip('overflow', 'pane grid clips at cols'));
  else results.push(skip('overflow', `no line exceeds cols ${cols}`));

  // crash-marker
  const crashFindings = [];
  const crashTokens = expectExit ? CRASH_TOKENS.filter((candidate) => candidate !== 'PI-EXITED-') : CRASH_TOKENS;
  for (let index = 0; index < paneLines.length; index++) {
    const line = paneLines[index];
    const token = crashTokens.find((candidate) => line.includes(candidate));
    const stacked = line.includes(STACK_FRAME);
    const startsWithError = /^Error:/.test(line);
    const toolErrorRow = startsWithError && paneLines.slice(Math.max(0, index - 3), index).some((prior) => prior.includes('◇'));
    if (token !== undefined) crashFindings.push(finding('crash-marker', `contains ${quote(token)}`, line, index));
    else if (stacked) crashFindings.push(finding('crash-marker', 'contains a stack frame', line, index));
    else if (startsWithError && !toolErrorRow) crashFindings.push(finding('crash-marker', 'starts with Error:', line, index));
  }
  results.push(...crashFindings);

  // footer-missing
  if (!expectChrome) results.push(skip('footer-missing', 'frame not marked expectChrome'));
  else if (modal) results.push(skip('footer-missing', 'modal menu open'));
  else if (!paneLines.some((line) => line.includes(HINTS_LITERAL))) {
    results.push(finding('footer-missing', `footer hint ${quote(HINTS_LITERAL)} is absent`, paneLines[paneLines.length - 1] ?? '', paneLines.length - 1));
  }

  // header-missing
  if (!expectHeader) results.push(skip('header-missing', 'frame not marked chrome top'));
  else if (modal) results.push(skip('header-missing', 'modal menu open'));
  else if (!paneLines.some((line) => line.includes(HEADER_LITERAL))) {
    results.push(finding('header-missing', `header ${quote(HEADER_LITERAL)} is absent`, paneLines[0] ?? '', 0));
  }

  // orphan-row
  for (let index = 0; index < paneLines.length; index++) {
    const line = paneLines[index];
    const marker = line.indexOf('◇');
    if (marker === -1) continue;
    if (line.slice(marker + 1).trim() === '') results.push(finding('orphan-row', 'has no text after ◇', line, index));
  }

  // escape-leak
  for (let index = 0; index < paneLines.length; index++) {
    const line = paneLines[index];
    if (line.includes(ESC)) results.push(finding('escape-leak', 'contains a literal ESC byte', line, index));
    else if (line.includes('[38;2;')) results.push(finding('escape-leak', 'contains a persisted SGR color', line, index));
  }

  // double-header
  const headers = paneLines.flatMap((line, index) => (line.includes(HEADER_LITERAL) ? [index] : []));
  if (headers.length > 1) results.push(finding('double-header', `header appears ${headers.length} times`, paneLines[headers[1]] ?? '', headers[1]));

  // hint-flush-right
  const hintRows = paneLines.flatMap((line, index) => (line.includes(HINT_LITERAL) ? [index] : []));
  if (hintRows.length === 0) results.push(skip('hint-flush-right', `no line contains ${quote(HINT_LITERAL)}`));
  else {
    for (const index of hintRows) {
      const width = visibleWidth(paneLines[index]);
      if (Number.isFinite(cols) && width !== cols) results.push(finding('hint-flush-right', `visible width ${width} is not cols ${cols}`, paneLines[index], index));
    }
  }

  // footer-position
  if (!expectChrome) results.push(skip('footer-position', 'frame not marked expectChrome'));
  else if (modal) results.push(skip('footer-position', 'modal menu open'));
  else {
    const lastThree = new Set(nonEmpty.slice(-3));
    const lastFive = new Set(nonEmpty.slice(-5));
    if (hintRows.length === 0) results.push(skip('footer-position', `no line contains ${quote(HINT_LITERAL)}`));
    else if (!hintRows.some((index) => lastThree.has(index))) results.push(finding('footer-position', `footer hint is not within the last 3 non-empty rows (${nonEmpty.slice(-3).join(', ')})`, paneLines[hintRows[0]], hintRows[0]));
    const ruleRow = paneLines.findIndex((line) => isEditorRule(line));
    if (ruleRow === -1) results.push(skip('footer-position', 'no editor rule row in frame'));
    else if (!paneLines.some((line, index) => isEditorRule(line) && lastFive.has(index)))
      results.push(finding('footer-position', `editor rule row is not within the last 5 non-empty rows (${nonEmpty.slice(-5).join(', ')})`, paneLines[ruleRow], ruleRow));
  }

  // color-missing
  const topRule = paneLines.findIndex((line) => isEditorRule(line));
  if (ansi === undefined || ansi === null) results.push(skip('color-missing', 'no ANSI capture'));
  else if (topRule === -1) results.push(skip('color-missing', 'no editor rule row in frame'));
  else {
    const ansiLine = lines(ansi)[topRule] ?? '';
    if (!hasSgrColor(ansiLine)) results.push(finding('color-missing', 'editor top rule row carries no SGR color', paneLines[topRule], topRule));
  }

  return results;
}

/** Split `checkFrame` output into findings and skips. */
export function splitFrameResults(results) {
  const findings = [];
  const skips = [];
  for (const result of results) {
    if (result.startsWith('skipped: ')) {
      const match = /^skipped: ([^:]+): (.*)$/.exec(result);
      skips.push({ invariant: match?.[1] ?? 'unknown', reason: match?.[2] ?? result });
    } else {
      const name = result.slice(0, result.indexOf(':'));
      findings.push({ invariant: name, detail: result.slice(name.length + 1).trim(), raw: result });
    }
  }
  return { findings, skips };
}

const RULE = '─'.repeat(36);
const CLEAN_FRAME = [
  '> agent',
  'Pi Coding Agent',
  '/tmp/workspace',
  '',
  RULE,
  '→ Ask, build, or change anything',
  RULE,
  `● Medium${' '.repeat(9)}shift+tab to cycle`,
  'Reference UI Scripted · 0%       smoke-main',
  '/ commands · @ files · ! shell',
].join('\n');

const WIDE_FRAME = ['> agent', 'Pi Coding Agent', 'x'.repeat(40)].join('\n');

const CRASH_FRAME = ['> agent', 'Pi Coding Agent', '', 'TypeError: cannot read properties of undefined', '    at render (src/ui/header.ts:14:9)'].join('\n');

const NO_CHROME_FRAME = ['> agent', '', RULE, '→ Ask, build, or change anything', RULE].join('\n');

const NO_HEADER_FRAME = CLEAN_FRAME.replace('Pi Coding Agent\n', '');

const ORPHAN_FRAME = ['Pi Coding Agent', '◇', '', '/ commands · @ files · ! shell'].join('\n');

const LEAK_FRAME = ['Pi Coding Agent', `\u001b[38;2;1;2;3mplain leak`, '/ commands · @ files · ! shell'].join('\n');

/** Build a realistic ANSI capture: rule rows carry the idle green SGR. */
function ansiFor(plain) {
  return lines(plain)
    .map((line) => (isEditorRule(line) ? `${ESC}[38;2;62;208;122m${line}${ESC}[39m` : line))
    .join('\n');
}

function frame(plain, overrides = {}) {
  const cols = overrides.cols ?? 48;
  const fitted = lines(plain)
    .map((line) => {
      if (!line.includes(HINT_LITERAL)) return line;
      const width = visibleWidth(line);
      return width >= cols ? line : line + ' '.repeat(cols - width);
    })
    .join('\n');
  return { plain: fitted, ansi: ansiFor(fitted), cols, rows: lines(fitted).length, paneClipped: false, ...overrides };
}

const FIXTURES = [
  { name: 'clean frame', frame: frame(CLEAN_FRAME, { expectChrome: true }), findings: [] },
  { name: 'overflow', frame: frame(WIDE_FRAME, { cols: 20, paneClipped: false }), findings: ['overflow'] },
  { name: 'crash marker', frame: frame(CRASH_FRAME, { cols: 60, paneClipped: false }), findings: ['crash-marker'] },
  { name: 'missing footer', frame: frame(NO_CHROME_FRAME, { expectChrome: true }), findings: ['footer-missing'] },
  { name: 'missing header', frame: frame(NO_HEADER_FRAME, { expectChrome: true, expectHeader: true }), findings: ['header-missing'] },
  { name: 'scrolled frame with footer passes', frame: frame(NO_HEADER_FRAME, { expectChrome: true }), findings: [] },
  { name: 'orphan row', frame: frame(ORPHAN_FRAME, { paneClipped: false }), findings: ['orphan-row'] },
  { name: 'escape leak', frame: frame(LEAK_FRAME, { paneClipped: false }), findings: ['escape-leak'] },
  { name: 'pane-clipped overflow is skipped', frame: frame(CLEAN_FRAME, { paneClipped: true }), findings: [], skips: ['overflow'] },
];

export function selfTest() {
  let failures = 0;
  for (const fixture of FIXTURES) {
    const { findings, skips } = splitFrameResults(checkFrame(fixture.frame));
    const names = [...new Set(findings.map((entry) => entry.invariant))].sort();
    const skipNames = [...new Set(skips.map((entry) => entry.invariant))].sort();
    const expectedFindings = [...(fixture.findings ?? [])].sort();
    const expectedSkips = [...(fixture.skips ?? [])].sort();
    try {
      assert.deepEqual(names, expectedFindings, `${fixture.name}: expected findings [${expectedFindings}], got [${names}]`);
      for (const expectedSkip of expectedSkips) {
        assert.ok(skipNames.includes(expectedSkip), `${fixture.name}: expected skip ${expectedSkip}, got [${skipNames}]`);
      }
      process.stdout.write(`ok ${fixture.name} (findings: ${names.join(', ') || 'none'}, expected skips present: ${expectedSkips.join(', ') || 'none'})\n`);
    } catch (error) {
      failures += 1;
      process.stderr.write(`not ok ${fixture.name}: ${error.message}\n`);
    }
  }
  process.stdout.write(`frame-invariants self-test: ${FIXTURES.length - failures}/${FIXTURES.length} passed (visibleWidth source: ${visibleWidthSource})\n`);
  return failures === 0 ? 0 : 1;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1] && process.argv.includes('--self-test')) {
  process.exitCode = selfTest();
}
