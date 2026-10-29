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
    result: {
      tool_availability: { client_requirements: Record<string, string[]>; groups: { names: string[]; available: boolean; reason: string | null }[] };
      server_identity: { catalog: { counts: { implemented_tools: number }; digests: { tools_sha256: string } } };
    };
  };
  const availability = payload.result.tool_availability;
  expect(availability.client_requirements).toStrictEqual({ required: [], optional: [], missing_required: [], missing_optional: [] });
  const names = availability.groups.flatMap((group) => group.names);
  expect(names).toHaveLength(229);
  expect(availability.groups.filter((group) => group.available).flatMap((group) => group.names)).toHaveLength(catalog.counts.implemented - 1);
  expect(availability.groups.find((group) => group.names.includes('demangle_swift'))?.reason).toBe('target_required');
  expect(availability.groups.find((group) => group.names.includes('inspect_plist'))?.available).toBe(true);
  expect(payload.result.server_identity.catalog.counts.implemented_tools).toBe(catalog.counts.implemented);
  expect(payload.result.server_identity.catalog.digests.tools_sha256).toMatch(/^[a-f0-9]{64}$/);
});
