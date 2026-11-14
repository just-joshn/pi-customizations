import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { babysitFlakeTwiceFamily } from './families/pr-babysit.ts';
import { forgeDirOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

test.for([0, 1, 2])('one fresh build is an observed CI action, not a requirement for exactly two watchers (%s)', (count) => {
  const sandbox = mkdtempSync(join(tmpdir(), 'retry-watchers-'));
  try {
    mkdirSync(forgeDirOf(sandbox), { recursive: true });
    writeFileSync(join(forgeDirOf(sandbox), 'state.json'), JSON.stringify({ prs: {} }));
    const actions = [{ kind: 'log-view' }, { kind: 'rerun', retry: 'fresh-build' }];
    const save = () => writeFileSync(join(forgeDirOf(sandbox), 'actions.jsonl'), actions.map((action) => JSON.stringify(action)).join('\n'));
    save();
    const workers = Array.from({ length: count }, (_, index) => ({ id: `watch-${index}`, assignment: { kind: 'watch' }, state: { kind: 'watch', exit: { code: 4 } } }));
    const view = { sandbox, runs: [{ workers }] } as unknown as RunView;
    const check = babysitFlakeTwiceFamily.checks.find((entry) => entry.id === 'babysit.twice.exactly-one-fresh-build-then-no-more');
    expect(check?.run(view)).toMatchObject({ ok: count > 0 });
    if (workers[0] !== undefined) {
      workers[0].state.exit.code = 0;
      expect(check?.run(view)).toMatchObject({ ok: false });
      workers[0].state.exit.code = 4;
    }
    actions.push({ kind: 'rerun', retry: 'fresh-build' });
    save();
    expect(check?.run(view)).toMatchObject({ ok: false });
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
