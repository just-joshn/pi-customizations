export type Color = { kind: 'default' } | { kind: 'rgb'; hex: `#${string}` } | { kind: 'ansi256'; index: number };

export interface Attributes {
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
  strikethrough: boolean;
}

export interface Style {
  fg: Color;
  bg: Color;
  attrs: Attributes;
  link: boolean;
}

export interface Run {
  row: number;
  col: number;
  width: number;
  text: string;
  style: Style;
}

const DEFAULT: Color = { kind: 'default' };
const plain = (): Style => ({
  fg: DEFAULT,
  bg: DEFAULT,
  attrs: { bold: false, dim: false, italic: false, underline: false, inverse: false, strikethrough: false },
  link: false,
});

const hex = (r: number, g: number, b: number): Color => ({
  kind: 'rgb',
  hex: `#${[r, g, b].map((n) => n.toString(16).padStart(2, '0')).join('')}`,
});

function extended(params: number[], i: number): [Color, number] {
  if (params[i + 1] === 2) return [hex(params[i + 2] ?? 0, params[i + 3] ?? 0, params[i + 4] ?? 0), i + 4];
  if (params[i + 1] === 5) return [{ kind: 'ansi256', index: params[i + 2] ?? 0 }, i + 2];
  throw new Error(`unsupported extended color ${params.slice(i).join(';')}`);
}

export function applySgr(style: Style, raw: string): Style {
  if (raw.includes(':')) throw new Error(`unsupported colon-form SGR ${raw}`);
  const params = raw === '' ? [0] : raw.split(';').map(Number);
  const next: Style = { ...style, attrs: { ...style.attrs } };
  for (let i = 0; i < params.length; i++) {
    const p = params[i];
    if (p === undefined) continue;
    if (p === 0) Object.assign(next, plain(), { link: next.link });
    else if (p === 1) next.attrs.bold = true;
    else if (p === 2) next.attrs.dim = true;
    else if (p === 3) next.attrs.italic = true;
    else if (p === 4) next.attrs.underline = true;
    else if (p === 7) next.attrs.inverse = true;
    else if (p === 9) next.attrs.strikethrough = true;
    else if (p === 22) next.attrs.bold = next.attrs.dim = false;
    else if (p === 23) next.attrs.italic = false;
    else if (p === 24) next.attrs.underline = false;
    else if (p === 27) next.attrs.inverse = false;
    else if (p === 29) next.attrs.strikethrough = false;
    else if (p >= 30 && p <= 37) next.fg = { kind: 'ansi256', index: p - 30 };
    else if (p >= 90 && p <= 97) next.fg = { kind: 'ansi256', index: p - 90 + 8 };
    else if (p >= 40 && p <= 47) next.bg = { kind: 'ansi256', index: p - 40 };
    else if (p >= 100 && p <= 107) next.bg = { kind: 'ansi256', index: p - 100 + 8 };
    else if (p === 39) next.fg = DEFAULT;
    else if (p === 49) next.bg = DEFAULT;
    else if (p === 38) [next.fg, i] = extended(params, i);
    else if (p === 48) [next.bg, i] = extended(params, i);
    else throw new Error(`unsupported SGR parameter ${p} in "${raw}"`);
  }
  return next;
}

export function cellWidth(char: string): number {
  const cp = char.codePointAt(0) ?? 0;
  if (/\p{Mark}/u.test(char) || cp === 0x200d || (cp >= 0xfe00 && cp <= 0xfe0f)) return 0;
  if (/\p{Extended_Pictographic}/u.test(char) && cp >= 0x1f000) return 2;
  if (
    (cp >= 0x1100 && cp <= 0x115f) ||
    (cp >= 0x2e80 && cp <= 0xa4cf) ||
    (cp >= 0xac00 && cp <= 0xd7a3) ||
    (cp >= 0xf900 && cp <= 0xfaff) ||
    (cp >= 0xfe30 && cp <= 0xfe4f) ||
    (cp >= 0xff00 && cp <= 0xff60) ||
    (cp >= 0xffe0 && cp <= 0xffe6) ||
    (cp >= 0x2600 && cp <= 0x27bf && /\p{Emoji_Presentation}/u.test(char)) ||
    (cp >= 0x20000 && cp <= 0x3fffd)
  )
    return 2;
  return 1;
}

const sameStyle = (a: Style, b: Style) => JSON.stringify(a) === JSON.stringify(b);

const invisibleWhenBlank = (style: Style) => style.bg.kind === 'default' && !style.attrs.inverse && !style.attrs.underline && !style.attrs.strikethrough && !style.link;

export function parseCapture(text: string): Run[] {
  const runs: Run[] = [];
  let style = plain();
  const lines = text.split(/\r?\n/);
  if (lines.at(-1) === '') lines.pop();
  lines.forEach((line, row) => {
    let col = 0;
    let current: Run | undefined;
    const pattern = /\x1b\[([0-9;:]*)m|\x1b\]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)|\x1b[^\x1b]*?|([\s\S])/gu;
    for (const match of line.matchAll(pattern)) {
      const [, sgr, linkTarget, char] = match;
      if (sgr !== undefined) {
        style = applySgr(style, sgr);
        current = undefined;
      } else if (linkTarget !== undefined) {
        style = { ...style, link: linkTarget !== '' };
        current = undefined;
      } else if (char !== undefined) {
        const width = cellWidth(char);
        if (current && sameStyle(current.style, style)) {
          current.text += char;
          current.width += width;
        } else {
          current = { row, col, width, text: char, style };
          runs.push(current);
        }
        col += width;
      } else {
        throw new Error(`unhandled escape at row ${row}: ${JSON.stringify(match[0])}`);
      }
    }
    for (let last = runs.at(-1); last && last.row === row && invisibleWhenBlank(last.style); last = runs.at(-1)) {
      const kept = last.text.trimEnd();
      last.width -= last.text.length - kept.length;
      last.text = kept;
      if (kept) break;
      runs.pop();
    }
  });
  return runs;
}
