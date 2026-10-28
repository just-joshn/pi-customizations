import { expect, test } from 'vitest';
import { loadCatalog } from '../src/contract/catalog.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { binarySession } from '../src/tools/session-tools.ts';

test('KERN-036: binary_session reports the 229-tool availability inventory', async () => {
  const catalog = loadCatalog();
  expect(catalog.counts.tools).toBe(229);
  const session = new ReaSession({ name: 'pi-rea', version: '0.1.0', cwd: '/tmp' });
  const result = await binarySession(session, {});
  const payload = result.structuredContent as {
    result: { tool_availability: { name: string; available: boolean }[]; server_identity: { catalog: { digests: { tools_sha256: string } } } };
  };
  expect(payload.result.tool_availability).toHaveLength(229);
  expect(payload.result.tool_availability.filter((entry) => entry.available)).toHaveLength(catalog.counts.implemented);
  expect(payload.result.tool_availability.find((entry) => entry.name === 'inspect_plist')?.available).toBe(true);
  expect(payload.result.server_identity.catalog.digests.tools_sha256).toMatch(/^[a-f0-9]{64}$/);
});
