import { copyFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Box, stripTerminalSequences, Text } from '@earendil-works/pi-tui';
import fc from 'fast-check';
import { expect, test } from 'vitest';
import { restyleLines } from '../../extensions/adapters/restyle.ts';
import { generateDiffString } from '../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/edit-diff.js';
import { renderDiff } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/components/diff.js';
import { initTheme, loadThemeFromPath } from '../node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/theme.js';

test("Pi's own diffs: every diff line is recognized and wrapped rows are almost never mistaken for one", () => {
  const agent = mkdtempSync(join(tmpdir(), 'cdd-agent-'));
  mkdirSync(join(agent, 'themes'));
  const themePath = join(agent, 'themes/claude-default-dark.json');
  copyFileSync(join(import.meta.dirname, '../../themes/claude-default-dark.json'), themePath);
  process.env['PI_CODING_AGENT_DIR'] = agent;
  initTheme('claude-default-dark', false);
  const theme = loadThemeFromPath(themePath, 'truecolor');
  const word = fc.constantFrom('const', 'x', '=', '-2', '+3', '12', 'return', 'a'.repeat(36), '🚀', '日本', 'foo(bar)', ' ');
  const line = fc.array(word, { maxLength: 14 }).map((words) => words.join(' '));
  let continuations = 0;
  let rewritten = 0;
  const missed: string[] = [];
  fc.assert(
    fc.property(fc.array(line, { minLength: 1, maxLength: 120 }), fc.nat(), fc.nat(), fc.array(line, { maxLength: 6 }), fc.integer({ min: 24, max: 100 }), fc.integer({ min: 0, max: 2 }), (lines, a, b, replacement, width, pad) => {
      const start = a % lines.length;
      const next = [...lines.slice(0, start), ...replacement, ...lines.slice(Math.min(lines.length, start + (b % 6)))];
      const { diff } = generateDiffString(lines.join('\n'), next.join('\n'));
      if (!diff) return;
      const rows: { text: string; head: boolean; sign: string }[] = [];
      const rendered: string[] = [];
      for (const logical of renderDiff(diff).split('\n')) {
        const box = new Box(pad, 0);
        box.addChild(new Text(logical, 0, 0));
        const sign = stripTerminalSequences(logical)[0] ?? '';
        box.render(width).forEach((row: string, index: number) => {
          rows.push({ text: stripTerminalSequences(row), head: index === 0, sign });
          rendered.push(row);
        });
      }
      const styled = restyleLines(rendered, 'edit', 'result', theme, { expanded: true, isPartial: false, isError: false });
      rows.forEach((row, index) => {
        if (row.sign !== '+' && row.sign !== '-') return;
        const changed = stripTerminalSequences(styled[index] ?? '') !== row.text;
        if (row.head && !changed) missed.push(row.text.trim());
        if (!row.head) {
          continuations++;
          if (changed) rewritten++;
        }
      });
    }),
    { seed: 7, numRuns: 1500 },
  );
  expect(missed).toEqual([]);
  expect(continuations).toBeGreaterThan(1000);
  expect(rewritten / continuations).toBeLessThan(0.01);
}, 120_000);
