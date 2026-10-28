import type { ExtensionAPI, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { loadCatalog } from '../src/contract/catalog.ts';
import piRea, { statusLines } from '../src/index.ts';
import { fixturePath } from './support/fixtures.ts';

interface Registration {
  readonly tools: ToolDefinition[];
  readonly commands: { name: string; description: string; handler: (args: string, ctx: unknown) => Promise<void> }[];
  readonly events: { type: string; handler: (event: unknown, ctx: unknown) => unknown }[];
}

const loadExtension = (): Registration => {
  const tools: ToolDefinition[] = [];
  const commands: { name: string; description: string; handler: (args: string, ctx: unknown) => Promise<void> }[] = [];
  const events: { type: string; handler: (event: unknown, ctx: unknown) => unknown }[] = [];
  const api = {
    registerTool: (tool: ToolDefinition) => tools.push(tool),
    registerCommand: (name: string, options: { description?: string; handler: (args: string, ctx: unknown) => Promise<void> }) => commands.push({ name, description: options.description ?? '', handler: options.handler }),
    on: (type: string, handler: (event: unknown, ctx: unknown) => unknown) => {
      events.push({ type, handler });
      return () => {};
    },
  } as unknown as ExtensionAPI;
  piRea(api);
  return { tools, commands, events };
};

const toolNamed = (registration: Registration, name: string): ToolDefinition => {
  const tool = registration.tools.find((candidate) => candidate.name === name);
  if (tool === undefined) throw new Error(`tool ${name} was not registered`);
  return tool;
};

const run = async (tool: ToolDefinition, params: unknown): Promise<{ content: { text?: string }[]; isError?: boolean; structuredContent?: unknown }> =>
  (await tool.execute('call-1', params as never, undefined, undefined, {} as never)) as {
    content: { text?: string }[];
    isError?: boolean;
    structuredContent?: unknown;
  };

test('KERN-014: every advertised tool is registered exactly once with its published contract', () => {
  const registration = loadExtension();
  const catalog = loadCatalog();
  expect(registration.tools).toHaveLength(catalog.tools.length);
  expect(registration.tools.map((tool) => tool.name).toSorted()).toStrictEqual(catalog.tools.map((tool) => tool.name).toSorted());
  for (const contract of catalog.tools) {
    const tool = toolNamed(registration, contract.name);
    expect(tool.description).toBe(contract.description);
    expect(tool.parameters).toStrictEqual(contract.parameters);
    expect(tool.outputSchema).toBeUndefined();
  }
});

test("KERN-015: annotation flags reach Pi's registry unchanged", () => {
  const registration = loadExtension();
  for (const contract of loadCatalog().tools) {
    expect(toolNamed(registration, contract.name).annotations).toStrictEqual(contract.annotations);
  }
  const readOnly = toolNamed(registration, 'binary_session').annotations;
  expect(readOnly).toStrictEqual({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });
  const destructive = toolNamed(registration, 'close_binary').annotations;
  expect(destructive).toStrictEqual({ readOnlyHint: false, destructiveHint: true, idempotentHint: false, openWorldHint: false });
});

test('KERN-016: implemented tools are declared and the rest cost no prompt space', () => {
  const registration = loadExtension();
  for (const tool of registration.tools) {
    expect(tool.exposure).toBe(tool.name === 'binary_session' || loadCatalog().tools.find((contract) => contract.name === tool.name)?.implementation === 'kernel' ? 'direct' : 'deferred');
  }
  expect(registration.tools.filter((tool) => tool.exposure === 'direct')).toHaveLength(229);
});

test('KERN-016: the discovery tool carries the routing guideline', () => {
  const registration = loadExtension();
  expect(toolNamed(registration, 'binary_session').promptGuidelines).toHaveLength(1);
  expect(toolNamed(registration, 'binary_session').promptGuidelines?.[0]).toContain('tool_search');
  expect(toolNamed(registration, 'open_binary').promptGuidelines).toBeUndefined();
});

test('KERN-016: shared session state runs sequentially and declares the rea namespace', () => {
  const registration = loadExtension();
  for (const tool of registration.tools) {
    expect(tool.executionMode).toBe('sequential');
    expect(tool.namespace?.name).toBe('rea');
    expect(tool.namespace?.aliases).toContain('pi-rea');
    expect(tool.namespace?.instructions).toContain('binary_session');
  }
});

test('KERN-017: formerly unavailable tools fail closed with measured refuse vocabulary', async () => {
  const registration = loadExtension();
  for (const name of ['capture_process_scenario', 'inspect_wasm_artifact', 'inspect_pcap_capture']) {
    const result = await run(toolNamed(registration, name), {});
    expect(result.isError).toBe(true);
    expect(result.structuredContent).toBeUndefined();
    const payload = JSON.parse(result.content[0]?.text ?? '{}') as { error: { code: string; category: string; details: { operation: string } } };
    expect(payload.error.code).toBe('capability_unavailable');
    expect(payload.error.category).toBe('unsupported_provider');
    expect(payload.error.details.operation).toBe(name);
  }
  const dylibClosed = await run(toolNamed(registration, 'trace_dylib_resolution'), {});
  expect(dylibClosed.isError).toBe(true);
  const dylibPayload = JSON.parse(dylibClosed.content[0]?.text ?? '{}') as { error: { code: string } };
  expect(dylibPayload.error.code).toBe('target_unavailable');
});

test('KERN-017: official-proxy refuse tools match REA target/provider unavailable vocabulary', async () => {
  const registration = loadExtension();
  const closed = await run(toolNamed(registration, 'current_address'), {});
  expect(closed.isError).toBe(true);
  const closedPayload = JSON.parse(closed.content[0]?.text ?? '{}') as { error: { code: string } };
  expect(closedPayload.error.code).toBe('target_unavailable');

  const opened = await run(toolNamed(registration, 'open_binary'), { path: fixturePath('targets/minimal-elf.bin') });
  expect(opened.isError).toBeUndefined();
  const listed = await run(toolNamed(registration, 'current_address'), {});
  expect(listed.isError).toBe(true);
  const payload = JSON.parse(listed.content[0]?.text ?? '{}') as {
    error: { code: string; category: string; retryable: boolean; details: { selection_reason: string; candidate_ids: string[] } };
  };
  expect(payload.error.code).toBe('provider_unavailable');
  expect(payload.error.category).toBe('unavailable');
  expect(payload.error.retryable).toBe(true);
  expect(payload.error.details).toMatchObject({
    selection_reason: 'provider_unavailable',
    candidate_ids: ['ghidra', 'hopper', 'ida', 'kuna'],
  });
});

test('KERN-017: an implemented tool runs the kernel through the registered handler', async () => {
  const registration = loadExtension();
  const result = await run(toolNamed(registration, 'binary_session'), {});
  expect(result.isError).toBeUndefined();
  expect((result.structuredContent as { result: { open: boolean } }).result.open).toBe(false);
});

test('KERN-017: an implemented tool that fails reports the canonical error result', async () => {
  const registration = loadExtension();
  const result = await run(toolNamed(registration, 'open_binary'), { path: fixturePath('targets/note.txt') });
  expect(result.isError).toBe(true);
  const payload = JSON.parse(result.content[0]?.text ?? '{}') as { error: { code: string } };
  expect(payload.error.code).toBe('target_unavailable');
});

test('KERN-017: a cancelled call reports cancelled and runs nothing', async () => {
  const registration = loadExtension();
  const controller = new AbortController();
  controller.abort();
  const tool = toolNamed(registration, 'open_binary');
  const result = (await tool.execute('call-cancelled', { path: fixturePath('targets/minimal-elf.bin') } as never, controller.signal, undefined, {} as never)) as { content: { text?: string }[]; isError?: boolean };
  expect(result.isError).toBe(true);
  const payload = JSON.parse(result.content[0]?.text ?? '{}') as { error: { code: string } };
  expect(payload.error.code).toBe('cancelled');
});

test('KERN-017: the reported tool state never contradicts the catalog', async () => {
  const registration = loadExtension();
  const report = JSON.parse((await run(toolNamed(registration, 'binary_session'), {})).content[0]?.text ?? '{}') as {
    result: { tool_availability: { name: string; available: boolean }[] };
  };
  const catalog = loadCatalog();
  for (const contract of catalog.tools) {
    const entry = report.result.tool_availability.find((candidate) => candidate.name === contract.name);
    expect(entry).toBeDefined();
    expect(entry?.available).toBe(contract.implementation === 'kernel');
  }
});

test('KERN-017: the session factory and command surface are registered', () => {
  const registration = loadExtension();
  expect(registration.commands.map((command) => command.name)).toStrictEqual(['rea']);
  expect(registration.events.map((event) => event.type).toSorted()).toStrictEqual(['session_shutdown', 'session_start']);
});

test('KERN-017: /rea status reports availability, target and retained counts', async () => {
  const registration = loadExtension();
  const start = registration.events.find((event) => event.type === 'session_start');
  const handler = start?.handler as ((event: unknown, ctx: unknown) => void) | undefined;
  handler?.({}, { cwd: '/tmp' });
  const lines = statusLines({
    report: () => ({
      tool_availability: [
        { name: 'binary_session', available: true },
        { name: 'analyze_function', available: false },
      ],
    }),
    target: { identity: { path: '/tmp/x', format: 'elf', architecture: 'x86_64' } },
    evidence: { size: 3 },
    unknowns: { revisionCount: 2 },
  } as never);
  expect(lines[0]).toContain('1/2 tools available');
  expect(lines[1]).toContain('/tmp/x (elf, x86_64)');
  expect(lines[2]).toContain('Evidence records: 3');
});

test('KERN-017: every implemented tool runs through the registered handler', async () => {
  const registration = loadExtension();
  const cases: { name: string; params?: unknown }[] = [
    { name: 'binary_session', params: {} },
    { name: 'get_evidence_bundle', params: { detail: 'summary' } },
    { name: 'list_unknowns', params: {} },
    {
      name: 'record_unknown',
      params: {
        question: 'Is the handler switch covered?',
        severity: 'low',
        domain: 'coverage',
        required_authority: null,
        required_confidence: 'observed',
        required_environment: null,
        recommended_probes: [],
        relationships: [],
        supporting_evidence_ids: [],
        contradicting_evidence_ids: [],
      },
    },
    { name: 'close_binary', params: {} },
  ];
  for (const item of cases) {
    const result = await run(toolNamed(registration, item.name), item.params ?? {});
    expect(result.isError, item.name).toBeUndefined();
    expect(result.structuredContent, item.name).toBeDefined();
  }
});

test('KERN-017: a handler failure surfaces the canonical envelope through the registry', async () => {
  const registration = loadExtension();
  const result = await run(toolNamed(registration, 'inspect_analysis_view'), {
    source: { kind: 'retained-evidence', evidence_id: `ev_${'0'.repeat(64)}` },
    view: { kind: 'summary' },
  });
  expect(result.isError).toBe(true);
  const payload = JSON.parse(result.content[0]?.text ?? '{}') as { error: { code: string } };
  expect(payload.error.code).toBe('evidence_integrity_mismatch');
});

test('KERN-032: session_start rebuilds the session and session_shutdown clears it', async () => {
  const registration = loadExtension();
  const start = registration.events.find((event) => event.type === 'session_start');
  const shutdown = registration.events.find((event) => event.type === 'session_shutdown');
  expect(typeof start?.handler).toBe('function');
  expect(typeof shutdown?.handler).toBe('function');

  await start?.handler({}, { cwd: '/tmp' });
  const before = JSON.parse((await run(toolNamed(registration, 'binary_session'), {})).content[0]?.text ?? '{}') as {
    result: { open: boolean };
  };
  expect(before.result.open).toBe(false);
  const record = await run(toolNamed(registration, 'record_unknown'), {
    question: 'Does reload clear this?',
    severity: 'low',
    domain: 'lifecycle',
    required_authority: null,
    required_confidence: 'observed',
    required_environment: null,
    recommended_probes: [],
    relationships: [],
  });
  expect(record.isError).toBeUndefined();
  const listed = JSON.parse((await run(toolNamed(registration, 'list_unknowns'), {})).content[0]?.text ?? '{}') as {
    result: { total: number };
  };
  expect(listed.result.total).toBe(1);

  await start?.handler({}, { cwd: '/tmp' });
  const afterStart = JSON.parse((await run(toolNamed(registration, 'list_unknowns'), {})).content[0]?.text ?? '{}') as {
    result: { total: number };
  };
  expect(afterStart.result.total).toBe(0);
  expect(() => shutdown?.handler({}, {})).not.toThrow();
});

test('KERN-032: /rea notifies with the session status', async () => {
  const registration = loadExtension();
  const notifications: string[] = [];
  const command = registration.commands[0];
  expect(command?.name).toBe('rea');
  await command?.handler('', { ui: { notify: (text: string) => notifications.push(text) } });
  expect(notifications).toHaveLength(1);
  expect(notifications[0]).toContain('tools available');
  expect(notifications[0]).toContain('No open target.');
});
