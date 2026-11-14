export interface Cell {
  text: string;
  fg: string;
  bg: string;
  bold: boolean;
  dim: boolean;
  italic: boolean;
  underline: boolean;
  inverse: boolean;
}

const ESC = '\x1b';

const plain = (): Omit<Cell, 'text'> => ({
  fg: '\x1b[39m',
  bg: '\x1b[49m',
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
});

export function parse(line: string): Cell[] {
  const cells: Cell[] = [];
  let style = plain();
  for (const match of line.matchAll(new RegExp(`${ESC}\\[([0-9;]*)m|([^${ESC}])`, 'gu'))) {
    if (match[2] !== undefined) {
      cells.push({ ...style, text: match[2] });
      continue;
    }
    const codes = (match[1] || '0').split(';').map(Number);
    for (let i = 0; i < codes.length; i++) {
      const code = codes[i];
      if (code === 0) style = plain();
      else if (code === 1) style.bold = true;
      else if (code === 2) style.dim = true;
      else if (code === 3) style.italic = true;
      else if (code === 4) style.underline = true;
      else if (code === 7) style.inverse = true;
      else if (code === 22) style.bold = style.dim = false;
      else if (code === 23) style.italic = false;
      else if (code === 24) style.underline = false;
      else if (code === 27) style.inverse = false;
      else if (code === 39) style.fg = '\x1b[39m';
      else if (code === 49) style.bg = '\x1b[49m';
      else if (code === 38 || code === 48) {
        const count = codes[i + 1] === 2 ? 5 : codes[i + 1] === 5 ? 3 : 0;
        if (!count) throw new Error('Unsupported color escape');
        const ansi = `\x1b[${codes.slice(i, i + count).join(';')}m`;
        if (code === 38) style.fg = ansi;
        else style.bg = ansi;
        i += count - 1;
      } else throw new Error('Unsupported SGR escape');
    }
  }
  if (line.replace(new RegExp(`${ESC}\\[[0-9;]*m`, 'g'), '').includes('\x1b')) throw new Error('Unsupported terminal escape');
  return cells;
}

export function serialize(cells: Cell[]): string {
  let result = '';
  let previous = '';
  for (const cell of cells) {
    if (cell.inverse) throw new Error('Unconverted inverse');
    const style = `\x1b[0m${cell.fg}${cell.bg}${cell.bold ? '\x1b[1m' : ''}${cell.dim ? '\x1b[2m' : ''}${cell.italic ? '\x1b[3m' : ''}${cell.underline ? '\x1b[4m' : ''}`;
    if (style !== previous) result += style;
    result += cell.text;
    previous = style;
  }
  return `${result}\x1b[0m`;
}
