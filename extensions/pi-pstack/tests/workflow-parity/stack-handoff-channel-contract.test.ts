import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, test } from 'vitest';
import { autopilotStackFamily } from './families/pr-autopilot.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

test('stack handoff follows the report, not the first verdict comment', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'stack-handoff-'));
  try {
    mkdirSync(forgeDirOf(sandbox), { recursive: true });
    writeFileSync(join(forgeDirOf(sandbox), 'state.json'), '{"prs":{"41":{"state":"OPEN"},"42":{"state":"OPEN"}}}');
    const actions = [{ kind: 'create', pr: 41, ts: '2026-11-14T01:00:00Z' }, { kind: 'create', pr: 42, ts: '2026-11-14T02:00:00Z' }];
    const save = () => writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), actions.map((action) => JSON.stringify(action)).join('\n'));
    save();
    const message = { role: 'assistant', order: 3, at: '2026-11-14T03:00:00Z', text: 'PR 41 gates PASS, live PASS. PR 42 gates PASS, live PASS. Nothing has merged.' };
    const view = { sandbox, runs: [], parent: { messages: [message], toolCalls: [] } } as unknown as RunView;
    const run = (suffix: string) => autopilotStackFamily.checks.find((entry) => entry.id === `autopilot.stack.${suffix}`)?.run(view);
    expect(run('nothing-merges-and-nobody-pushes-after-the-handoff')).toMatchObject({ ok: true });
    expect(run('reply-lists-each-pr-with-its-verdict')).toMatchObject({ ok: true });
    actions.push({ kind: 'push', pr: 42, ts: '2026-11-14T04:00:00Z' });
    save();
    expect(run('nothing-merges-and-nobody-pushes-after-the-handoff')).toMatchObject({ ok: false });
    message.text = 'PR 41 PASS. PR 42 PASS. All merged.';
    expect(run('reply-lists-each-pr-with-its-verdict')).toMatchObject({ ok: false });
    message.text = 'PR 41 PASS. PR 42 awaiting verification. Nothing merged.';
    expect(run('reply-lists-each-pr-with-its-verdict')).toMatchObject({ ok: false });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
