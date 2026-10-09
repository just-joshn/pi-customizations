import { existsSync } from 'node:fs';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { type ExtensionAPI, type ExtensionToolContext, SessionManager } from '@earendil-works/pi-coding-agent';
import { Check } from 'typebox/value';
import { expect, onTestFinished, test, vi } from 'vitest';
import { AUTOMATIONS_EDITOR_CHROME } from '../src/automations-editor.ts';
import { registerAutomations } from '../src/automations.ts';
import { AutomationPrepareOutput, AutomationSaveOutput } from '../src/automation-output-schemas.ts';
import { model } from './session-fixture.ts';

const bennyDraft = {
  name: 'benny-triage',
  description: 'Slack triage draft',
  instructions: 'Triage top-level Slack messages for the authorized channel.',
  operationalPath: '.pi/automations/benny',
  trigger: { type: 'slack.top_level' as const, channelId: 'C0123456789' },
  tools: ['slack.thread.read', 'slack.thread.reply', 'tracker'],
};

async function fixture(options?: { editorDisposition?: 'saved' | 'cancelled'; editedInstructions?: string }) {
  const root = await mkdtemp(join(tmpdir(), 'pstack-automation-tools-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  vi.stubEnv('PI_CODING_AGENT_DIR', root);
  onTestFinished(() => {
    vi.unstubAllEnvs();
  });
  const definitions: Parameters<ExtensionAPI['registerTool']>[0][] = [];
  registerAutomations({ registerTool: (tool: Parameters<ExtensionAPI['registerTool']>[0]) => definitions.push(tool) } as unknown as ExtensionAPI);
  const disposition = options?.editorDisposition ?? 'saved';
  const custom = vi.fn().mockResolvedValue(
    disposition === 'cancelled'
      ? { disposition: 'cancelled' as const }
      : {
          disposition: 'saved' as const,
          definition: {
            name: bennyDraft.name,
            description: bennyDraft.description,
            instructions: options?.editedInstructions ?? bennyDraft.instructions,
            operationalPath: bennyDraft.operationalPath,
            trigger: bennyDraft.trigger,
            tools: bennyDraft.tools,
          },
        },
  );
  const confirm = vi.fn().mockResolvedValue(true);
  const ctx = {
    cwd: root,
    model,
    hasUI: true,
    mode: 'tui',
    ui: { custom, confirm },
    sessionManager: SessionManager.inMemory(root),
  } as unknown as ExtensionToolContext;
  const invoke = (name: string, input: Record<string, unknown>, context = ctx, signal?: AbortSignal) => {
    const tool = definitions.find((item) => item.name === name);
    if (!tool) throw new Error(`Missing tool ${name}`);
    return tool.execute('test', input, signal, undefined, context).then((output) => {
      expect(output.structuredContent).toEqual(JSON.parse(JSON.stringify(output.details)));
      if (!tool.outputSchema) throw new Error(`Missing output schema for ${name}`);
      expect(Check(tool.outputSchema, output.structuredContent)).toBe(true);
      return output;
    });
  };
  return { root, ctx, custom, confirm, invoke, definitions };
}

test('prepare and OpenEditor keep benny-triage disabled without ingress', async () => {
  const f = await fixture();
  const prepared = (await f.invoke('AutomationPrepare', bennyDraft)).details as {
    automationId: string;
    revision: string;
    kind: string;
    directory: string;
    name: string;
  };
  expect(prepared).toMatchObject({ name: 'benny-triage', kind: 'disabled' });
  expect(Check(AutomationPrepareOutput, prepared)).toBe(true);
  expect(existsSync(join(prepared.directory, 'definition.json'))).toBe(true);
  expect(existsSync(join(prepared.directory, 'status.json'))).toBe(false);

  const opened = (await f.invoke('AutomationOpenEditor', { automationId: prepared.automationId })).details as {
    opened: boolean;
    kind: string;
    name: string;
    chrome?: string;
    definition?: { instructions: string; revision: string };
  };
  expect(opened).toMatchObject({
    opened: true,
    kind: 'disabled',
    name: 'benny-triage',
    chrome: AUTOMATIONS_EDITOR_CHROME,
  });
  expect(opened.definition?.instructions).toBe(bennyDraft.instructions);
  expect(opened.definition?.revision).toBe(prepared.revision);
  expect(f.custom).toHaveBeenCalledOnce();
  expect(existsSync(join(prepared.directory, 'status.json'))).toBe(false);
});

test('save and inspect keep benny-triage disabled without ingress', async () => {
  const f = await fixture();
  const prepared = (await f.invoke('AutomationPrepare', bennyDraft)).details as {
    automationId: string;
    revision: string;
    directory: string;
  };
  const saved = (
    await f.invoke('AutomationSave', { ...bennyDraft, automationId: prepared.automationId, revision: prepared.revision })
  ).details as { kind: string; revision: string; automationId: string; directory: string };
  expect(Check(AutomationSaveOutput, saved)).toBe(true);
  expect(saved).toMatchObject({ kind: 'disabled', automationId: prepared.automationId, revision: prepared.revision });
  expect(existsSync(join(saved.directory, 'status.json'))).toBe(false);
  expect(await readdir(join(f.root, 'pstack-automations'))).toHaveLength(1);
  const definition = JSON.parse(await readFile(join(saved.directory, 'definition.json'), 'utf8')) as {
    name: string;
    revision: string;
  };
  expect(definition).toMatchObject({ name: 'benny-triage', revision: prepared.revision });
  const inspected = (await f.invoke('AutomationInspect', { automationId: prepared.automationId })).details;
  expect(inspected).toMatchObject({ kind: 'disabled', name: 'benny-triage', automationId: prepared.automationId });
});

test('OpenEditor Save persists edited instructions through the AutomationSave path', async () => {
  const f = await fixture({ editedInstructions: 'Edited via Automations editor chrome.' });
  const prepared = (await f.invoke('AutomationPrepare', bennyDraft)).details as { automationId: string; revision: string; directory: string };
  const opened = (await f.invoke('AutomationOpenEditor', { automationId: prepared.automationId })).details as {
    opened: boolean;
    kind: string;
    definition?: { instructions: string; revision: string };
  };
  expect(opened).toMatchObject({ opened: true, kind: 'disabled' });
  expect(opened.definition?.instructions).toBe('Edited via Automations editor chrome.');
  expect(opened.definition?.revision).not.toBe(prepared.revision);
  const stored = JSON.parse(await readFile(join(prepared.directory, 'definition.json'), 'utf8')) as {
    instructions: string;
    revision: string;
  };
  expect(stored.instructions).toBe('Edited via Automations editor chrome.');
  expect(existsSync(join(prepared.directory, 'status.json'))).toBe(false);
});

test('AutomationEnable refuses without thread-safety receipt', async () => {
  const f = await fixture();
  const draft = (await f.invoke('AutomationPrepare', bennyDraft)).details as { automationId: string; revision: string };
  const refused = (await f.invoke('AutomationEnable', draft)).details as {
    enabled: boolean;
    refused: boolean;
    reason: string;
    revision: string;
  };
  expect(refused).toEqual({
    enabled: false,
    refused: true,
    reason: 'Thread-safety receipt missing or revision mismatch. Creation boundary forbids enable before the seven checks.',
    revision: draft.revision,
  });
  expect(existsSync(join(f.root, 'pstack-automations'))).toBe(true);
  const inspected = (await f.invoke('AutomationInspect', { automationId: draft.automationId })).details;
  expect(inspected).toMatchObject({ kind: 'disabled' });
});

const sevenPassing = {
  triageStoresThreadTsAndOneReply: true,
  verdictContainsConfiguredMarker: true,
  reproAcceptsMarkerFromTriageIdentity: true,
  reproKeepsImmutableSourceCoordinates: true,
  noSourceChannelRootMessage: true,
  delegatedWorkerCannotSlackWrite: true,
  missingCoordsOrFailedPreflightProducesNoPost: true,
} as const;

test('AutomationRecordThreadSafety writes receipt for the exact revision', async () => {
  const f = await fixture();
  const draft = (await f.invoke('AutomationPrepare', bennyDraft)).details as {
    automationId: string;
    revision: string;
    directory: string;
  };
  const recorded = (
    await f.invoke('AutomationRecordThreadSafety', {
      automationId: draft.automationId,
      revision: draft.revision,
      checks: sevenPassing,
    })
  ).details as { recorded: boolean; revision: string; checks: typeof sevenPassing };
  expect(recorded).toEqual({
    recorded: true,
    revision: draft.revision,
    checks: sevenPassing,
  });
  const receipt = JSON.parse(await readFile(join(draft.directory, 'thread-safety.json'), 'utf8')) as {
    revision: string;
    checks: typeof sevenPassing;
  };
  expect(receipt.revision).toBe(draft.revision);
  expect(receipt.checks).toEqual(sevenPassing);
  const enabled = (await f.invoke('AutomationEnable', draft)).details as {
    enabled: boolean;
    refused: boolean;
    revision: string;
    kind?: string;
    automationId?: string;
  };
  expect(enabled).toMatchObject({
    enabled: true,
    refused: false,
    revision: draft.revision,
    kind: 'enabled',
    automationId: draft.automationId,
  });
  expect(f.confirm).toHaveBeenCalledOnce();
  expect(existsSync(join(draft.directory, 'status.json'))).toBe(true);
  const inspected = (await f.invoke('AutomationInspect', { automationId: draft.automationId })).details;
  expect(inspected).toMatchObject({ kind: 'enabled', revision: draft.revision });
});

test('AutomationEnable refuses when operator declines confirm despite receipt', async () => {
  const f = await fixture();
  f.confirm.mockResolvedValueOnce(false);
  const draft = (await f.invoke('AutomationPrepare', bennyDraft)).details as {
    automationId: string;
    revision: string;
    directory: string;
  };
  await f.invoke('AutomationRecordThreadSafety', {
    automationId: draft.automationId,
    revision: draft.revision,
    checks: sevenPassing,
  });
  const declined = (await f.invoke('AutomationEnable', draft)).details as {
    enabled: boolean;
    refused: boolean;
    revision: string;
  };
  expect(declined).toEqual({ enabled: false, refused: false, revision: draft.revision });
  expect(existsSync(join(draft.directory, 'status.json'))).toBe(false);
});

test('AutomationDisable clears enabled status and leaves the draft disabled', async () => {
  const f = await fixture();
  const draft = (await f.invoke('AutomationPrepare', bennyDraft)).details as {
    automationId: string;
    revision: string;
    directory: string;
  };
  await f.invoke('AutomationRecordThreadSafety', {
    automationId: draft.automationId,
    revision: draft.revision,
    checks: sevenPassing,
  });
  await f.invoke('AutomationEnable', draft);
  expect(existsSync(join(draft.directory, 'status.json'))).toBe(true);
  const disabled = (await f.invoke('AutomationDisable', { automationId: draft.automationId })).details as {
    kind: string;
    revision: string;
    automationId: string;
  };
  expect(disabled).toMatchObject({ kind: 'disabled', revision: draft.revision, automationId: draft.automationId });
  expect(existsSync(join(draft.directory, 'status.json'))).toBe(false);
  expect(existsSync(join(draft.directory, 'thread-safety.json'))).toBe(true);
  const again = (await f.invoke('AutomationDisable', { automationId: draft.automationId })).details;
  expect(again).toMatchObject({ kind: 'disabled', revision: draft.revision });
});

test('AutomationRecordThreadSafety rejects incomplete checks and stale revision', async () => {
  const f = await fixture();
  const draft = (await f.invoke('AutomationPrepare', bennyDraft)).details as { automationId: string; revision: string };
  await expect(
    f.invoke('AutomationRecordThreadSafety', {
      automationId: draft.automationId,
      revision: draft.revision,
      checks: { ...sevenPassing, noSourceChannelRootMessage: false },
    }),
  ).rejects.toThrow(/seven checks/i);
  await expect(
    f.invoke('AutomationRecordThreadSafety', {
      automationId: draft.automationId,
      revision: 'a'.repeat(64),
      checks: sevenPassing,
    }),
  ).rejects.toThrow(/revision/i);
});

test('editor cancellation leaves the draft disabled and unsaved from the editor pass', async () => {
  const f = await fixture({ editorDisposition: 'cancelled' });
  const draft = (await f.invoke('AutomationPrepare', bennyDraft)).details as { automationId: string; revision: string; directory: string };
  const before = await readFile(join(draft.directory, 'definition.json'), 'utf8');
  const opened = (await f.invoke('AutomationOpenEditor', { automationId: draft.automationId })).details;
  expect(opened).toEqual({
    opened: false,
    automationId: draft.automationId,
    revision: draft.revision,
    kind: 'disabled',
    name: 'benny-triage',
    chrome: AUTOMATIONS_EDITOR_CHROME,
  });
  expect(await readFile(join(draft.directory, 'definition.json'), 'utf8')).toBe(before);
  expect(existsSync(join(draft.directory, 'status.json'))).toBe(false);
});

test('automation contracts restrict enable to model-only and keep drafts sequential', async () => {
  const f = await fixture();
  for (const tool of f.definitions) {
    expect(tool.outputSchema).toBeDefined();
    expect(tool.executionMode).toBe('sequential');
    expect(tool.exposure).toBe(tool.name === 'AutomationEnable' ? 'model-only' : 'direct');
    expect(tool.namespace?.name).toBe('pstack_automations');
  }
});

test('invalid automation identities cannot read outside the owning session', async () => {
  const f = await fixture();
  await expect(f.invoke('AutomationInspect', { automationId: '../outside' })).rejects.toThrow('Invalid automation ID');
});

test('OpenEditor without UI fails closed', async () => {
  const f = await fixture();
  const draft = (await f.invoke('AutomationPrepare', bennyDraft)).details as { automationId: string };
  await expect(f.invoke('AutomationOpenEditor', draft, { ...f.ctx, hasUI: false })).rejects.toThrow('interactive UI');
});

test('OpenEditor outside TUI fails closed', async () => {
  const f = await fixture();
  const draft = (await f.invoke('AutomationPrepare', bennyDraft)).details as { automationId: string };
  await expect(f.invoke('AutomationOpenEditor', draft, { ...f.ctx, mode: 'rpc' })).rejects.toThrow('Pi TUI');
});

test('Save rejects a stale revision', async () => {
  const f = await fixture();
  const draft = (await f.invoke('AutomationPrepare', bennyDraft)).details as { automationId: string; revision: string };
  await expect(
    f.invoke('AutomationSave', { ...bennyDraft, automationId: draft.automationId, revision: 'a'.repeat(64) }),
  ).rejects.toThrow('revision');
});
