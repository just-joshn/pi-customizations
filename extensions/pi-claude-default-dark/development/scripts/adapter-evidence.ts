import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';

import { screen } from '../lib/align.ts';

const beforeDirectory = process.argv[2] ?? 'captures/debug-adapters-before';
const afterDirectory = process.argv[3] ?? 'captures/debug-adapters';
const observations: { scene: string; token: string; claude: string; before: unknown; after: unknown }[] = [];

async function probe(scene: string, token: string, character: string, expected: { fg?: string; bg?: string; bold?: boolean; dim?: boolean }, claude: string) {
  const views = await Promise.all([beforeDirectory, afterDirectory].map(async (directory) => screen(await readFile(`${directory}/${scene}.ansi`, 'utf8'))));
  const cells = views.map((view, index) => {
    const search = index === 0 ? token.replace('2 -', '- 2').replace('2 +', '+ 2').replace('1  export', '1 export') : token;
    const row = view.lines.findIndex((line) => line.includes(search) && (search.startsWith('$') || !line.includes('$ ')));
    assert.ok(row >= 0, `${scene}: missing ${token}`);
    const text = view.lines[row] ?? '';
    const offset = text.indexOf(search);
    const col = [...text.slice(0, offset + search.indexOf(character))].length;
    const cell = view.cells[row]?.[col];
    assert.ok(cell, `${scene}@${row}:${col}`);
    return { at: `${row}:${col}`, char: cell.char, fg: cell.style.fg, bg: cell.style.bg, ...cell.style.attrs };
  });
  const after = cells[1];
  assert.ok(after);
  for (const [key, value] of Object.entries(expected)) {
    if (key === 'fg' || key === 'bg') assert.deepEqual(after[key], value === 'default' ? { kind: 'default' } : { kind: 'rgb', hex: value });
    else if (key === 'bold' || key === 'dim') assert.equal(after[key], value);
  }
  observations.push({ scene, token, claude, before: cells[0], after });
}

await probe('tool-edit', 'const maxAttempts = 3;', 'c', { bg: '#3d0100' }, 'tool-edit@13:9');
await probe('tool-edit', 'const maxAttempts = 5;', 'c', { bg: '#022800' }, 'tool-edit@15:11');
await probe('tool-edit', 'const maxAttempts = 3;', '3', { bg: '#5c0200' }, 'tool-edit@13:31');
await probe('tool-edit', 'const maxAttempts = 5;', '5', { bg: '#044700' }, 'tool-edit@15:31');
await probe('tool-edit', '2 -', '-', { fg: '#dc5a5a' }, 'tool-edit@13:5');
await probe('tool-edit', '2 +', '+', { fg: '#50c850' }, 'tool-edit@15:5');
await probe('tool-edit', '1  export', '1', { fg: '#f8f8f2', dim: true }, 'tool-edit@12:5');
await probe('tool-edit', 'src/client.ts', 's', { fg: 'default' }, 'tool-edit@10:8');
await probe('tool-read', 'notes.txt', 'n', { fg: 'default' }, 'tool-read-expanded@10:6');
await probe('tool-read', 'read notes.txt', 'r', { fg: '#999999', bold: false }, 'tool-read@10:2');
await probe('tool-bash-ok', '$ printf', '$', { fg: '#999999', bold: false }, 'tool-bash-ok@10:2');
await probe('tool-pending', '$ sleep', '$', { fg: '#999999', bold: false }, 'tool-pending@11:0');
await probe('tool-bash-fail-expanded', 'FAIL tests/client.test.ts', 'F', { fg: '#ff6b80' }, 'tool-bash-fail-expanded@11:5');
await probe('tool-bash-fail-expanded', 'Command exited with code 1', 'C', { fg: '#ff6b80' }, 'tool-bash-fail-expanded@12:5');
await probe('working-800ms', 'Working', 'W', { fg: '#d77757' }, 'working-800ms@34:0 (message)');
const afterWorking = screen(await readFile(`${afterDirectory}/working-800ms.ansi`, 'utf8'));
const workingRow = afterWorking.lines.findIndex((line) => line.includes('Working'));
const spinner = afterWorking.cells[workingRow]?.find((cell) => ['✻', '✽', '✢', '✶', '·'].includes(cell.char));
assert.ok(spinner);
assert.deepEqual(spinner.style.fg, { kind: 'rgb', hex: '#d77757' });
const beforeWorking = screen(await readFile(`${beforeDirectory}/working-800ms.ansi`, 'utf8'));
const beforeWorkingRow = beforeWorking.lines.findIndex((line) => line.includes('Working'));
const beforeSpinner = beforeWorking.cells[beforeWorkingRow]?.[3];
const spinnerCol = afterWorking.cells[workingRow]?.indexOf(spinner);
const report = {
  status: 'PASS',
  beforeDirectory,
  afterDirectory,
  observations,
  spinner: { before: { at: `${beforeWorkingRow}:3`, char: beforeSpinner?.char, fg: beforeSpinner?.style.fg }, after: { at: `${workingRow}:${spinnerCol}`, char: spinner?.char, fg: spinner?.style.fg } },
};
await writeFile('results/adapter-observations.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
