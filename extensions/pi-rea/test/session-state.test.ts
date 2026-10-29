import type { ExtensionAPI, SessionEntry, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import piRea from '../src/index.ts';
import { EVIDENCE_ENTRY, UNKNOWN_ENTRY } from '../src/session/branch-state.ts';
import { fixturePath } from './support/fixtures.ts';

interface Persisted {
  readonly customType: string;
  readonly data: unknown;
}

const branchEntries = (persisted: readonly Persisted[]): SessionEntry[] =>
  persisted.map(
    (entry, index) =>
      ({
        type: 'custom',
        id: `entry-${String(index)}`,
        timestamp: '2026-01-01T00:00:00.000Z',
        customType: entry.customType,
        data: entry.data,
      }) as unknown as SessionEntry,
  );

const load = (branch: readonly Persisted[]) => {
  const tools: ToolDefinition[] = [];
  const persisted: Persisted[] = [];
  const entries = branchEntries(branch);
  const api = {
    appendEntry: (customType: string, data?: unknown) => persisted.push({ customType, data }),
    registerTool: (tool: ToolDefinition) => tools.push(tool),
    registerCommand: () => {},
    on: (type: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      if (type === 'session_start') handler({}, { cwd: '/tmp', sessionManager: { getBranch: () => entries } });
      return () => {};
    },
  } as unknown as ExtensionAPI;
  piRea(api);
  return { tools, persisted };
};

const toolNamed = (tools: readonly ToolDefinition[], name: string): ToolDefinition => {
  const tool = tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`tool ${name} was not registered`);
  return tool;
};

interface ToolOutcome {
  readonly details?: unknown;
  readonly isError?: boolean;
  readonly structuredContent?: unknown;
}

const run = async (tool: ToolDefinition, params: unknown): Promise<ToolOutcome> => (await tool.execute('call-1', params as never, undefined, undefined, { cwd: '/tmp' } as never)) as ToolOutcome;

const draft = {
  question: 'Does the branch keep this unknown?',
  severity: 'low',
  domain: 'branch-state',
  required_authority: null,
  required_confidence: 'observed',
  required_environment: null,
  recommended_probes: [],
  relationships: [],
  supporting_evidence_ids: [],
  contradicting_evidence_ids: [],
};

const summaryOf = async (tools: readonly ToolDefinition[]): Promise<{ records: number; unknownRevisions: number }> => {
  const outcome = await run(toolNamed(tools, 'get_evidence_bundle'), { detail: 'summary' });
  const result = (outcome.structuredContent as { result: { total_retained_records: number; unknown_revisions: number } }).result;
  return { records: result.total_retained_records, unknownRevisions: result.unknown_revisions };
};

const openFixtureTarget = async (tools: readonly ToolDefinition[]): Promise<void> => {
  const outcome = await run(toolNamed(tools, 'open_binary'), { path: fixturePath('targets/minimal-elf.bin') });
  if (outcome.isError === true) throw new Error('the fixture target did not open');
};

test('N1: an Evidence-producing tool mirrors its record into details and a rea-evidence entry', async () => {
  const { tools, persisted } = load([]);
  await openFixtureTarget(tools);
  const outcome = await run(toolNamed(tools, 'inspect_plist'), { path: fixturePath('targets/plist/sample-xml.plist') });
  expect(outcome.isError).toBeUndefined();
  const details = outcome.details as { evidence: { evidence_id: string; operation: string } };
  expect(details.evidence.operation).toBe('inspect_plist');
  const mirrored = persisted.filter((entry) => entry.customType === EVIDENCE_ENTRY);
  expect(mirrored).toHaveLength(1);
  const mirror = mirrored[0];
  if (mirror === undefined) throw new Error('expected one rea-evidence entry');
  expect((mirror.data as { evidence_id: string }).evidence_id).toBe(details.evidence.evidence_id);
});

test('N1: an unknown mutation is mirrored into a rea-unknown entry', async () => {
  const { tools, persisted } = load([]);
  const outcome = await run(toolNamed(tools, 'record_unknown'), draft);
  expect(outcome.isError).toBeUndefined();
  const mirrored = persisted.filter((entry) => entry.customType === UNKNOWN_ENTRY);
  expect(mirrored).toHaveLength(1);
  const mirror = mirrored[0];
  if (mirror === undefined) throw new Error('expected one rea-unknown entry');
  const mutation = mirror.data as { action: string; draft: { question: string }; mutation_evidence_id: string };
  expect(mutation.action).toBe('record');
  expect(mutation.draft.question).toBe(draft.question);
  expect(mutation.mutation_evidence_id).toMatch(/^ev_[a-f0-9]{64}$/);
});

test('N1: session_start rebuilds both ledgers from the branch', async () => {
  const source = load([]);
  await openFixtureTarget(source.tools);
  await run(toolNamed(source.tools, 'inspect_plist'), { path: fixturePath('targets/plist/sample-xml.plist') });
  await run(toolNamed(source.tools, 'record_unknown'), draft);
  expect(source.persisted.map((entry) => entry.customType).toSorted()).toStrictEqual([EVIDENCE_ENTRY, EVIDENCE_ENTRY, UNKNOWN_ENTRY]);

  const forked = load(source.persisted);
  expect(await summaryOf(forked.tools)).toStrictEqual({ records: 2, unknownRevisions: 1 });
});

test('N1: a branch without the entries starts with an empty ledger', async () => {
  const empty = load([]);
  expect(await summaryOf(empty.tools)).toStrictEqual({ records: 0, unknownRevisions: 0 });
});

test('N1: entries of another custom type or with invalid data are ignored on restore', async () => {
  const branch: Persisted[] = [
    { customType: 'other-extension', data: { question: 'not mine' } },
    { customType: EVIDENCE_ENTRY, data: { evidence_id: 'not-an-evidence-record' } },
    { customType: UNKNOWN_ENTRY, data: { action: 'update', unknown_id: 'unk_missing', expected_revision: 1 } },
    { customType: UNKNOWN_ENTRY, data: { action: 'record' } },
  ];
  const restored = load(branch);
  expect(await summaryOf(restored.tools)).toStrictEqual({ records: 0, unknownRevisions: 0 });
});

test('N1: an unknown update is replayed after its record entry', async () => {
  const source = load([]);
  const recorded = await run(toolNamed(source.tools, 'record_unknown'), draft);
  const unknownId = (recorded.structuredContent as { result: { unknown_id: string } }).result.unknown_id;
  const updated = await run(toolNamed(source.tools, 'update_unknown'), {
    unknown_id: unknownId,
    expected_revision: 1,
    status: 'resolved',
    resolution: { disposition: 'out-of-scope', rationale: 'The branch keeps the revision history.', evidence_ids: [] },
  });
  expect(updated.isError).toBeUndefined();
  const forked = load(source.persisted);
  const listed = await run(toolNamed(forked.tools, 'list_unknowns'), {});
  const items = (listed.structuredContent as { result: { items: { revision: number; status: string }[] } }).result.items;
  expect(items).toHaveLength(1);
  expect(items[0]?.revision).toBe(2);
  expect(items[0]?.status).toBe('resolved');
});

test('N7: a tool called before session_start reports the missing session instead of guessing a cwd', async () => {
  const tools: ToolDefinition[] = [];
  const api = {
    appendEntry: () => {},
    registerTool: (tool: ToolDefinition) => tools.push(tool),
    registerCommand: () => {},
    on: () => () => {},
  } as unknown as ExtensionAPI;
  piRea(api);
  const outcome = await run(toolNamed(tools, 'binary_session'), {});
  expect(outcome.isError).toBe(true);
  const parsed = JSON.parse((outcome as unknown as { content: { text: string }[] }).content[0]?.text ?? '{}') as { error: { message: string } };
  expect(parsed.error.message).toContain('session_start');
});
