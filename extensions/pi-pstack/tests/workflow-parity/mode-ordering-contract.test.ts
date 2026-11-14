import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { modeDeclared } from './families/pr-shared.ts';
import { loadSession, type RunView } from './lib/view.ts';

test.for([true, false])('mode and poll in the same assistant message preserve content order (%s)', (textFirst) => {
  const dir = mkdtempSync(join(tmpdir(), 'mode-ordering-'));
  try {
    const file = join(dir, 'session.jsonl');
    const text = { type: 'text', text: 'I am using threads-only mode.' };
    const poll = { type: 'toolCall', id: 'p', name: 'bash', arguments: { command: 'gh pr view 71' } };
    writeFileSync(file, `${JSON.stringify({ type: 'message', message: { role: 'assistant', content: textFirst ? [text, poll] : [poll, text] } })}\n`);
    const check = modeDeclared('mode', { file: 'poteto-mode/playbooks/babysit.md', anchor: 'Declare the mode' }, 'threads-only');
    expect(check.run({ prompt: 'address review comments on PR 71', runs: [], parent: loadSession(file) } as unknown as RunView)).toMatchObject({ ok: textFirst });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
