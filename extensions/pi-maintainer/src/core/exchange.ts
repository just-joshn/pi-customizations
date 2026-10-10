import { ValueError } from '../edit/errors.ts';
import { defaultFence, type Fence } from '../edit/fences.ts';
import { intentPaths } from '../edit/intents.ts';
import type { EditCandidate, EditContext, EditIntent, EditPlan, PathEdit, Ports } from '../feature.ts';
import { pythonSorted } from '../support/python-sort.ts';
import { chatFilesOf, type Snapshot } from './branch.ts';
import { absRootPath, getRelFname, inchatRelativeFiles } from './chat-files.ts';
import { ConfirmGroup } from './confirm.ts';
import { getCurMessageText, partitionHistory, projectRequest, type RequestView } from './context.ts';
import type { Host } from './host.ts';
import { getFileMentions } from './mentions.ts';
import { journaledTree } from './mutations.ts';
import type { PromptPolicy, PromptSet, PromptSource } from './prompts.ts';

export type CompletedReply = { readonly kind: 'complete'; readonly id: string; readonly text: string } | { readonly kind: 'incomplete'; readonly id: string; readonly reason: string };
export interface DialogueFact {
  readonly text: string;
  readonly ack: string | null;
  readonly purpose: 'reflection' | 'saved';
  readonly reply: string;
}
export interface ReplyDecision {
  readonly dialogue: readonly DialogueFact[];
  readonly continue: boolean;
}

export interface ExchangeEnv {
  readonly ports: Ports;
  readonly host: Host;
  readonly source: PromptSource;
  readonly append: (data: unknown) => void;
  readonly suggestShellCommands: boolean;
  readonly policy?: PromptPolicy | undefined;
}

const MAX_REFLECTIONS = 3;

export class ExchangeController {
  #state: Snapshot;
  #fence: Fence = defaultFence;
  #prompts: PromptSet | null = null;
  readonly #env: ExchangeEnv;

  constructor(snapshot: Snapshot, env: ExchangeEnv) {
    this.#state = snapshot;
    this.#env = env;
  }
  get snapshot(): Snapshot {
    return this.#state;
  }
  replace(snapshot: Snapshot): void {
    this.#state = snapshot;
  }
  save(snapshot: Snapshot): void {
    this.#state = snapshot;
    this.#env.append(snapshot);
  }

  async projectRequest(view: RequestView) {
    const files = chatFilesOf(this.#state);
    const history = partitionHistory(
      view.messages.filter((message) => message.role !== 'system'),
      view.projection,
      this.#state.historyThrough,
    );
    const curMessageText = getCurMessageText(history.current);
    const repository = await this.#env.ports.map.repoMap({ editable: files.editable, readOnly: files.readOnly, curMessageText }, view.signal);
    const result = await projectRequest({
      snapshot: this.#state,
      view,
      tree: this.#env.ports.edit.tree,
      notices: this.#env.host,
      source: this.#env.source,
      promptFormat: this.#env.ports.edit.formats.get(this.#state.mode)?.prompts ?? this.#state.mode,
      suggestShellCommands: this.#env.suggestShellCommands,
      repository,
      policy: this.#env.policy,
    });
    this.#fence = result.fence;
    this.#prompts = result.prompts;
    if (JSON.stringify(result.files) !== JSON.stringify(this.#state.files)) this.save({ ...this.#state, files: result.files });
    return result;
  }

  bindUser(userEntries: string[], model: { provider: string; id: string }, reason: 'user' | 'continuation' | 'retry'): void {
    if (!this.#env.ports.edit.formats.has(this.#state.mode)) throw new Error(`Edit format ${this.#state.mode} is not implemented`);
    const last = userEntries.at(-1);
    if (last === undefined || last === this.#state.lastUserEntry) {
      const lifecycle = this.#state.lifecycle;
      const next: Snapshot['lifecycle'] =
        lifecycle.kind === 'active'
          ? { ...lifecycle, waitingFor: null }
          : lifecycle.kind === 'interrupted' && reason === 'retry'
            ? { kind: 'active', userEntries: lifecycle.userEntries, reflectionsSent: lifecycle.reflectionsSent, preparedTargets: lifecycle.preparedTargets, writtenPaths: lifecycle.writtenPaths, waitingFor: null }
            : lifecycle;
      this.save({ ...this.#state, physicalModel: model, lifecycle: next });
      return;
    }
    const newUsers = this.#state.lastUserEntry === null ? [...userEntries] : userEntries.slice(userEntries.indexOf(this.#state.lastUserEntry) + 1);
    this.save({ ...this.#state, physicalModel: model, lastUserEntry: last, lifecycle: { kind: 'active', userEntries: newUsers, reflectionsSent: 0, preparedTargets: [], writtenPaths: [], waitingFor: null } });
  }

  async completeReply(reply: CompletedReply, signal?: AbortSignal): Promise<ReplyDecision> {
    if (reply.kind === 'incomplete' || signal?.aborted) {
      this.interrupt(reply.kind === 'incomplete' ? reply.reason : 'aborted');
      return { dialogue: [], continue: false };
    }
    if (this.#state.lifecycle.kind !== 'active') return { dialogue: [], continue: false };
    const dialogue: DialogueFact[] = [];
    let prepared: readonly (string | null)[] = [];
    let reflection: string | null = null;
    const context = this.editContext(reply.id, signal);
    try {
      signal?.throwIfAborted();
      const added = await this.checkForFileMentions(reply.text, signal);
      if (added) {
        this.#env.append({ schema: 1, kind: 'reply-finished', reply: reply.id });
        return this.reflect(added, reply.id, dialogue);
      }
      const format = this.#env.ports.edit.formats.get(this.#state.mode);
      if (!format) throw new Error(`Edit format ${this.#state.mode} is not implemented`);
      await format.withPlan(
        reply.text,
        context,
        (edits, locked) => this.prepareToEdit(edits, locked),
        async (plan) => {
          prepared = plan.targets;
          this.trackPrepared(prepared);
          await this.applyPlan(plan, signal);
        },
      );
    } catch (error) {
      if (signal?.aborted) {
        this.interrupt('aborted');
        return { dialogue: [], continue: false };
      }
      reflection = error instanceof Error ? error.message : String(error);
      this.#env.host.error(error instanceof ValueError ? 'The LLM did not conform to the edit format.' : 'Exception while updating files:');
      this.#env.host.error(reflection);
    }
    dialogue.push(...(await this.recordEdited(prepared, reply, signal)));
    this.#env.append({ schema: 1, kind: 'reply-finished', reply: reply.id });
    if (reflection !== null) return this.reflect(reflection, reply.id, dialogue);
    return { dialogue, continue: false };
  }

  async recordEdited(prepared: readonly (string | null)[], reply: Extract<CompletedReply, { kind: 'complete' }>, signal?: AbortSignal): Promise<DialogueFact[]> {
    const lifecycle = this.#state.lifecycle;
    const written = lifecycle.kind === 'active' ? lifecycle.writtenPaths : [];
    if (!written.length) return [];
    if (!this.#env.ports.edit.dryRun) await this.#env.ports.git.autoCommit(new Set(prepared), { kind: 'conversation', text: reply.text }, signal);
    this.save({ ...this.#state, historyThrough: reply.id });
    return this.#prompts?.filesContentGptEditsNoRepo ? [{ text: this.#prompts.filesContentGptEditsNoRepo, ack: 'Ok.', purpose: 'saved', reply: reply.id }] : [];
  }

  async checkForFileMentions(content: string, signal?: AbortSignal): Promise<string | null> {
    const inchat = inchatRelativeFiles(this.#state.root, chatFilesOf(this.#state));
    const readOnly = this.#state.files.readOnly.map((path) => getRelFname(this.#state.root, path));
    const all = (await this.#env.ports.git.trackedFiles()) ?? inchat;
    const excluded = new Set([...inchat, ...readOnly]);
    const mentioned = getFileMentions({ content, inchat, readOnly, addable: all.filter((path) => !excluded.has(path)), ignoreCurrent: false });
    const fresh = pythonSorted(mentioned).filter((path) => !this.#state.ignoredMentions.includes(path));
    const group = new ConfirmGroup(fresh);
    const added: string[] = [];
    for (const path of fresh) {
      signal?.throwIfAborted();
      if (await this.#env.host.confirm({ question: 'Add file to the chat?', subject: path, group, allowNever: true })) {
        signal?.throwIfAborted();
        this.save({ ...this.#state, files: { ...this.#state.files, editable: [...new Set([...this.#state.files.editable, absRootPath(this.#state.root, path)])] } });
        added.push(path);
      } else this.save({ ...this.#state, ignoredMentions: [...new Set([...this.#state.ignoredMentions, path])] });
    }
    return added.length ? `I added these files to the chat: ${added.join(', ')}\nLet me know if there are others we should add.` : null;
  }

  editContext(reply: string, signal?: AbortSignal): EditContext {
    return {
      root: this.#state.root,
      absRootPath: (path) => absRootPath(this.#state.root, path),
      inchatRelativeFiles: inchatRelativeFiles(this.#state.root, chatFilesOf(this.#state)),
      tree: journaledTree(this.#env.ports.edit.tree, reply, this.#env.append, (path) => this.trackWritten(path), signal),
      fence: this.#fence,
      notices: this.#env.host,
      signal,
    };
  }

  async prepareToEdit<E extends PathEdit>(candidates: readonly EditCandidate<E>[], context: EditContext): Promise<EditCandidate<E>[]> {
    const seen = new Map<string, boolean>();
    const prepared: EditCandidate<E>[] = [];
    const dirty = new Set<string>();
    for (const candidate of candidates) {
      context.signal?.throwIfAborted();
      const paths = intentPaths(candidate.intent);
      if (candidate.intent === null) {
        if (candidate.edit[0] === null) prepared.push(candidate);
        continue;
      }
      let allowed = true;
      for (const path of paths) {
        const decision = seen.get(path) ?? (await this.allowedToEdit(path, context, candidate.intent));
        seen.set(path, decision);
        if (!decision) {
          allowed = false;
          break;
        }
      }
      if (!allowed) continue;
      prepared.push(candidate);
      for (const path of paths) {
        if (await this.#env.ports.git.needsDirtyCommit(path)) dirty.add(path);
      }
    }
    const checkpoint = context.tree.dryRun ? ({ kind: 'disabled' } as const) : await this.#env.ports.git.dirtyCommit(dirty, context.signal);
    if (checkpoint.kind === 'failed') throw new Error(checkpoint.error);
    return prepared;
  }

  async allowedToEdit(path: string, context: EditContext, intent: EditIntent | null = null): Promise<boolean> {
    const full = context.absRootPath(path);
    if (this.#state.files.editable.includes(full)) return true;
    if (await this.#env.ports.git.isGitIgnored(path)) {
      this.#env.host.warning(`Skipping edits to ${path} that matches gitignore spec.`);
      return false;
    }
    const exists = await context.tree.exists(full);
    const question = exists ? 'Allow edits to file that has not been added to the chat?' : 'Create new file?';
    if (!(await this.#env.host.confirm({ question, subject: path }))) {
      this.#env.host.output(`Skipping edits to ${path}`);
      return false;
    }
    context.signal?.throwIfAborted();
    if (!exists && intent?.kind !== 'add' && !(await context.tree.touch(full))) {
      this.#env.host.error(`Unable to create ${path}, skipping edits.`);
      return false;
    }
    this.save({ ...this.#state, files: { ...this.#state.files, editable: [...new Set([...this.#state.files.editable, full])] } });
    return true;
  }

  async applyPlan(plan: EditPlan, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    await plan.apply();
    for (const path of new Set(plan.targets)) this.#env.host.output(this.#env.ports.edit.dryRun ? `Did not apply edit to ${path} (--dry-run)` : `Applied edit to ${path}`);
  }

  trackPrepared(paths: readonly (string | null)[]): void {
    const lifecycle = this.#state.lifecycle;
    if (lifecycle.kind !== 'active') return;
    this.save({ ...this.#state, lifecycle: { ...lifecycle, preparedTargets: [...new Set([...lifecycle.preparedTargets, ...paths.filter((path) => path !== null)])] } });
  }
  trackWritten(path: string): void {
    const lifecycle = this.#state.lifecycle;
    if (lifecycle.kind !== 'active') return;
    this.save({ ...this.#state, lifecycle: { ...lifecycle, writtenPaths: [...new Set([...lifecycle.writtenPaths, path])] } });
  }
  reflect(text: string, reply: string, dialogue: DialogueFact[]): ReplyDecision {
    const lifecycle = this.#state.lifecycle;
    const max = MAX_REFLECTIONS;
    if (lifecycle.kind !== 'active') return { dialogue, continue: false };
    if (lifecycle.reflectionsSent >= max) {
      this.#env.host.warning(`Only ${max} reflections allowed, stopping.`);
      return { dialogue, continue: false };
    }
    this.save({ ...this.#state, lifecycle: { ...lifecycle, reflectionsSent: lifecycle.reflectionsSent + 1, waitingFor: reply } });
    return { dialogue: [...dialogue, { text, ack: null, purpose: 'reflection', reply }], continue: true };
  }
  interrupt(reason: string): void {
    const lifecycle = this.#state.lifecycle;
    if (lifecycle.kind !== 'active') return;
    this.save({ ...this.#state, lifecycle: { kind: 'interrupted', userEntries: lifecycle.userEntries, reflectionsSent: lifecycle.reflectionsSent, preparedTargets: lifecycle.preparedTargets, writtenPaths: lifecycle.writtenPaths, reason } });
  }
  reconcile(aborted: boolean): void {
    const lifecycle = this.#state.lifecycle;
    if (lifecycle.kind !== 'active') return;
    if (aborted || lifecycle.waitingFor !== null) this.interrupt(aborted ? 'aborted' : 'Expected reflection did not receive a response');
    else this.save({ ...this.#state, lifecycle: { kind: 'idle' } });
    this.#env.append({ schema: 1, kind: 'settled', outcome: this.#state.lifecycle.kind });
  }
}
