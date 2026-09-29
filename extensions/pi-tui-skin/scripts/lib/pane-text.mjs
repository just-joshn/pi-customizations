#!/usr/bin/env node
/**
 * Pane text inspection for the smoke driver and its scenario checks.
 *
 * Every helper reads a captured pane as plain text and is pure. A scenario's
 * `check` callback and the driver both need the same reading of the footer, the
 * editor block, and the composer band, so the rules live here once.
 */

export function paneContains(text, literal) {
  return text.split('\n').some((line) => line.includes(literal));
}

export function footerLine(text) {
  const lines = text.split('\n').map((line) => line.trimEnd());
  while (lines.length > 0 && lines[lines.length - 1].trim() === '') lines.pop();
  return lines[lines.length - 3] ?? '';
}

/** A composer band row: one column of margin each side, then half-block glyphs. */
function isBandRow(line) {
  // tmux trims the trailing margin column, so only the leading margin is required.
  if (line.length < 6 || !line.startsWith(' ')) return false;
  const body = line.slice(1, -1).replace(/(Working|[↑↓] \d+ more)/g, '');
  if (!/^[▄▀ •·]*$/.test(body)) return false;
  return (body.match(/[▄▀]/g) ?? []).length >= 4;
}

/** A composer band row, or Pi's own borderless transcript rule where one belongs. */
function isRuleRow(line) {
  return isBandRow(line) || /^─{6,}$/.test(line.trim());
}

export function stripAnsi(text) {
  return String(text).replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, 'g'), '');
}

/** The lines between the last two editor rule rows. */
export function editorBlock(plain) {
  const lines = plain.split('\n');
  const rules = lines.flatMap((line, index) => (isRuleRow(line) ? [index] : []));
  if (rules.length < 2) return [];
  const [top, bottom] = rules.slice(-2);
  return lines.slice(top + 1, bottom);
}
