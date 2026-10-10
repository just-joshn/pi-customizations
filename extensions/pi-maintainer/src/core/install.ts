import { homedir } from 'node:os';

import type { ContextWithSystemEvent, ExtensionAPI, ExtensionContext, ModelRouteRequest, SessionBoundaryDraft, TurnEndEvent } from '@earendil-works/pi-coding-agent';
import { Text } from '@earendil-works/pi-tui';
import { BRANDING } from '../branding.ts';
import { editOptions } from '../edit/options.ts';
import { createPorts, type Ports, type SarFeature } from '../feature.ts';
import { loadSettings } from '../settings/load.ts';
import { settingsOptions } from '../settings/options.ts';
import { flagRegistrations } from '../settings/sources.ts';
import { restore, type Snapshot } from './branch.ts';
import { absRootPath, findCommonRoot } from './chat-files.ts';
import { type CompletedReply, type DialogueFact, ExchangeController } from './exchange.ts';
import { journaledTree } from './mutations.ts';
import { createHost } from './pi-host.ts';
import type { PromptPolicy, PromptSource } from './prompts.ts';

export interface MaintainerOptions {
  readonly promptSource?: PromptSource;
  readonly promptPolicy?: PromptPolicy;
  readonly home?: () => string;
  readonly processEnvironment?: () => Readonly<Record<string, string | undefined>>;
}

const missingPromptSource: PromptSource = {
  get() {
    throw new Error('Maintainer PromptSource is not configured. E7 prompt formatting must be wired before using the default extension.');
  },
};

function completedReply(event: TurnEndEvent): CompletedReply {
  const message = event.message;
  if (event.outcome !== 'completed' || message.role !== 'assistant') return { kind: 'incomplete', id: event.messageEntryId, reason: event.outcome };
  if (message.stopReason !== 'stop' || message.content.some((block) => block.type === 'toolCall')) return { kind: 'incomplete', id: event.messageEntryId, reason: message.stopReason };
  return {
    kind: 'complete',
    id: event.messageEntryId,
    text: message.content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join(''),
  };
}

const draft = (fact: DialogueFact): SessionBoundaryDraft => ({ type: 'custom_message', customType: BRANDING.dialogueEntry, content: fact.text, display: true, details: { ack: fact.ack, purpose: fact.purpose, reply: fact.reply } });

async function initialSnapshot(ports: Ports, cwd: string, append: (data: unknown) => void, host: ReturnType<typeof createHost>, allowCreation: boolean, owner: string): Promise<Snapshot> {
  const editable: string[] = [];
  const tree = journaledTree(ports.edit.tree, owner, append, () => {});
  for (const path of ports.edit.initialFiles.editable) {
    const full = absRootPath(cwd, path);
    if (!(await tree.exists(full))) {
      if (!allowCreation) {
        host.warning(`Recovery refused startup creation of ${path}.`);
        continue;
      }
      if (!(await tree.touch(full))) {
        host.warning(`Can not create ${path}, skipping.`);
        continue;
      }
      host.output(`Creating empty file ${path}`);
    }
    editable.push(full);
  }
  const root = ports.git.repoRoot() ?? findCommonRoot(editable, cwd);
  const readOnly: string[] = [];
  for (const path of ports.edit.initialFiles.readOnly) {
    const full = absRootPath(root, path);
    if (await tree.exists(full)) readOnly.push(full);
    else host.warning(`Error: Read-only file ${path} does not exist. Skipping.`);
  }
  return {
    schema: 1,
    kind: 'snapshot',
    root,
    mode: ports.edit.requestedFormat ?? 'whole',
    files: { editable: [...new Set(editable)], readOnly: [...new Set(readOnly)] },
    ignoredMentions: [],
    neverAsk: [],
    lastUserEntry: null,
    historyThrough: null,
    physicalModel: null,
    lifecycle: { kind: 'idle' },
  };
}

export function installMaintainer(pi: ExtensionAPI, features: readonly SarFeature[], options: MaintainerOptions = {}): void {
  const specs = [...features.flatMap((feature) => feature.options), ...Object.values(settingsOptions)];
  for (const spec of specs) for (const flag of flagRegistrations(spec)) pi.registerFlag(flag.name, { type: flag.type, description: flag.description });
  const runtime = new MaintainerRuntime(pi, features, options);
  pi.registerVirtualModel({
    provider: BRANDING.routerProvider,
    id: BRANDING.routerId,
    name: 'Maintainer coder',
    thinkingLevels: ['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
    route: (request, ctx) => runtime.route(request, ctx),
  });
  pi.registerEntryRenderer(BRANDING.stateEntry, (entry) => new Text(JSON.stringify(entry.data), 0, 0));
  pi.on('session_start', (_event, ctx) => runtime.start(ctx));
  pi.on('session_tree', (_event, ctx) => runtime.restoreBranch(ctx));
  pi.on('session_shutdown', () => runtime.dispose());
  pi.on('before_agent_start', (event, ctx) => {
    runtime.context = ctx;
    pi.setActiveTools([]);
    if (!restore(ctx.sessionManager.getBranch()).snapshot) {
      runtime.host.error('Selected branch has no maintainer snapshot. Select a physical model and reload before prompting.');
      ctx.abort();
    }
    const promptOptions = event.systemPromptOptions;
    promptOptions.customPrompt = 'Maintainer reply-text editing. No model tools.';
  });
  pi.on('context_with_system', (event, ctx) => runtime.project(event, ctx));
  pi.on('turn_end', (event, ctx) => runtime.complete(event, ctx));
  pi.on('agent_before_settle', (event, ctx) => {
    runtime.current(ctx).reconcile(event.outcome === 'aborted');
  });
  pi.on('agent_settled', (event, ctx) => {
    runtime.current(ctx).reconcile(event.aborted);
  });
  pi.on('tool_call', () => ({ block: true, reason: 'Maintainer coders use reply-text edits, not model tools.', terminate: true }));
  for (const feature of features)
    for (const command of feature.commands)
      pi.registerCommand(command.name, {
        description: command.description,
        handler: async (args, ctx) => {
          runtime.context = ctx;
          if (!ctx.isIdle()) throw new Error('Maintainer commands require an idle session');
          await command.run(args, { host: runtime.host });
        },
      });
}

class MaintainerRuntime {
  context: ExtensionContext | null = null;
  #controller: ExchangeController | null = null;
  #environment: Readonly<Record<string, string | undefined>> = {};
  #yes: boolean | null = null;
  readonly host: ReturnType<typeof createHost>;
  readonly #pi: ExtensionAPI;
  readonly #features: readonly SarFeature[];
  readonly #options: MaintainerOptions;

  constructor(pi: ExtensionAPI, features: readonly SarFeature[], options: MaintainerOptions) {
    this.#pi = pi;
    this.#features = features;
    this.#options = options;
    this.host = createHost(pi, {
      context: () => {
        if (!this.context) throw new Error('Maintainer context is unavailable');
        return this.context;
      },
      yes: () => this.#yes,
      never: () => this.#controller?.snapshot.neverAsk ?? [],
      remember: (key) => {
        if (this.#controller) this.#controller.save({ ...this.#controller.snapshot, neverAsk: [...this.#controller.snapshot.neverAsk, key] });
      },
      environment: () => this.#environment,
      notice: (level, text) => {
        this.context?.ui.notify(text, level);
        this.append({ schema: 1, kind: 'notice', level, text });
      },
    });
  }
  append(data: unknown): void {
    this.#pi.appendEntry(BRANDING.stateEntry, data);
  }
  current(ctx: ExtensionContext): ExchangeController {
    this.context = ctx;
    if (!this.#controller) throw new Error('Maintainer is not initialized');
    return this.#controller;
  }
  async start(ctx: ExtensionContext): Promise<void> {
    this.context = ctx;
    const specs = this.#features.flatMap((feature) => feature.options);
    const loaded = await loadSettings({ specs, cwd: ctx.cwd, home: (this.#options.home ?? homedir)(), getFlag: (name) => this.#pi.getFlag(name), processEnvironment: (this.#options.processEnvironment ?? (() => process.env))() });
    for (const problem of loaded.problems) this.host.error(problem);
    if (loaded.problems.length) throw new Error('Invalid maintainer settings');
    this.#environment = loaded.environment;
    const ports = createPorts(this.#features, { settings: loaded.settings, cwd: ctx.cwd, host: this.host });
    this.#yes = ports.edit.yesAlways;
    const restored = restore(ctx.sessionManager.getBranch());
    const snapshot = restored.snapshot ?? (await initialSnapshot(ports, ctx.cwd, (data) => this.append(data), this.host, !restored.pendingOperations.length && !restored.invalidRecords.length, ctx.sessionManager.getLeafId() ?? 'startup'));
    this.#controller = new ExchangeController(snapshot, {
      ports,
      host: this.host,
      source: this.#options.promptSource ?? missingPromptSource,
      append: (data) => this.append(data),
      policy: this.#options.promptPolicy,
      suggestShellCommands: loaded.settings.value(editOptions.suggestShellCommands),
    });
    if (!restored.snapshot) this.#controller.save(snapshot);
    if (ctx.model?.api !== 'pi-virtual' && ctx.model) this.#controller.save({ ...snapshot, physicalModel: { provider: ctx.model.provider, id: ctx.model.id } });
    this.restoreBranch(ctx);
    this.#pi.setActiveTools([]);
    const router = ctx.modelRegistry.find(BRANDING.routerProvider, BRANDING.routerId);
    if (!router || !(await this.#pi.setModel(router))) throw new Error('Maintainer router cannot be selected');
  }
  restoreBranch(ctx: ExtensionContext): void {
    const controller = this.current(ctx);
    const restored = restore(ctx.sessionManager.getBranch());
    if (restored.snapshot) controller.replace(restored.snapshot);
    if (restored.pendingOperations.length || restored.invalidRecords.length) controller.interrupt('Unresolved or invalid operation records require manual reconciliation');
    else if (controller.snapshot.lifecycle.kind === 'active') controller.interrupt('The previous exchange was interrupted. It will not be replayed.');
  }
  async route(request: ModelRouteRequest, ctx: ExtensionContext) {
    const controller = this.current(ctx);
    request.signal?.throwIfAborted();
    if (request.reason === 'continuation' && controller.snapshot.lifecycle.kind === 'interrupted') throw new Error('Maintainer exchange is interrupted');
    const restored = restore(ctx.sessionManager.getBranch());
    if (!restored.snapshot) throw new Error('Selected branch has no maintainer snapshot');
    if (restored.pendingOperations.length || restored.invalidRecords.length) throw new Error('Unresolved maintainer operation receipts');
    if (this.#pi.getActiveTools().length) throw new Error('Another extension reactivated tools in maintainer mode');
    const reference = controller.snapshot.physicalModel;
    const model = reference ? ctx.modelRegistry.find(reference.provider, reference.id) : undefined;
    if (!model || model.api === 'pi-virtual') throw new Error('Maintainer needs an available physical model');
    if (request.reason !== 'direct') {
      const branch = ctx.sessionManager.getBranch();
      const users = branch.filter((entry) => entry.type === 'message' && entry.message.role === 'user').map((entry) => entry.id);
      controller.bindUser(users, { provider: model.provider, id: model.id }, request.reason);
      if (request.reason === 'user') {
        const user = branch.filter((entry) => entry.type === 'message' && entry.message.role === 'user').at(-1);
        if (user?.type === 'message' && user.message.role === 'user') {
          const content =
            typeof user.message.content === 'string'
              ? user.message.content
              : user.message.content
                  .filter((block) => block.type === 'text')
                  .map((block) => block.text)
                  .join('');
          await controller.checkForFileMentions(content, request.signal);
        }
      }
    }
    if (request.reason === 'user' || request.reason === 'direct') return { model, thinkingLevel: request.thinkingLevel };
    return { model, thinkingLevel: request.failed?.thinkingLevel ?? request.previous?.thinkingLevel ?? request.thinkingLevel };
  }
  async project(event: ContextWithSystemEvent, ctx: ExtensionContext) {
    try {
      const controller = this.current(ctx);
      const physical = controller.snapshot.physicalModel;
      const model = physical ? ctx.modelRegistry.find(physical.provider, physical.id) : undefined;
      const result = await controller.projectRequest({ messages: event.messages, projection: ctx.sessionManager.buildSessionProjection().entries, supportsImages: model?.input.includes('image') ?? false, signal: ctx.signal });
      return { messages: result.messages };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.host.error(reason);
      this.#controller?.interrupt(reason);
      ctx.abort();
      return undefined;
    }
  }
  async complete(event: TurnEndEvent, ctx: ExtensionContext) {
    const controller = this.current(ctx);
    if (restore(ctx.sessionManager.getBranch()).finishedReplies.has(event.messageEntryId)) return;
    const decision = await controller.completeReply(completedReply(event), ctx.signal);
    if (!decision.dialogue.length) return;
    return { entries: [...event.entries, ...decision.dialogue.map(draft)], ...(decision.continue ? { continue: true } : {}) };
  }
  dispose(): void {
    this.context = null;
    this.#controller = null;
  }
}
