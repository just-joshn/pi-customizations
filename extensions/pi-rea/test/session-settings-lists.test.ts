import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectDevicetree } from '../src/tools/devicetree-tools.ts';
import { listBookmarks, listDocuments, listStrings } from '../src/tools/session-list-tools.ts';
import { openBinary } from '../src/tools/session-tools.ts';
import { inspectAnalysisSettings, updateAnalysisSettings } from '../src/tools/settings-tools.ts';
import { recordUnknown, updateUnknown, verifyUnknownResolution } from '../src/tools/unknown-tools.ts';
import { fixturePath } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const configOf = (result: { structuredContent?: unknown }): Record<string, unknown> => result.structuredContent as Record<string, unknown>;

const payloadOf = (result: { structuredContent?: unknown }): Record<string, unknown> => (result.structuredContent as { result: Record<string, unknown> }).result;

const draft = () => ({
  question: 'Is the setting store session-scoped?',
  severity: 'low' as const,
  domain: 'settings',
  required_authority: 'shipped-artifact' as const,
  required_confidence: 'observed' as const,
  required_environment: null,
  recommended_probes: [],
  relationships: [],
  supporting_evidence_ids: [],
  contradicting_evidence_ids: [],
});

const minimalDtb = (): Buffer => {
  const strings = Buffer.from('model\0board\0', 'ascii');
  const structParts: Buffer[] = [];
  // FDT_BEGIN_NODE ""
  const begin = Buffer.alloc(8);
  begin.writeUInt32BE(1, 0);
  begin.writeUInt32BE(0, 4);
  structParts.push(begin);
  // FDT_PROP length=6 nameoff=0 ("model") value="board\0" padded
  const propHeader = Buffer.alloc(8);
  propHeader.writeUInt32BE(3, 0);
  const value = Buffer.from('board\0\0\0', 'ascii');
  const prop = Buffer.alloc(4 + 8 + 8);
  prop.writeUInt32BE(3, 0);
  prop.writeUInt32BE(6, 4);
  prop.writeUInt32BE(0, 8);
  value.copy(prop, 12);
  structParts.push(prop.subarray(0, 12 + 8));
  // FDT_END_NODE
  const endNode = Buffer.alloc(4);
  endNode.writeUInt32BE(2, 0);
  structParts.push(endNode);
  // FDT_END
  const end = Buffer.alloc(4);
  end.writeUInt32BE(9, 0);
  structParts.push(end);
  const structure = Buffer.concat(structParts);

  const headerBytes = 40;
  const rsv = Buffer.alloc(16);
  const offMem = headerBytes;
  const offStruct = offMem + rsv.length;
  const offStrings = offStruct + structure.length;
  const totalsize = offStrings + strings.length;
  const header = Buffer.alloc(headerBytes);
  header.writeUInt32BE(0xd00dfeed, 0);
  header.writeUInt32BE(totalsize, 4);
  header.writeUInt32BE(offStruct, 8);
  header.writeUInt32BE(offStrings, 12);
  header.writeUInt32BE(offMem, 16);
  header.writeUInt32BE(17, 20);
  header.writeUInt32BE(16, 24);
  header.writeUInt32BE(0, 28);
  header.writeUInt32BE(strings.length, 32);
  header.writeUInt32BE(structure.length, 36);
  return Buffer.concat([header, rsv, structure, strings]);
};

test('inspect_analysis_settings: returns the published setting descriptors and constraints', () => {
  const report = configOf(inspectAnalysisSettings(new ReaSession(runtime), {}));
  expect(report['revision']).toBe(0);
  expect(report['scope']).toBe('rea-runtime');
  expect(report['active_values']).toStrictEqual({ status: 'not_observed' });
  const settings = report['settings'] as Record<string, unknown>[];
  expect(settings).toHaveLength(11);
  expect(settings[0]).toMatchObject({
    setting: 'asar.max_header_bytes',
    value: 16_777_216,
    launch_value: 16_777_216,
    default_value: 16_777_216,
    source: 'default',
    unit: 'bytes',
    agent_editable: true,
  });
  const constraints = report['constraints'] as Record<string, unknown>[];
  expect(constraints.map((entry) => entry['control'])).toStrictEqual(['REA_MCP_MAX_RESPONSE_BYTES', 'mcp.client_deadline', 'mcp.client_receive_buffer', 'node.parent_heap', 'json.maximum_depth']);
});

test('inspect_analysis_settings: filters intersect on setting id', () => {
  const report = configOf(inspectAnalysisSettings(new ReaSession(runtime), { settings: ['wasm.command_timeout_ms'] }));
  expect(report['settings']).toHaveLength(1);
  expect((report['settings'] as Record<string, unknown>[])[0]?.['setting']).toBe('wasm.command_timeout_ms');
  expect(report['constraints']).toBeDefined();
});

test('update_analysis_settings: sets, reports change, and resets to launch', () => {
  const session = new ReaSession(runtime);
  const updated = configOf(
    updateAnalysisSettings(session, {
      changes: [{ setting: 'asar.max_header_bytes', action: 'set', value: 33_554_432 }],
    }),
  );
  expect(updated['changed']).toBe(true);
  expect(updated['revision']).toBe(1);
  expect(updated['changes']).toStrictEqual([{ setting: 'asar.max_header_bytes', old_value: 16_777_216, new_value: 33_554_432 }]);
  expect(updated['active_work_changed']).toBe(false);
  expect(updated['rea_restart_required']).toBe(false);
  expect(updated['constraints']).toBeUndefined();
  expect((updated['settings'] as Record<string, unknown>[])[0]).toMatchObject({
    value: 33_554_432,
    launch_value: 16_777_216,
    source: 'runtime',
  });

  const reset = configOf(
    updateAnalysisSettings(session, {
      changes: [{ setting: 'asar.max_header_bytes', action: 'reset' }],
      expected_revision: 1,
    }),
  );
  expect(reset['revision']).toBe(2);
  expect((reset['settings'] as Record<string, unknown>[])[0]).toMatchObject({ value: 16_777_216, source: 'default' });
});

test('update_analysis_settings: a stale expected_revision fails closed', () => {
  let thrown: unknown;
  try {
    updateAnalysisSettings(new ReaSession(runtime), {
      changes: [{ setting: 'regex.matching_deadline_ms', action: 'set', value: 1000 }],
      expected_revision: 99,
    });
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ReaError);
  expect((thrown as ReaError).payload.code).toBe('invalid_request');
  expect((thrown as ReaError).payload.message).toContain('Settings revision conflict');
});

test('update_analysis_settings: survives close_binary', async () => {
  const session = new ReaSession(runtime);
  updateAnalysisSettings(session, { changes: [{ setting: 'javascript.max_heap_mb', action: 'set', value: 512 }] });
  await openBinary(session, { path: fixturePath('targets/minimal-elf.bin') });
  session.closeTarget();
  const report = configOf(inspectAnalysisSettings(session, { settings: ['javascript.max_heap_mb'] }));
  expect(report['revision']).toBe(1);
  expect((report['settings'] as Record<string, unknown>[])[0]?.['value']).toBe(512);
});

test('verify_unknown_resolution: missing id fails as not-found', () => {
  let thrown: unknown;
  try {
    verifyUnknownResolution(new ReaSession(runtime), { unknown_id: `unk_${'0'.repeat(64)}` });
  } catch (error) {
    thrown = error;
  }
  expect((thrown as ReaError).payload.code).toBe('execution_failure');
  expect((thrown as ReaError).payload.details).toMatchObject({ reason: 'not-found' });
});

test('verify_unknown_resolution: open unknowns are not truth-verified', () => {
  const session = new ReaSession(runtime);
  const recorded = payloadOf(recordUnknown(session, draft()));
  const verified = payloadOf(verifyUnknownResolution(session, { unknown_id: recorded['unknown_id'] as string }));
  expect(verified).toMatchObject({ valid: false, truthVerified: false });
  expect(verified['unknown']).toMatchObject({ unknown_id: recorded['unknown_id'], status: 'open' });
});

test('verify_unknown_resolution: a verified resolution reports truthVerified', () => {
  const session = new ReaSession(runtime);
  const recorded = payloadOf(recordUnknown(session, draft()));
  const mutationId = (recorded['mutation_evidence_ids'] as string[])[0]!;
  const updated = payloadOf(
    updateUnknown(session, {
      unknown_id: recorded['unknown_id'] as string,
      expected_revision: 1,
      status: 'resolved',
      resolution: { disposition: 'verified', rationale: 'Evidence retained.', evidence_ids: [mutationId] },
    }),
  );
  const verified = payloadOf(verifyUnknownResolution(session, { unknown_id: updated['unknown_id'] as string }));
  expect(verified).toMatchObject({ valid: true, truthVerified: true });
});

test('list_bookmarks: no open target matches REA target_unavailable', () => {
  let thrown: unknown;
  try {
    listBookmarks(new ReaSession(runtime), {});
  } catch (error) {
    thrown = error;
  }
  expect((thrown as ReaError).payload.code).toBe('target_unavailable');
  expect((thrown as ReaError).payload.message).toContain('No app is open');
});

test('list_documents/list_strings: open target without a provider fails closed', async () => {
  const session = new ReaSession(runtime);
  await openBinary(session, { path: fixturePath('targets/minimal-elf.bin') });
  for (const call of [() => listDocuments(session, {}), () => listStrings(session, {})]) {
    let thrown: unknown;
    try {
      call();
    } catch (error) {
      thrown = error;
    }
    expect((thrown as ReaError).payload.code).toBe('provider_unavailable');
    expect((thrown as ReaError).payload.category).toBe('unavailable');
    expect((thrown as ReaError).payload.retryable).toBe(true);
    expect((thrown as ReaError).payload.details).toMatchObject({
      selection_reason: 'provider_unavailable',
      requested_provider_id: 'auto',
      candidate_ids: ['ghidra', 'hopper', 'ida', 'kuna'],
    });
  }
});

test('inspect_devicetree: decodes a minimal FDT blob', async ({ onTestFinished }) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-dtb-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'board.dtb');
  await writeFile(path, minimalDtb());
  const session = new ReaSession(runtime);
  const result = await inspectDevicetree(session, { path });
  const record = result.structuredContent as { normalized_result: Record<string, unknown>; operation: string };
  expect(record.operation).toBe('inspect_devicetree');
  expect(record.normalized_result['summary']).toMatchObject({ model: 'board', confidence: 'derived' });
  expect((record.normalized_result['coverage'] as { examined_nodes: number }).examined_nodes).toBe(1);
  expect(session.evidence.size).toBe(1);
});

test('inspect_devicetree: refuses a relative path', async () => {
  await expect(inspectDevicetree(new ReaSession(runtime), { path: 'board.dtb' })).rejects.toThrowError(/absolute filesystem path/);
});

test('inspect_devicetree: refuses non-DTB bytes', async ({ onTestFinished }) => {
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-not-dtb-'));
  onTestFinished(async () => rm(dir, { recursive: true, force: true }));
  const path = join(dir, 'note.bin');
  await writeFile(path, Buffer.from('not a dtb'));
  await expect(inspectDevicetree(new ReaSession(runtime), { path })).rejects.toThrowError(/Truncated FDT header|flattened devicetree/);
});
