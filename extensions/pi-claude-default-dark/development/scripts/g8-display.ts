import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CLAUDE_HEX } from '../../extensions/adapters/palette-hex.ts';
import { attrList, resolve, screen } from '../lib/align.ts';
import { currentInputs, manualVerdict, rollup } from '../lib/gates.ts';
import { cellWidth, parseCapture } from '../lib/sgr.ts';
import { runPi } from './g9-robustness.mjs';

const ADAPTER_VALUES = new Set<string>(Object.values(CLAUDE_HEX));

import type { ThemeColor, ThemeToken } from '@earendil-works/pi-coding-agent';
import { CaptureRunSchema, directions, ManualChecksSchema, ObservationsSchema, PaletteSchema, readJson, roleEntries, ThemeSchema, type Verdict } from '../lib/schemas.ts';
import { loadThemeFromPath } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';
import { THEME_TOKENS } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme-tokens.js';

const dev = join(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = { package: currentInputs(join(dev, '..')).package };
const checks: { name: string; verdict: Verdict; evidence: unknown }[] = [];
const palette = readJson(join(dev, 'captures/terminal-palette.json'), PaletteSchema);
const themeDir = join(dev, 'node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme');
const stockTheme = loadThemeFromPath(join(themeDir, 'dark.json'), 'truecolor');
const targetTheme = loadThemeFromPath(join(dev, '../themes/claude-default-dark.json'), 'truecolor');
const isForeground = (role: ThemeToken): role is ThemeColor => THEME_TOKENS[role].slot === 'foreground';
const colorValue = (theme: typeof stockTheme, role: ThemeToken): string => {
  const foreground = isForeground(role);
  const [run] = parseCapture(foreground ? theme.fg(role, 'x') : theme.bg(role, 'x'));
  if (!run) throw new Error(`theme emitted no color for ${role}`);
  const color = foreground ? run.style.fg : run.style.bg;
  return color.kind === 'default' ? 'default' : resolve(color, 'fg', palette);
};
const allowedColors = new Map<string, Set<string>>();
for (const [role] of roleEntries(readJson(join(themeDir, 'dark.json'), ThemeSchema).colors)) {
  const from = colorValue(stockTheme, role);
  const to = colorValue(targetTheme, role);
  const set = allowedColors.get(from) ?? new Set([from]);
  set.add(to);
  allowedColors.set(from, set);
}
mkdirSync(join(dev, 'results'), { recursive: true });
const load = (dir: string, scene: string) => readFileSync(join(dev, 'captures', dir, `${scene}.ansi`), 'utf8');
const grid = (text: string) => {
  const rows: string[][] = [];
  for (const run of parseCapture(text)) {
    const row = rows[run.row] ?? [];
    rows[run.row] = row;
    for (const char of run.text) {
      const width = cellWidth(char);
      if (!width && row.length) row[row.length - 1] += char;
      else {
        row.push(char);
        for (let i = 1; i < width; i++) row.push('');
      }
    }
  }
  return rows.slice(0, -2);
};
for (const width of [40, 80, 200]) {
  const themed = `pi-claude-default-dark-w${width}`;
  const stock = `pi-dark-w${width}`;
  const command = process.argv.includes('--existing-captures')
    ? { status: 0, stdout: 'Reanalyzing existing capture artifacts.', stderr: '', error: undefined }
    : spawnSync(process.execPath, ['scripts/capture.mjs', '--product', 'pi', '--theme', 'claude-default-dark', '--package', '..', '--width', String(width), '--out', themed], { cwd: dev, encoding: 'utf8', timeout: 600_000 });
  writeFileSync(join(dev, 'results', `g8-capture-w${width}.log`), `${command.stdout}\n${command.stderr}`);
  const runPath = join(dev, 'captures', themed, 'run.json');
  const run = existsSync(runPath) ? readJson(runPath, CaptureRunSchema) : undefined;
  checks.push({
    name: `capture-w${width}`,
    verdict: command.status === 0 && run && !Object.keys(run.failures).length && !run.nonLoopbackConnections.length && !run.refusedEgress.length ? 'PASS' : 'FAIL',
    evidence: { runPath, status: command.status, error: command.error?.message },
  });
  if (!run) continue;
  try {
    const expected = grid(load(stock, 'unicode'));
    const actual = grid(load(themed, 'unicode'));
    const differences = expected.flatMap((row, y) => row.map((char, x) => (char === actual[y]?.[x] ? undefined : { row: y, col: x, expected: char, actual: actual[y]?.[x] })).filter(Boolean));
    checks.push({
      name: `unicode-cell-grid-w${width}`,
      verdict: JSON.stringify(expected) === JSON.stringify(actual) ? 'PASS' : 'FAIL',
      evidence: {
        stock: `captures/${stock}/unicode.ansi`,
        themed: `captures/${themed}/unicode.ansi`,
        differences: differences.slice(0, 30),
        expectedRows: expected.length,
        actualRows: actual.length,
        scope: 'Full screen cell grid except the final two environment-dependent working-directory and usage footer rows.',
      },
    });
    const changes: unknown[] = [];
    const colorChanges: unknown[] = [];
    let compared = 0;
    let adapterOwned = 0;
    for (const file of readdirSync(join(dev, 'captures', themed)).filter((f) => f.endsWith('.ansi'))) {
      if (!existsSync(join(dev, 'captures', stock, file))) continue;
      const a = screen(load(stock, file.slice(0, -5)));
      const b = screen(load(themed, file.slice(0, -5)));
      for (let row = 0; row < a.cells.length; row++) {
        const ac = a.cells[row];
        const bc = b.cells[row];
        if (!ac || !bc || a.lines[row] !== b.lines[row]) continue;
        for (const [col, source] of ac.entries()) {
          const target = bc[col];
          if (!target) throw new Error(`missing themed cell ${row}:${col}`);
          const tone = (cell: typeof source, direction: (typeof directions)[number]) => (cell.style[direction].kind === 'default' ? 'default' : resolve(cell.style[direction], direction, palette));
          const owned = directions.filter((direction) => {
            const from = tone(source, direction);
            const value = tone(target, direction);
            if (value === from || allowedColors.get(from)?.has(value)) return false;
            return /^(tool-|working-)/.test(file) && (ADAPTER_VALUES.has(value) || (direction === 'fg' && value === 'default' && from === colorValue(stockTheme, 'accent')));
          });
          if (owned.length) adapterOwned++;
          else compared++;
          for (const direction of directions) {
            if (owned.includes(direction)) continue;
            const from = tone(source, direction);
            const to = tone(target, direction);
            if (!(allowedColors.get(from) ?? new Set([from])).has(to)) colorChanges.push({ file, row, col, direction, from, to });
          }
          const was = source.style.attrs;
          const now = target.style.attrs;
          const adapterAttr = (key: keyof typeof was) => owned.length > 0 && (((key === 'bold' || key === 'inverse') && was[key] && !now[key]) || (key === 'dim' && !was[key] && now[key]));
          const unexplained = (['bold', 'dim', 'italic', 'underline', 'inverse', 'strikethrough'] as const).filter((key) => was[key] !== now[key] && !adapterAttr(key));
          if (unexplained.length) changes.push({ file, row, col, stock: attrList(source.style), themed: attrList(target.style) });
        }
      }
    }
    checks.push({
      name: `wrapped-line-attributes-w${width}`,
      verdict: changes.length ? 'FAIL' : compared ? 'PASS' : 'INCONCLUSIVE',
      evidence: {
        compared,
        changes: changes.slice(0, 30),
        adapterOwned,
        scope:
          'Attributes on identical stock/themed screen rows, with SGR state carried across line boundaries. Cells the tool and working-indicator adapters restyle to their documented colors are excluded here and verified by the adapter property tests and surface observations.',
      },
    });
    checks.push({
      name: `wrapped-cell-color-transitions-w${width}`,
      verdict: colorChanges.length ? 'FAIL' : compared ? 'PASS' : 'INCONCLUSIVE',
      evidence: {
        compared,
        changes: colorChanges.slice(0, 30),
        scope: 'Stock RGB values map to the corresponding target role colors on identical screen rows. Shared stock role colors allow each corresponding target color; unchanged colors are allowed for fixed Pi branding.',
      },
    });
    checks.push({
      name: `unclosed-sgr-and-color-bleed-w${width}`,
      verdict: 'INCONCLUSIVE',
      evidence:
        'tmux capture-pane serializes the final styled grid and intentionally carries SGR across lines. It cannot prove application-stream reset placement or distinguish an intentional role color from inherited color. Raw PTY output and role-tagged wrapped-cell anchors are unavailable.',
    });
    const pairs: { key: string; verdict: Verdict; reason?: string; expected?: string[]; actual?: string[]; claudeAt?: number[]; piAt?: number[] }[] = [];
    const seen = new Set<string>();
    const observations = readJson(join(dev, 'captures/observations.json'), ObservationsSchema);
    for (const o of observations) {
      const key = `${o.scene}/${o.role}/${o.direction}/${o.token}`;
      if (seen.has(key)) continue;
      seen.add(key);
      if (!existsSync(join(dev, 'captures', `claude-w${width}`, `${o.scene}.ansi`))) continue;
      const a = screen(load(`claude-w${width}`, o.scene));
      const b = screen(load(themed, o.scene));
      const find = (s: ReturnType<typeof screen>) =>
        s.lines.flatMap((line, row) => {
          const first = line.indexOf(o.token);
          if (first < 0 || line.indexOf(o.token, first + 1) !== -1) return [];
          const col = [...line.slice(0, first)].length;
          return [{ row, col, cells: (s.cells[row] ?? []).slice(col, col + [...o.token].length) }];
        });
      const aa = find(a);
      const bb = find(b);
      const [claudeAnchor] = aa;
      const [piAnchor] = bb;
      if (aa.length !== 1 || bb.length !== 1 || !claudeAnchor || !piAnchor) {
        pairs.push({ key, verdict: 'INCONCLUSIVE', reason: 'Text anchor is absent or not unique at this width.' });
        continue;
      }
      const style = (c: (typeof aa)[number]) => [
        ...new Set(
          c.cells.map((cell) => {
            const color = resolve(cell.style[o.direction], o.direction, palette);
            const rgb = color === 'default-fg' ? palette.foreground_rgb : color === 'default-bg' ? palette.background_rgb : color;
            return `${rgb}${o.direction === 'fg' ? ` ${attrList(cell.style)}` : ''}`;
          }),
        ),
      ];
      const expected = style(claudeAnchor);
      const actual = style(piAnchor);
      pairs.push({
        key,
        expected,
        actual,
        verdict: expected.length !== 1 || actual.length !== 1 ? 'INCONCLUSIVE' : expected[0] === actual[0] ? 'PASS' : 'FAIL',
        claudeAt: [claudeAnchor.row, claudeAnchor.col],
        piAt: [piAnchor.row, piAnchor.col],
      });
    }
    const verdict = pairs.some((p) => p.verdict === 'FAIL') ? 'FAIL' : 'INCONCLUSIVE';
    const comparisonPath = join(dev, 'results', `g4-w${width}.json`);
    writeFileSync(
      comparisonPath,
      `${JSON.stringify({ gate: 'G4', verdict, width, reason: 'Unique text anchors are re-paired at this width. The original 120-column role-probe coordinates are not reused; full role coverage remains unproven.', pairs }, null, 2)}\n`,
    );
    checks.push({ name: `g4-style-w${width}`, verdict, evidence: comparisonPath });
  } catch (error) {
    checks.push({ name: `analysis-w${width}`, verdict: 'INCONCLUSIVE', evidence: String(error) });
  }
}
try {
  const result = await runPi('g8-256color', { themeText: readFileSync(join(dev, '../themes/claude-default-dark.json'), 'utf8'), colorTerm: null, commands: ['/claude-theme status'] });
  const ansi = readFileSync(result.ansi, 'utf8');
  const rgbSgr = /\x1b\[(?:38|48);2;/.test(ansi);
  const indexedSgr = /\x1b\[(?:38|48);5;/.test(ansi);
  checks.push({
    name: '256-color-behavior',
    verdict: result.ready && !result.nonLoopbackConnections.length && !result.refusedEgress.length && indexedSgr && !rgbSgr ? 'PASS' : 'FAIL',
    evidence: {
      ...result,
      term: 'xterm-256color',
      COLORTERM: 'unset',
      rgbSgr,
      indexedSgr,
      limitation: 'Exact RGB parity is not claimable in 256-color terminals. Design section 10 excludes this environment from exact truecolor certification.',
    },
  });
} catch (error) {
  checks.push({ name: '256-color-behavior', verdict: 'INCONCLUSIVE', evidence: String(error) });
}
const manualFile = join(dev, 'results/manual-checks.json');
const manual = existsSync(manualFile) ? readJson(manualFile, ManualChecksSchema).checks : [];
const hashOf = (file: string) =>
  existsSync(join(dev, file))
    ? createHash('sha256')
        .update(readFileSync(join(dev, file)))
        .digest('hex')
    : undefined;
for (const { name, why } of [
  { name: 'IME', why: 'tmux cannot drive a platform input method editor or observe its composition window.' },
  { name: 'live-resize', why: 'Fixed-width captures do not exercise a mid-session resize and terminal redraw.' },
]) {
  const record = manual.find((c) => c.name === name);
  const { verdict, reason } = manualVerdict(record, inputs.package, hashOf);
  checks.push({ name, verdict, evidence: { manual: reason, evidence: record?.evidence ?? [], automated: why } });
}
const verdict = rollup(checks);
writeFileSync(join(dev, 'results/g8.json'), `${JSON.stringify({ gate: 'G8', verdict, inputs, checks }, null, 2)}\n`);
console.log(JSON.stringify({ gate: 'G8', verdict }));
process.exitCode = verdict === 'PASS' ? 0 : 1;
