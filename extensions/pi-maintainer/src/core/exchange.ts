import { ValueError } from '../edit/errors.ts';
import { defaultFence, type Fence } from '../edit/fences.ts';
import { intentPaths } from '../edit/intents.ts';
import { contextPrompts } from '../edit/prompts/context.ts';
import { replyTextForEdits } from '../edit/reasoning.ts';
import type { EditCandidate, EditContext, EditIntent, EditPlan, PathEdit, Ports } from '../feature.ts';
import { pythonSorted } from '../support/python-sort.ts';
import { chatFilesOf, type Snapshot } from './branch.ts';
import { chatListingPaths, formatFilesForInput } from './chat-file-listing.ts';
import { absRootPath, allRelativeFiles, getRelFname, inchatRelativeFiles } from './chat-files.ts';
import { ConfirmGroup } from './confirm.ts';
import { getCurMessageText, partitionHistory, projectRequest, type RequestView } from './context.ts';
import type { Host } from './host.ts';
import { getFileMentions } from './mentions.ts';
import { journaledTree } from './mutations.ts';
import type { PromptPolicy, PromptSet, PromptSource } from './prompts.ts';
import { requestRepoMap } from './repo-map.ts';

export type CompletedReply = { readonly kind: 'complete'; readonly id: string; readonly text: string } | { readonly kind: 'incomplete'; readonly id: string; readonly reason: string };
export interface DialogueFact {
  readonly text: string;
  readonly ack: string | null;
  readonly purpose: 'reflection' | 'saved' | 'editor-input' | 'architect-return';
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
  /** Resolve `--editor-model` against the host registry, or null when unavailable. */
  readonly resolveEditorModel?: (name: string | null, main: { provider: string; id: string }) => { provider: string; id: string } | null;
  /** Aider `reasoning_tag_name`. Undefined falls back to `REASONING_TAG`. */
  readonly reasoningTag?: string;
  /** Aider `InputOutput.pretty`. Defaults to true. */
  readonly pretty?: boolean;
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
    this.#emitChatFileListing(files);
    const editor = this.#state.phase.kind === 'editor';
    const history = partitionHistory(
      view.messages.filter((message) => message.role !== 'system'),
      view.projection,
      this.#state.historyThrough,
    );
    const curMessageText = getCurMessageText(history.current);
    const contextMode = this.#state.mode === 'context';
    const repository = await requestRepoMap({
      root: this.#state.root,
      files,
      git: this.#env.ports.git,
      map: this.#env.ports.map,
      curMessageText,
      policy: {
        disabled: editor,
        forceRefresh: contextMode,
        refresh: contextMode ? 'always' : 'auto',
        expandNoFilesBudget: contextMode,
      },
      signal: view.signal,
    });
    const result = await projectRequest({
      snapshot: this.#state,
      view,
      tree: this.#env.ports.edit.tree,
      notices: this.#env.host,
      source: this.#env.source,
      promptFormat: this.#env.ports.edit.formats.get(this.#state.mode)?.prompts ?? this.#state.mode,
      suggestShellCommands: editor ? false : this.#env.suggestShellCommands,
      repository,
      policy: this.#env.policy,
      editorFresh: editor,
    });
    this.#fence = result.fence;
    this.#prompts = result.prompts;
    if (JSON.stringify(result.files) !== JSON.stringify(this.#state.files)) this.save({ ...this.#state, files: result.files });
    return result;
  }

  #emitChatFileListing(files: ReturnType<typeof chatFilesOf>): void {
    const { relFnames, relReadOnlyFnames } = chatListingPaths(this.#state.root, files);
    if (!relFnames.length) return;
    const listing = formatFilesForInput({
      relFnames,
      relReadOnlyFnames,
      pretty: this.#env.pretty ?? true,
      root: this.#state.root,
    });
    if (listing) this.#env.host.output(listing.replace(/\n$/, ''));
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
    reply = { ...reply, text: replyTextForEdits(reply.text, this.#env.reasoningTag) };
    if (this.#state.mode === 'context' || (this.#state.mode === 'architect' && this.#state.phase.kind === 'main')) {
      const modeDecision = this.#state.mode === 'context' ? await this.completeContext(reply, signal) : await this.completeArchitect(reply, signal);
      if (modeDecision !== null) return modeDecision;
    }
    if (this.#state.mode === 'ask') {
      this.#env.append({ schema: 1, kind: 'reply-finished', reply: reply.id });
      return { dialogue: [], continue: false };
    }
    const dialogue: DialogueFact[] = [];
    let prepared: readonly (string | null)[] = [];
    let shellCommands: readonly string[] = [];
    let reflection: string | null = null;
    const context = this.editContext(reply.id, signal);
    const editorPhase = this.#state.phase.kind === 'editor' ? this.#state.phase : null;
    try {
      signal?.throwIfAborted();
      if (!editorPhase) {
        const added = await this.checkForFileMentions(reply.text, signal);
        if (added) {
          this.#env.append({ schema: 1, kind: 'reply-finished', reply: reply.id });
          return this.reflect(added, reply.id, dialogue);
        }
      }
      const format = this.#env.ports.edit.formats.get(this.#state.mode);
      if (!format) throw new Error(`Edit format ${this.#state.mode} is not implemented`);
      await format.withPlan(
        reply.text,
        context,
        (edits, locked) => this.prepareToEdit(edits, locked),
        async (plan) => {
          prepared = plan.targets;
          shellCommands = plan.shellCommands;
          this.trackPrepared(prepared);
          await this.applyPlan(plan, signal);
        },
      );
    } catch (error) {
      if (signal?.aborted) {
        this.interrupt('aborted');
        return { dialogue: [], continue: false };
      }
      reflection = this.reportApplicationError(error);
    }
    dialogue.push(...(await this.recordEdited(prepared, reply, signal)));
    this.#env.append({ schema: 1, kind: 'reply-finished', reply: reply.id });
    if (editorPhase) {
      this.save({ ...this.#state, mode: editorPhase.parentMode, phase: { kind: 'main' }, physicalModel: editorPhase.parentModel });
      if (reflection === null) dialogue.push({ text: 'I made those changes to the files.', ack: 'Ok.', purpose: 'architect-return', reply: reply.id });
    }
    if (reflection !== null) return this.reflect(reflection, reply.id, dialogue);
    const lintReflection = await this.validateWritten(signal);
    if (lintReflection !== null) return this.reflect(lintReflection, reply.id, dialogue);
    await this.forwardSuggestedShell(shellCommands, signal);
    return { dialogue, continue: false };
  }

  /** Aider `run_shell_commands`: when suggestions are on, forward each distinct block once. */
  async forwardSuggestedShell(commands: readonly string[], signal?: AbortSignal): Promise<void> {
    if (!this.#env.suggestShellCommands) return;
    const done = new Set<string>();
    const distinct: string[] = [];
    for (const command of commands) {
      if (done.has(command)) continue;
      done.add(command);
      distinct.push(command);
    }
    if (distinct.length === 0) return;
    signal?.throwIfAborted();
    await this.#env.ports.lint.runSuggestedShell(distinct, signal);
  }

  /** Context mode. Replace editable files from mentions; never apply edits. */
  async completeContext(reply: Extract<CompletedReply, { kind: 'complete' }>, signal?: AbortSignal): Promise<ReplyDecision | null> {
    this.#env.append({ schema: 1, kind: 'reply-finished', reply: reply.id });
    if (!reply.text.trim()) return { dialogue: [], continue: false };
    signal?.throwIfAborted();
    const chatFiles = chatFilesOf(this.#state);
    const inchat = inchatRelativeFiles(this.#state.root, chatFiles);
    const current = new Set(inchat);
    const all = await allRelativeFiles(this.#state.root, chatFiles, this.#env.ports.git);
    const mentioned = getFileMentions({ content: reply.text, inchat, readOnly: this.#state.files.readOnly.map((path) => getRelFname(this.#state.root, path)), addable: all, ignoreCurrent: true });
    const mentionedRel = [...mentioned];
    if (mentionedRel.length === current.size && mentionedRel.every((path) => current.has(path))) return { dialogue: [], continue: false };
    const lifecycle = this.#state.lifecycle;
    if (lifecycle.kind !== 'active' || lifecycle.reflectionsSent >= MAX_REFLECTIONS - 1) return { dialogue: [], continue: false };
    const editable = mentionedRel.map((path) => absRootPath(this.#state.root, path));
    this.save({ ...this.#state, files: { ...this.#state.files, editable } });
    return this.reflect(contextPrompts.tryAgain, reply.id, []);
  }

  /** Architect mode. Confirm, then continue into a fresh editor request. */
  async completeArchitect(reply: Extract<CompletedReply, { kind: 'complete' }>, signal?: AbortSignal): Promise<ReplyDecision | null> {
    if (!reply.text.trim()) {
      this.#env.append({ schema: 1, kind: 'reply-finished', reply: reply.id });
      return { dialogue: [], continue: false };
    }
    signal?.throwIfAborted();
    if (!this.#env.ports.edit.autoAcceptArchitect) {
      const accepted = await this.#env.host.confirm({ question: 'Edit the files?' });
      if (!accepted) {
        this.#env.append({ schema: 1, kind: 'reply-finished', reply: reply.id });
        return { dialogue: [], continue: false };
      }
    }
    const main = this.#state.physicalModel;
    if (main === null) throw new Error('No physical maintainer model is bound');
    const resolved = this.#env.resolveEditorModel?.(this.#env.ports.edit.editorModel, main);
    if (this.#env.ports.edit.editorModel && resolved === null) throw new Error(`Editor model ${this.#env.ports.edit.editorModel} is not available`);
    const editorModel = resolved ?? main;
    const format = this.#env.ports.edit.editorEditFormat;
    if (!this.#env.ports.edit.formats.has(format)) throw new Error(`Editor format ${format} is not implemented`);
    this.save({
      ...this.#state,
      mode: format,
      physicalModel: editorModel,
      phase: { kind: 'editor', format, parentMode: 'architect', parentModel: main, architectReplyId: reply.id },
    });
    this.#env.append({ schema: 1, kind: 'reply-finished', reply: reply.id });
    const lifecycle = this.#state.lifecycle;
    if (lifecycle.kind === 'active') this.save({ ...this.#state, lifecycle: { ...lifecycle, waitingFor: reply.id } });
    return { dialogue: [{ text: reply.text, ack: null, purpose: 'editor-input', reply: reply.id }], continue: true };
  }

  async recordEdited(_prepared: readonly (string | null)[], reply: Extract<CompletedReply, { kind: 'complete' }>, signal?: AbortSignal): Promise<DialogueFact[]> {
    const written = this.writtenRelPaths();
    if (!written.length) return [];
    if (!this.#env.ports.edit.dryRun) await this.#env.ports.git.autoCommit(new Set(written), { kind: 'conversation', text: reply.text }, signal);
    this.save({ ...this.#state, historyThrough: reply.id });
    return this.#prompts?.filesContentGptEditsNoRepo ? [{ text: this.#prompts.filesContentGptEditsNoRepo, ack: 'Ok.', purpose: 'saved', reply: reply.id }] : [];
  }

  async validateWritten(signal?: AbortSignal): Promise<string | null> {
    const written = this.writtenRelPaths();
    if (!written.length) return null;
    const outcome = await this.#env.ports.lint.lintEdited(new Set(written), signal);
    if (outcome.kind !== 'failed') return null;
    if (!this.#env.ports.edit.dryRun) await this.#env.ports.git.autoCommit(new Set(written), { kind: 'linter' }, signal);
    if (!(await this.#env.host.confirm({ question: 'Attempt to fix lint errors?' }))) return null;
    return outcome.report;
  }

  writtenRelPaths(): string[] {
    const lifecycle = this.#state.lifecycle;
    if (lifecycle.kind !== 'active') return [];
    return lifecycle.writtenPaths.map((path) => getRelFname(this.#state.root, path));
  }

  reportApplicationError(error: unknown): string {
    const reflection = error instanceof Error ? error.message : String(error);
    if (error instanceof ValueError) {
      this.#env.host.error('The LLM did not conform to the edit format.');
      this.#env.host.output('https://aider.chat/docs/troubleshooting/edit-errors.html');
    } else this.#env.host.error('Exception while updating files:');
    this.#env.host.error(reflection);
    return reflection;
  }

  async checkForFileMentions(content: string, signal?: AbortSignal): Promise<string | null> {
    const chatFiles = chatFilesOf(this.#state);
    const inchat = inchatRelativeFiles(this.#state.root, chatFiles);
    const readOnly = this.#state.files.readOnly.map((path) => getRelFname(this.#state.root, path));
    const all = await allRelativeFiles(this.#state.root, chatFiles, this.#env.ports.git);
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
    if (await this.#env.ports.git.needToAdd(path)) await this.#env.ports.git.stageNewFile(full);
    this.save({ ...this.#state, files: { ...this.#state.files, editable: [...new Set([...this.#state.files.editable, full])] } });
    return true;
  }

  async applyPlan(plan: EditPlan, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted();
    const dryRun = this.#env.ports.edit.dryRun;
    try {
      await plan.apply();
    } finally {
      const paths = dryRun ? [...new Set(plan.targets.filter((path): path is string => path !== null))] : this.writtenRelPaths();
      for (const path of paths) this.#env.host.output(dryRun ? `Did not apply edit to ${path} (--dry-run)` : `Applied edit to ${path}`);
    }
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
