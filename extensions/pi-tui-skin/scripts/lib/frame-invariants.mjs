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
 * - `mode-line-left-aligned` requires the `shift+tab to cycle` mode line to be
 *   `  <label> (shift+tab to cycle)` with the footer's two-column indent and
 *   no trailing padding, which is how the reference draws it. The reference
 *   shows that row only once the mode has left its startup value, so this
 *   invariant skips on an idle frame, and the `thinking` scenario is what makes
 *   it run.
 * - `prompt-band` requires a `▄` band above the composer with a `▀` band below
 *   it, one column of margin on each side and on every row between them.
 * - `footer-position` requires the footer hint line within the last three
 *   non-empty pane rows and an editor rule row within the last five, which
 *   catches a layout shift or a wrap. It skips when no line carries the hint,
 *   which is the idle footer; the composer band is the check that still runs.
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
/** The reference's mode row, and the only shape the hint is allowed to take. */
const MODE_ROW = /^ {2}\S.* \(shift\+tab to cycle\)$/;
/** The composer's closing band row; the footer starts on the row after it. */
const BAND_BOTTOM = /^ *▀{4,}$/;
const HEADER_LITERAL = 'Pi Coding Agent';

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
    if (trimmed === '') return false;
    // Every composer placeholder starts with the prompt glyph.
    if (trimmed.startsWith('→ ')) return false;
    if (/\(\d+\/\d+\)/.test(trimmed)) return true;
    return /^[→›❯]/.test(trimmed) && / {2,}/.test(trimmed);
  });
}

/** Labels the skin and Pi place inside a band row. */
const RULE_LABELS = /(Working|[↑↓] \d+ more)/g;

/** A band row: one column of margin each side, then block glyphs in between. */
function isBandRow(line) {
  // tmux trims the trailing margin column, so only the leading margin is required.
  if (line.length < 6 || !line.startsWith(' ')) return false;
  const body = line.slice(1, -1).replace(RULE_LABELS, '');
  if (!/^[▄▀ •·]*$/.test(body)) return false;
  return (body.match(/[▄▀]/g) ?? []).length >= 4;
}

/** The block glyphs a band row carries, ignoring any label. */
function bandGlyphs(line) {
  return new Set(line.slice(1, -1).replace(RULE_LABELS, '').match(/[▄▀]/g) ?? []);
}

function isEditorRow(line) {
  return isBandRow(line) || (line.length >= 2 && line.startsWith(' '));
}

function hasSgrColor(line) {
  return new RegExp(`${ESC}\\[(?:38;5;\\d+|38;2;\\d+;\\d+;\\d+|9[0-9]|3[0-79])m`).test(line);
}

/** Every invariant name this module can evaluate. */
export const ALL_INVARIANTS = ['overflow', 'crash-marker', 'footer-missing', 'header-missing', 'orphan-row', 'escape-leak', 'double-header', 'mode-line-left-aligned', 'prompt-band', 'footer-position', 'color-missing'];

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
  else {
    // The footer is whatever Pi draws below the composer, so a band row with
    // nothing but blanks under it is a missing footer at any pane width.
    const bands = paneLines.flatMap((line, index) => (isBandRow(line) ? [index] : []));
    const lastBand = bands[bands.length - 1];
    if (lastBand === undefined) results.push(skip('footer-missing', 'no composer band row in frame'));
    else if (!paneLines.slice(lastBand + 1).some((line) => line.trim() !== '')) {
      results.push(finding('footer-missing', 'nothing renders below the composer', paneLines[lastBand], lastBand));
    }
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

  // mode-line-left-aligned: the reference keeps the cycle hint in parentheses
  // on the mode line itself and left-aligns it. Only `esc to stop` is ever
  // right-aligned, and it sits on the composer's input row. The search is
  // bounded to the footer, because a rotating banner tip may mention the same
  // key, and a bare literal match in the banner is not a mode row.
  const footerStart = paneLines.reduce((last, line, index) => (BAND_BOTTOM.test(line.trimEnd()) ? index + 1 : last), 0);
  const hintRows = paneLines.flatMap((line, index) => (index >= footerStart && line.includes(HINT_LITERAL) ? [index] : []));
  if (hintRows.length === 0) results.push(skip('mode-line-left-aligned', `no line below the composer contains ${quote(HINT_LITERAL)}`));
  else {
    for (const index of hintRows) {
      const line = paneLines[index];
      if (!MODE_ROW.test(line.trimEnd())) results.push(finding('mode-line-left-aligned', 'mode line is not `  <label> (shift+tab to cycle)`', line, index));
    }
  }

  // prompt-band: the composer is a `▄` band above the input and a `▀` band
  // below, one column of margin each side. Only the composer draws those
  // glyphs, so the bands are unambiguous; when none are present the composer is
  // either off screen or replaced by a picker.
  const bandRows = paneLines.flatMap((line, index) => (isBandRow(line) ? [index] : []));
  if (bandRows.length < 2) results.push(skip('prompt-band', `${bandRows.length} band rows in frame`));
  else if (modal) results.push(skip('prompt-band', 'modal menu open'));
  else {
    const [topIndex, bottomIndex] = bandRows.slice(-2);
    const topGlyphs = bandGlyphs(paneLines[topIndex]);
    const bottomGlyphs = bandGlyphs(paneLines[bottomIndex]);
    if (!topGlyphs.has('▄') || topGlyphs.has('▀')) results.push(finding('prompt-band', 'top band is not a `▄` row', paneLines[topIndex], topIndex));
    if (!bottomGlyphs.has('▀') || bottomGlyphs.has('▄')) results.push(finding('prompt-band', 'bottom band is not a `▀` row', paneLines[bottomIndex], bottomIndex));
    const unframed = paneLines.slice(topIndex + 1, bottomIndex).filter((line) => line.trim() !== '' && !isEditorRow(line));
    if (unframed.length > 0) results.push(finding('prompt-band', 'a row inside the band has no side margin', unframed[0], paneLines.indexOf(unframed[0])));
  }

  // footer-position
  if (!expectChrome) results.push(skip('footer-position', 'frame not marked expectChrome'));
  else if (modal) results.push(skip('footer-position', 'modal menu open'));
  else {
    const lastThree = new Set(nonEmpty.slice(-3));
    const lastSix = new Set(nonEmpty.slice(-6));
    const bandRow = paneLines.findIndex((line) => isBandRow(line));
    // The mode row is absent at the session's default thinking level, so the
    // footer is anchored on the rows below the composer instead. A picker
    // replaces the composer, so the anchor only applies when a band is present.
    if (bandRow !== -1) {
      const belowComposer = nonEmpty.filter((index) => paneLines.slice(0, index + 1).some((line) => BAND_BOTTOM.test(line.trimEnd())));
      if (belowComposer.length === 0) results.push(finding('footer-position', 'nothing renders below the composer band', paneLines[nonEmpty.at(-1) ?? 0] ?? '', nonEmpty.at(-1) ?? 0));
    }
    if (hintRows.length === 0) results.push(skip('footer-position', `no line below the composer contains ${quote(HINT_LITERAL)}`));
    else if (!hintRows.some((index) => lastThree.has(index))) results.push(finding('footer-position', `footer hint is not within the last 3 non-empty rows (${nonEmpty.slice(-3).join(', ')})`, paneLines[hintRows[0]], hintRows[0]));
    if (bandRow === -1) results.push(skip('footer-position', 'no editor band row in frame'));
    else if (!paneLines.some((line, index) => isBandRow(line) && lastSix.has(index)))
      results.push(finding('footer-position', `editor band row is not within the last 6 non-empty rows (${nonEmpty.slice(-6).join(', ')})`, paneLines[bandRow], bandRow));
  }

  // color-missing
  const topRule = paneLines.findIndex((line) => isBandRow(line));
  if (ansi === undefined || ansi === null) results.push(skip('color-missing', 'no ANSI capture'));
  else if (topRule === -1) results.push(skip('color-missing', 'no editor band row in frame'));
  else {
    const ansiLine = lines(ansi)[topRule] ?? '';
    if (!hasSgrColor(ansiLine)) results.push(finding('color-missing', 'editor band row carries no SGR color', paneLines[topRule], topRule));
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

const BAND_COLS = 48;
const TOP_BAND = ` ${'▄'.repeat(BAND_COLS - 2)} `;
const BOTTOM_BAND = ` ${'▀'.repeat(BAND_COLS - 2)} `;
const INPUT_ROW = '  → Plan, search, build anything';

const CLEAN_FRAME = ['> agent', 'Pi Coding Agent', '/tmp/workspace', '', TOP_BAND, INPUT_ROW, BOTTOM_BAND, '  Medium (shift+tab to cycle)', 'Reference UI Scripted · 0%', '~/workspace · main'].join('\n');

const WIDE_FRAME = ['> agent', 'Pi Coding Agent', 'x'.repeat(40)].join('\n');

const CRASH_FRAME = ['> agent', 'Pi Coding Agent', '', 'TypeError: cannot read properties of undefined', '    at render (src/ui/header.ts:14:9)'].join('\n');

const NO_CHROME_FRAME = ['> agent', '', TOP_BAND, INPUT_ROW, BOTTOM_BAND].join('\n');

const NO_HEADER_FRAME = CLEAN_FRAME.replace('Pi Coding Agent\n', '');

const ORPHAN_FRAME = ['Pi Coding Agent', '◇', '', '~/workspace'].join('\n');

const LEAK_FRAME = ['Pi Coding Agent', `\u001b[38;2;1;2;3mplain leak`, '~/workspace'].join('\n');

const RIGHT_ALIGNED_MODE_FRAME = CLEAN_FRAME.replace('  Medium (shift+tab to cycle)', `${' '.repeat(60)}Medium (shift+tab to cycle)`);

const BARE_MODE_FRAME = CLEAN_FRAME.replace('  Medium (shift+tab to cycle)', '● Medium         shift+tab to cycle');

const OPEN_BAND_FRAME = CLEAN_FRAME.replace(TOP_BAND, ` ${'▀'.repeat(BAND_COLS - 2)} `);

const WORKING_STATUS_FRAME = CLEAN_FRAME.replace(TOP_BAND, ` ▄ ▄ Working ${'▄'.repeat(BAND_COLS - 14)} `);

const TRANSCRIPT_RULE_FRAME = ['> agent', 'Pi Coding Agent', '─'.repeat(BAND_COLS), 'free text', ...CLEAN_FRAME.split('\n').slice(4)].join('\n');

const UNFRAMED_ROW_FRAME = CLEAN_FRAME.replace(INPUT_ROW, INPUT_ROW.trimStart());

/** Build a realistic ANSI capture: band rows carry the composer fill SGR. */
function ansiFor(plain) {
  return lines(plain)
    .map((line) => (isBandRow(line) ? `${ESC}[38;2;21;21;21m${line}${ESC}[39m` : line))
    .join('\n');
}

function frame(plain, overrides = {}) {
  const cols = overrides.cols ?? 48;
  // A tmux capture always pads every row out to the pane width.
  const fitted = lines(plain)
    .map((line) => (visibleWidth(line) >= cols ? line : line + ' '.repeat(cols - visibleWidth(line))))
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
  { name: 'right-aligned mode line', frame: frame(RIGHT_ALIGNED_MODE_FRAME, { paneClipped: false }), findings: ['mode-line-left-aligned', 'overflow'] },
  { name: 'bare mode line', frame: frame(BARE_MODE_FRAME), findings: ['mode-line-left-aligned'] },
  { name: 'open band', frame: frame(OPEN_BAND_FRAME), findings: ['prompt-band'] },
  { name: 'working status label in the top band', frame: frame(WORKING_STATUS_FRAME, { expectChrome: true }), findings: [] },
  { name: 'pi transcript rule above the band', frame: frame(TRANSCRIPT_RULE_FRAME, { expectChrome: true }), findings: [] },
  { name: 'unframed row inside the band', frame: frame(UNFRAMED_ROW_FRAME), findings: ['prompt-band'] },
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
