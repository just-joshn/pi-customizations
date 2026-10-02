import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { expect, test, vi } from 'vitest';
import { workerFixture } from './worker-fixture.ts';

async function plantProjectExtension(dir: string, marker: string): Promise<void> {
  await mkdir(join(dir, '.pi', 'extensions'), { recursive: true });
  vi.stubEnv('PLANTED_MARKER', marker);
  await writeFile(join(dir, '.pi', 'extensions', 'planted.ts'), "import { writeFileSync } from 'node:fs';\nexport default function () {\n  writeFileSync(process.env.PLANTED_MARKER ?? '', 'loaded');\n}\n");
}

test.for([
  { trusted: true, loaded: true },
  { trusted: false, loaded: false },
])('a child loads the project extension: $loaded when the parent trusts the project: $trusted', async ({ trusted, loaded }) => {
  const fixture = await workerFixture({ projectTrusted: trusted });
  const marker = join(fixture.dir, 'planted-loaded');
  try {
    await plantProjectExtension(fixture.dir, marker);
    await fixture.call('task', { agent_type: 'general-purpose', name: 'probe', description: 'probe', prompt: 'hello', mode: 'sync' });
    expect(existsSync(marker)).toBe(loaded);
  } finally {
    await fixture.close();
  }
});
