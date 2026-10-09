import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';

import { type ExtensionAPI, type ExtensionContext, getAgentDir } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import {
  disableAutomation,
  enableAutomation,
  inspectAutomation,
  prepareAutomation,
  recordThreadSafety,
  saveAutomation,
  threadSafetyReceipt,
} from '../scripts/automation-client.mjs';
import { AutomationSchema } from './automation-domain.ts';
import {
  AUTOMATIONS_EDITOR_CHROME,
  type AutomationsEditorDraft,
  type AutomationsEditorInput,
  automationsEditorResult,
  initialAutomationsEditorState,
  reduceAutomationsEditor,
  renderAutomationsEditor,
  toAutomationsEditorInput,
} from './automations-editor.ts';
import {
  AutomationDisableOutput,
  AutomationEnableOutput,
  AutomationInspectOutput,
  AutomationOpenEditorOutput,
  AutomationPrepareOutput,
  AutomationRecordThreadSafetyOutput,
  AutomationSaveOutput,
} from './automation-output-schemas.ts';
import { dataResult as result } from './results.ts';

const Identity = {
  automationId: Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' }),
};

const SaveParameters = Type.Intersect([
  Type.Object({
    ...Identity,
    revision: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  }),
  AutomationSchema,
]);

const EnableParameters = Type.Object({
  ...Identity,
  revision: Type.String({ pattern: '^[a-f0-9]{64}$' }),
});

const SevenCheckParameters = Type.Object({
  triageStoresThreadTsAndOneReply: Type.Boolean(),
  verdictContainsConfiguredMarker: Type.Boolean(),
  reproAcceptsMarkerFromTriageIdentity: Type.Boolean(),
  reproKeepsImmutableSourceCoordinates: Type.Boolean(),
  noSourceChannelRootMessage: Type.Boolean(),
  delegatedWorkerCannotSlackWrite: Type.Boolean(),
  missingCoordsOrFailedPreflightProducesNoPost: Type.Boolean(),
});

const RecordThreadSafetyParameters = Type.Object({
  ...Identity,
  revision: Type.String({ pattern: '^[a-f0-9]{64}$' }),
  checks: SevenCheckParameters,
});

function root(ctx: ExtensionContext) {
  const owner = createHash('sha256').update(`${ctx.cwd}\0${ctx.sessionManager.getSessionId()}`).digest('hex');
  return join(getAgentDir(), 'pstack-automations', owner);
}

function directory(ctx: ExtensionContext, automationId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(automationId)) {
    throw new Error('Invalid automation ID.');
  }
  return join(root(ctx), automationId);
}

function toEditorDraft(draft: {
  name: string;
  description: string;
  instructions: string;
  operationalPath?: string;
  trigger: AutomationsEditorDraft['trigger'];
  tools: string[];
  revision: string;
}): AutomationsEditorDraft {
  return {
    name: draft.name,
    description: draft.description,
    instructions: draft.instructions,
    ...(draft.operationalPath !== undefined ? { operationalPath: draft.operationalPath } : {}),
    trigger: draft.trigger,
    tools: draft.tools,
    revision: draft.revision,
  };
}

async function openAutomationsEditorChrome(
  draft: AutomationsEditorDraft,
  ctx: ExtensionContext,
): Promise<ReturnType<typeof automationsEditorResult>> {
  return ctx.ui.custom((tui, _theme, _keybindings, done) => {
    let state = initialAutomationsEditorState(draft);
    return {
      render: (width: number) => renderAutomationsEditor(state, width),
      invalidate() {},
      handleInput(data: string) {
        const input: AutomationsEditorInput | undefined = toAutomationsEditorInput(data);
        if (!input) return;
        const next = reduceAutomationsEditor(state, input);
        if (next === state) return;
        state = next;
        tui.requestRender();
        if (state.finished) done(automationsEditorResult(state));
      },
    };
  });
}

function editorTrigger(definition: NonNullable<ReturnType<typeof automationsEditorResult>['definition']>) {
  if (definition.trigger.type === 'webhook') {
    return {
      type: 'webhook' as const,
      fields: [...definition.trigger.fields],
      port: definition.trigger.port,
    };
  }
  return {
    type: 'slack.top_level' as const,
    channelId: definition.trigger.channelId,
  };
}

function cancelledEditorResult(automationId: string, draft: { revision: string; name: string }) {
  return {
    opened: false as const,
    automationId,
    revision: draft.revision,
    kind: 'disabled' as const,
    name: draft.name,
    chrome: AUTOMATIONS_EDITOR_CHROME,
  };
}

function savedEditorResult(
  automationId: string,
  saved: {
    revision: string;
    name: string;
    description: string;
    instructions: string;
    operationalPath?: string;
    trigger: AutomationsEditorDraft['trigger'];
    tools: string[];
  },
) {
  return {
    opened: true as const,
    automationId,
    revision: saved.revision,
    kind: 'disabled' as const,
    name: saved.name,
    chrome: AUTOMATIONS_EDITOR_CHROME,
    definition: {
      name: saved.name,
      description: saved.description,
      instructions: saved.instructions,
      ...(saved.operationalPath !== undefined ? { operationalPath: saved.operationalPath } : {}),
      trigger: saved.trigger,
      tools: saved.tools,
      revision: saved.revision,
    },
  };
}

const automationNamespace = {
  name: 'pstack_automations',
  description: 'Pi-native automation draft lifecycle for the Automations editor handoff.',
  instructions:
    'Prepare a disabled automation draft, open the reviewed editor handoff, and save without enabling. After the seven thread-safety checks pass, record them with AutomationRecordThreadSafety. AutomationEnable requires that receipt plus interactive confirm; it marks the draft enabled locally and does not start Slack ingress. Never finish creation through a backend URL or deep link. Webhook routines stay on Routine* tools.',
} as const;

function registerDraftTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'AutomationPrepare',
    namespace: automationNamespace,
    outputSchema: AutomationPrepareOutput,
    executionMode: 'sequential',
    exposure: 'direct',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    label: 'Prepare automation draft',
    description:
      'Create an immutable disabled automation draft under pstack-automations. No Slack ingress and no services start. Returns automationId and revision for editor handoff.',
    parameters: AutomationSchema,
    execute: async (_id, input, signal, _update, ctx) => {
      signal?.throwIfAborted();
      const draft = await prepareAutomation(root(ctx), input, signal);
      return result({ ...draft, automationId: basename(draft.directory) });
    },
  });

  pi.registerTool({
    name: 'AutomationInspect',
    namespace: automationNamespace,
    outputSchema: AutomationInspectOutput,
    executionMode: 'sequential',
    exposure: 'direct',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    label: 'Inspect automation draft',
    description: 'Read the automation definition. Absent status.json means kind=disabled.',
    parameters: Type.Object(Identity),
    execute: async (_id, input, signal, _update, ctx) => {
      const draft = await inspectAutomation(directory(ctx, input.automationId), signal);
      return result({ ...draft, automationId: input.automationId });
    },
  });
}

function registerOpenEditorTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'AutomationOpenEditor',
    namespace: automationNamespace,
    outputSchema: AutomationOpenEditorOutput,
    executionMode: 'sequential',
    exposure: 'direct',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    label: 'Open Automations editor',
    description:
      'Open the reviewed Automations editor handoff for a disabled draft. Shows name, trigger, instructions, tools, and Inactive state. Does not enable the automation.',
    parameters: Type.Object(Identity),
    execute: async (_id, input, signal, _update, ctx) => {
      signal?.throwIfAborted();
      const path = directory(ctx, input.automationId);
      const draft = await inspectAutomation(path, signal);
      if (draft.kind !== 'disabled') throw new Error('Only disabled automation drafts can open the creation editor.');
      if (!ctx.hasUI) throw new Error('Automations editor handoff requires interactive UI.');
      if (ctx.mode !== 'tui') throw new Error('Automations editor chrome requires Pi TUI (ctx.ui.custom).');
      const outcome = await openAutomationsEditorChrome(toEditorDraft(draft), ctx);
      signal?.throwIfAborted();
      if (outcome.disposition === 'cancelled' || !outcome.definition) {
        return result(cancelledEditorResult(input.automationId, draft));
      }
      const definition = outcome.definition;
      const saved = await saveAutomation(
        path,
        {
          name: definition.name,
          description: definition.description,
          instructions: definition.instructions,
          ...(definition.operationalPath !== undefined ? { operationalPath: definition.operationalPath } : {}),
          trigger: editorTrigger(definition),
          tools: [...definition.tools],
        },
        draft.revision,
        signal,
      );
      return result(savedEditorResult(input.automationId, saved));
    },
  });
}

function registerSaveTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'AutomationSave',
    namespace: automationNamespace,
    outputSchema: AutomationSaveOutput,
    executionMode: 'sequential',
    exposure: 'direct',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    label: 'Save automation draft',
    description:
      'Persist the automation definition with kind=disabled. Never starts Slack or webhook ingress. Creation-boundary finish stops here.',
    parameters: SaveParameters,
    execute: async (_id, input, signal, _update, ctx) => {
      signal?.throwIfAborted();
      const draft = await saveAutomation(
        directory(ctx, input.automationId),
        {
          name: input.name,
          description: input.description,
          instructions: input.instructions,
          ...(input.operationalPath !== undefined ? { operationalPath: input.operationalPath } : {}),
          trigger: input.trigger,
          tools: input.tools,
        },
        input.revision,
        signal,
      );
      return result({ ...draft, automationId: input.automationId });
    },
  });
}

function registerThreadSafetyTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'AutomationRecordThreadSafety',
    namespace: automationNamespace,
    outputSchema: AutomationRecordThreadSafetyOutput,
    executionMode: 'sequential',
    exposure: 'direct',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    label: 'Record thread-safety receipt',
    description:
      'Persist thread-safety.json for the exact draft revision after all seven checks pass. Does not enable the automation or start Slack ingress.',
    parameters: RecordThreadSafetyParameters,
    execute: async (_id, input, signal, _update, ctx) => {
      signal?.throwIfAborted();
      const receipt = await recordThreadSafety(directory(ctx, input.automationId), input.revision, input.checks, signal);
      return result({
        recorded: true as const,
        revision: String(receipt['revision']),
        checks: receipt['checks'] as typeof input.checks,
      });
    },
  });
}

function registerEnableTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'AutomationEnable',
    namespace: automationNamespace,
    outputSchema: AutomationEnableOutput,
    executionMode: 'sequential',
    exposure: 'model-only',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    label: 'Enable automation after thread-safety',
    description:
      'Mark a draft enabled after thread-safety.json matches the exact revision and the operator confirms. Does not start Slack ingress. Creation-boundary workflows must not call this before the seven checks.',
    parameters: EnableParameters,
    execute: async (_id, input, signal, _update, ctx) => {
      signal?.throwIfAborted();
      const path = directory(ctx, input.automationId);
      const draft = await inspectAutomation(path, signal);
      if (draft.revision !== input.revision) throw new Error('Automation revision changed. Inspect and approve the current draft.');
      const receipt = await threadSafetyReceipt(path);
      signal?.throwIfAborted();
      if (!receipt || receipt['revision'] !== draft.revision) {
        return result({
          enabled: false as const,
          refused: true as const,
          reason: 'Thread-safety receipt missing or revision mismatch. Creation boundary forbids enable before the seven checks.',
          revision: draft.revision,
        });
      }
      if (!ctx.hasUI) throw new Error('Automation activation requires interactive operator approval.');
      signal?.throwIfAborted();
      const approved = await ctx.ui.confirm(
        'Enable automation?',
        JSON.stringify({ name: draft.name, revision: draft.revision, trigger: draft.trigger, tools: draft.tools }, null, 2),
        signal ? { signal } : {},
      );
      signal?.throwIfAborted();
      if (!approved) return result({ enabled: false as const, refused: false as const, revision: draft.revision });
      const enabled = await enableAutomation(path, input.revision, signal);
      return result({
        enabled: true as const,
        refused: false as const,
        revision: enabled.revision,
        automationId: input.automationId,
        kind: 'enabled' as const,
      });
    },
  });
}

function registerDisableTool(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'AutomationDisable',
    namespace: automationNamespace,
    outputSchema: AutomationDisableOutput,
    executionMode: 'sequential',
    exposure: 'direct',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    label: 'Disable automation',
    description:
      'Clear local enabled status for an automation draft. Does not delete definition.json or thread-safety.json. Does not touch Slack ingress (none runs yet).',
    parameters: Type.Object(Identity),
    execute: async (_id, input, signal, _update, ctx) => {
      signal?.throwIfAborted();
      const disabled = await disableAutomation(directory(ctx, input.automationId), signal);
      return result({ ...disabled, automationId: input.automationId, kind: 'disabled' as const });
    },
  });
}

export function registerAutomations(pi: ExtensionAPI): void {
  registerDraftTools(pi);
  registerOpenEditorTool(pi);
  registerSaveTool(pi);
  registerThreadSafetyTool(pi);
  registerEnableTool(pi);
  registerDisableTool(pi);
}
