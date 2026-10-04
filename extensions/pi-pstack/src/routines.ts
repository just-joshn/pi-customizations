import { createHash } from 'node:crypto';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { DefaultResourceLoader, type ExtensionAPI, type ExtensionContext, getAgentDir } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { disableRoutine, inspectRoutine, prepareRoutine, startRoutine } from '../scripts/routine-client.mjs';
import { dataResult as result } from './results.ts';
import { RoutineSchema } from './routine-domain.ts';
import { childSettings } from './subagents/child-settings.ts';
import { RoutineDisableOutput, RoutineEnableOutput, RoutineInspectOutput, RoutinePrepareOutput } from './timer-routine-output-schemas.ts';
import { workerExtensions } from './worker-support.ts';

const Identity = { routineId: Type.String({ pattern: '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' }) };
const quote = (text: string) => `'${text.replaceAll("'", "'\\''")}'`;
function root(ctx: ExtensionContext) {
  const owner = createHash('sha256').update(`${ctx.cwd}\0${ctx.sessionManager.getSessionId()}`).digest('hex');
  return join(getAgentDir(), 'pstack-routines', owner);
}

function directory(ctx: ExtensionContext, routineId: string) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(routineId)) throw new Error('Invalid routine ID.');
  return join(root(ctx), routineId);
}

async function launch(ctx: ExtensionContext, pi: ExtensionAPI, path: string, signal?: AbortSignal) {
  signal?.throwIfAborted();
  if (!ctx.model) throw new Error('Choose a Pi model before enabling a routine.');
  const own = fileURLToPath(new URL('./index.ts', import.meta.url));
  const extra = process.argv.flatMap((arg, index) => {
    const path = process.argv[index + 1];
    return (arg === '-e' || arg === '--extension') && path ? [path] : [];
  });
  const settingsManager = childSettings(ctx.cwd, ctx);
  const projectTrusted = settingsManager.isProjectTrusted();
  const loader = new DefaultResourceLoader({ cwd: ctx.cwd, agentDir: getAgentDir(), settingsManager, additionalExtensionPaths: [own, ...extra], extensionsOverride: (value) => workerExtensions(value, own) });
  await loader.reload();
  signal?.throwIfAborted();
  if (loader.getExtensions().errors.length) throw new Error('Routine model extensions failed to load.');
  const args = [
    projectTrusted ? '--approve' : '--no-approve',
    '--no-extensions',
    '--session-dir',
    join(path, 'session'),
    '--provider',
    ctx.model.provider,
    '--model',
    ctx.model.id,
    '--thinking',
    pi.getThinkingLevel(),
    ...loader.getExtensions().extensions.flatMap((item) => ['-e', item.resolvedPath]),
  ];
  return { cwd: ctx.cwd, agentDir: getAgentDir(), args, expectedModel: { provider: ctx.model.provider, id: ctx.model.id } };
}

function registerDraftTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'RoutinePrepare',
    namespace: routineNamespace,
    outputSchema: RoutinePrepareOutput,
    executionMode: 'sequential',
    exposure: 'direct',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    label: 'Prepare webhook routine',
    description: 'Create an immutable disabled webhook routine draft. Returns a hidden terminal key initializer command. Never pass a sender key in chat or tool arguments. No services start.',
    parameters: RoutineSchema,
    execute: async (_id, input, signal, _update, ctx) => {
      signal?.throwIfAborted();
      const draft = await prepareRoutine(root(ctx), input, signal);
      const routineId = basename(draft.directory);
      const helper = fileURLToPath(new URL('../scripts/routine-secret.mjs', import.meta.url));
      return result({ ...draft, routineId, initializer: `${quote(process.execPath)} ${quote(helper)} ${quote(draft.directory)}` });
    },
  });
  pi.registerTool({
    name: 'RoutineInspect',
    namespace: routineNamespace,
    outputSchema: RoutineInspectOutput,
    executionMode: 'sequential',
    exposure: 'direct',
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    label: 'Inspect webhook routine',
    description: 'Read the routine definition and supervisor receipt without reading its sender key.',
    parameters: Type.Object(Identity),
    execute: async (_id, input, signal, _update, ctx) => result(await inspectRoutine(directory(ctx, input.routineId), signal)),
  });
}

function registerLifecycleTools(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'RoutineEnable',
    namespace: routineNamespace,
    outputSchema: RoutineEnableOutput,
    executionMode: 'sequential',
    exposure: 'model-only',
    annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    label: 'Enable reviewed webhook routine',
    description: 'Show the exact draft revision for interactive operator approval, then start its dedicated persistent Pi root and authenticated local receiver. Cannot enable unattended.',
    parameters: Type.Object({ ...Identity, revision: Type.String({ pattern: '^[a-f0-9]{64}$' }) }),
    execute: async (_id, input, signal, _update, ctx) => {
      signal?.throwIfAborted();
      const path = directory(ctx, input.routineId);
      const draft = await inspectRoutine(path, signal);
      if (draft.revision !== input.revision) throw new Error('Routine revision changed. Inspect and approve the current draft.');
      if (!ctx.hasUI) throw new Error('Routine activation requires interactive operator approval.');
      signal?.throwIfAborted();
      const approved = await ctx.ui.confirm('Enable webhook routine?', JSON.stringify({ name: draft.name, revision: draft.revision, prompt: draft.prompt, fields: draft.fields, port: draft.port }, null, 2), signal ? { signal } : {});
      signal?.throwIfAborted();
      if (!approved) return result({ enabled: false, revision: draft.revision });
      return result(await startRoutine(path, input.revision, await launch(ctx, pi, path, signal), signal));
    },
  });
  pi.registerTool({
    name: 'RoutineDisable',
    namespace: routineNamespace,
    outputSchema: RoutineDisableOutput,
    executionMode: 'sequential',
    exposure: 'direct',
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
    label: 'Disable webhook routine',
    description: 'Stop accepting events and drain the owned Pi subprocess. Accepted but incomplete events remain durable for operator reconciliation.',
    parameters: Type.Object(Identity),
    execute: async (_id, input, signal, _update, ctx) => result(await disableRoutine(directory(ctx, input.routineId), signal)),
  });
}

const routineNamespace = {
  name: 'pstack_routines',
  description: 'Authenticated webhook routine lifecycle.',
  instructions:
    'Prepare a disabled draft, initialize its sender key outside chat, and inspect the exact revision before enabling. Activation requires interactive approval. Disable stops ingress and drains the owned process. Incomplete events remain durable for reconciliation.',
} as const;

export function registerRoutines(pi: ExtensionAPI): void {
  registerDraftTools(pi);
  registerLifecycleTools(pi);
}
