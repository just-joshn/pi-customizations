import { readFile } from 'node:fs/promises';

import { expect, test } from 'vitest';

const extensions = ['pi-anthropic-oauth', 'pi-antigravity-oauth', 'pi-one-dark-pro-theme', 'pi-pstack', 'pi-tui-skin', 'pi-xai-oauth'];

test.for(extensions)('%s develops against Pi 1.0.2 without bundling host packages', async (name) => {
  const manifest = JSON.parse(await readFile(new URL(`../../${name}/package.json`, import.meta.url), 'utf8'));
  const pins = Object.entries(manifest.devDependencies).filter(([dependency]) => dependency.startsWith('@earendil-works/pi-'));

  expect(pins.length).toBeGreaterThan(0);
  for (const [dependency, version] of pins) {
    expect(version).toBe('1.0.2');
    if (manifest.pi.extensions?.length) expect(manifest.peerDependencies?.[dependency]).toBe('*');
    expect(manifest.dependencies?.[dependency]).toBeUndefined();
  }
});
