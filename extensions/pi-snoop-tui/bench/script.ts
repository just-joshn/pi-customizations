import { writeFileSync } from 'node:fs';
import { join } from 'node:path';

import type { Turn } from './replay.ts';

export const FIXTURE_FILE = 'fixture.txt';
export const EDIT_FILE = 'edit-target.txt';
const EDIT_OLD = 'status: draft';
const EDIT_NEW = 'status: final';
const WORDS = ['render', 'frame', 'buffer', 'stream', 'theme', 'footer', 'header', 'width', 'line', 'cache', 'delta', 'token', 'model', 'tool', 'row', 'panel'];
const SEED_STRIDE = 7;
const WORD_STRIDE = 3;
const INTRO_WORDS = 12;
const FOLLOW_WORDS = 9;
const BULLET_A_WORDS = 6;
const BULLET_B_WORDS = 7;
const BULLET_B_SEED = 3;
const FRAME_STRIDE = 8;
const MAIN_TURN_CHARS = 3000;
const FOLLOWUP_TURN_CHARS = 1500;
const FIXTURE_LINES = 2000;
const MARKER_EVERY = 100;
const BASH_COMMAND = 'i=1; while [ $i -le 3000 ]; do echo "row $i alpha beta gamma delta"; [ $((i % 150)) -eq 0 ] && sleep 0.1; i=$((i+1)); done';

function sentence(seed: number, length: number): string {
  const words = Array.from({ length }, (_, i) => WORDS[(seed * SEED_STRIDE + i * WORD_STRIDE) % WORDS.length] ?? 'row');
  const text = words.join(' ');
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}

function markdownSection(section: number): string {
  return [
    `## Section ${section + 1}`,
    '',
    `${sentence(section, INTRO_WORDS)} ${sentence(section + 1, FOLLOW_WORDS)} The **${WORDS[section % WORDS.length]}** path stays \`stable\`.`,
    '',
    `- ${sentence(section + 2, BULLET_A_WORDS)}`,
    `- ${sentence(section + BULLET_B_SEED, BULLET_B_WORDS)}`,
    '',
    '```ts',
    `const width${section} = render(frame, ${section * FRAME_STRIDE});`,
    '```',
    '',
  ].join('\n');
}

export function markdown(targetChars: number): string {
  let blocks: readonly string[] = [];
  let length = 0;
  for (let section = 0; length < targetChars; section++) {
    const block = markdownSection(section);
    blocks = [...blocks, block];
    length += block.length;
  }
  return blocks.join('\n').slice(0, targetChars);
}

export const SCRIPT: readonly Turn[] = [
  {
    text: markdown(MAIN_TURN_CHARS),
    toolCalls: [
      { id: 'bench-bash', name: 'bash', arguments: { command: BASH_COMMAND } },
      { id: 'bench-read', name: 'read', arguments: { path: FIXTURE_FILE } },
      { id: 'bench-grep', name: 'grep', arguments: { pattern: 'marker', path: FIXTURE_FILE } },
      { id: 'bench-edit', name: 'edit', arguments: { path: EDIT_FILE, edits: [{ oldText: EDIT_OLD, newText: EDIT_NEW }] } },
    ],
  },
  { text: markdown(FOLLOWUP_TURN_CHARS), toolCalls: [] },
];

export function writeFixtures(cwd: string): void {
  const lines = Array.from({ length: FIXTURE_LINES }, (_, i) => ((i + 1) % MARKER_EVERY === 0 ? `${i + 1} marker line` : `${i + 1} plain fixture line`));
  writeFileSync(join(cwd, FIXTURE_FILE), `${lines.join('\n')}\n`);
  writeFileSync(join(cwd, EDIT_FILE), `title: bench\n${EDIT_OLD}\nowner: snoop\n`);
}
