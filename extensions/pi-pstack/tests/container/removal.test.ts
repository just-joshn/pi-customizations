import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout } from 'node:timers/promises';

import { expect, test } from 'vitest';
import { removeWorkerContainers } from '../../src/container.ts';

test('removal already in progress is not completed removal', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pstack-removal-'));
  const docker = join(dir, 'docker');
  const present = join(dir, 'present');
  const observed = join(dir, 'observed');
  writeFileSync(present, 'container-id');
  writeFileSync(
    docker,
    `#!/bin/sh
case "$1" in
  ps)
    if [ -f '${observed}' ]; then echo checked >> '${observed}'; fi
    if [ -f '${present}' ]; then echo container-id; fi
    ;;
  rm)
    echo removing > '${observed}'
    echo 'removal of container container-id is already in progress' >&2
    exit 1
    ;;
esac
`,
    { mode: 0o755 },
  );
  let completed = false;
  const removal = removeWorkerContainers(docker, process.env, 'owned-worker').then((ids) => {
    completed = true;
    return ids;
  });
  try {
    const deadline = Date.now() + 5_000;
    while (!completed && (!existsSync(observed) || !readFileSync(observed, 'utf8').includes('checked'))) {
      if (Date.now() >= deadline) throw new Error('Removal never checked whether the container was gone');
      await setTimeout(10);
    }
    expect(completed).toBe(false);
    expect(existsSync(present)).toBe(true);
    rmSync(present);
    expect(await removal).toEqual(['container-id']);
    expect(existsSync(present)).toBe(false);
  } finally {
    rmSync(present, { force: true });
    await removal;
    rmSync(dir, { recursive: true, force: true });
  }
});
