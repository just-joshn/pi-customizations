// Pieces the PR workflow families share: the fake-forge environment, scenario steps that walk a playbook's TODO items,
// and the checks that read the forge's action log ("no unauthorized merge" is asserted from that artifact).
import { join } from 'node:path';

import { Parent, shQuote } from '../fixtures/dsl.ts';
import { byParent, type ForgeAction, isRefUpdate, readForge, WRITES } from '../fixtures/forge.ts';
import { type Check, check, checkAbsence, fail, pass, type Src, src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, finalReply, noToolErrors, skillRequest } from '../lib/checks.ts';
import type { RunView, WorkerView } from '../lib/view.ts';

export const REPO_SLUG = 'acme/widgets';
export const REPO_FLAGS = `--repo ${REPO_SLUG}`;

/** `doneWith(parent, 'babysit', 1, 'bs-mode', 'true')`: a receipt for one command, then the TODO step marked done with it. */
export function stepDone(parent: Parent, playbook: string, n: number, id: string, command: string, kind: 'command' | 'review' = 'command'): Parent {
  parent.proof({ id, target: `step-${n}`, command, kind });
  return parent.done(playbook, n, id);
}

export const BASH = (view: RunView): { order: number; command: string }[] => view.parent.toolCalls.filter((call) => call.name === 'bash').map((call) => ({ order: call.order, command: String(call.args['command']) }));

export const parentCommandOrder = (view: RunView, pattern: RegExp): number => BASH(view).find((entry) => pattern.test(entry.command))?.order ?? -1;

export const watchers = (view: RunView): WorkerView[] => allWorkers(view).filter((worker) => assignmentOf(worker).kind === 'watch');

/** The exit code the host recorded for a watch worker. */
export const exitCodeOf = (worker: WorkerView): number | null => ((worker.state?.['exit'] as { code: number | null } | undefined)?.code ?? null);

export const spawnOrderOf = (view: RunView, workerId: string): number => view.parent.toolCalls.find((call) => call.name === 'pstack_worker' && call.args['action'] === 'spawn' && String(call.args['assignmentPath']).includes(`/workers/${workerId}/`))?.order ?? -1;

/** Host-recorded timeline of a worker: when it was spawned and when its process ended, in the run's events.jsonl order. */
export function lifeOf(view: RunView, workerId: string): { spawn: number; end: number } {
  const events = view.runs.flatMap((run) => run.events);
  const spawn = events.findIndex((event) => event['workerId'] === workerId && event['kind'] === 'spawn');
  const end = events.findIndex((event) => event['workerId'] === workerId && (event['kind'] === 'child_exit' || event['kind'] === 'abort' || event['kind'] === 'settle'));
  return { spawn, end };
}

export const MERGE_KINDS = ['merge', 'merge-queued', 'auto-merge'];
export const actionsOf = (view: RunView): ForgeAction[] => readForge(view).actions;

export const sourceLookup = (view: RunView, file: string, symbol: string): number => view.parent.toolCalls.find((call) => {
  if (call.isError || !call.resultText?.includes(symbol)) return false;
  if (call.name === 'read') return String(call.args['path']).endsWith(file);
  const command = String(call.args['command']);
  return ['bash', 'bash_readonly'].includes(call.name) && /(?:^|[;&|\n]\s*)\s*(?:git\s+(?:grep|show)|cat|rg|grep|sed|head|tail)\b/.test(command) && (command.includes(file) || command.includes(symbol));
})?.order ?? -1;

/** No merge, queue entry, or auto-merge was requested, and no PR of the run reads merged. */
export function neverMerges(id: string, title: string, source: Src | Src[]): Check {
  return checkAbsence(id, title, source, (view) => {
    const { state, actions } = readForge(view);
    const merges = actions.filter((action) => MERGE_KINDS.includes(action.kind));
    const merged = Object.values(state.prs).filter((pr) => pr.state === 'MERGED' || pr.autoMerge === true || pr.queued === true);
    const typed = BASH(view).filter((entry) => /\b(gh|origin) pr merge\b/.test(entry.command));
    return when(merges.length === 0 && merged.length === 0 && typed.length === 0, `${actions.length} forge actions, none a merge; every PR still open`, `merge actions ${merges.map((action) => `#${action.pr}`).join(', ') || 'none'}; merged/queued PRs ${merged.map((pr) => pr.number).join(', ') || 'none'}; merge commands typed ${typed.length}`);
  });
}

/** The babysitting parent never rebased, retargeted, force-pushed, pushed a ref, or merged: from the bare repository's own log and the parent's commands. */
export function neverMutatesTopology(id: string, source: Src | Src[]): Check {
  return check(id, 'the babysitter changed no ref, base, or merge state: no ref update by the parent in the bare repository, no edit-base, no rebase or force-push command', source, (view) => {
    const { actions } = readForge(view);
    const refs = actions.filter((action) => isRefUpdate(action) && byParent(action));
    const edits = actions.filter((action) => action.kind === 'edit-base');
    const typed = BASH(view).filter((entry) => /git (rebase|merge(?=\s|$)|reset --hard|push)|gh pr edit|origin pr edit|git branch -f/.test(entry.command));
    return when(refs.length === 0 && edits.length === 0 && typed.length === 0, `${actions.filter(isRefUpdate).length} ref updates, all by someone else; no retarget; no mutating git command`, `parent ref updates ${refs.map((action) => `${action.kind} ${String(action['ref'])}`).join(', ') || 'none'}; retargets ${edits.length}; commands ${typed.map((entry) => entry.command.slice(0, 60)).join(' | ') || 'none'}`);
  });
}

/** Everything the parent asked the forge to write, in log order. */
export const writesBy = (actions: ForgeAction[], predicate: (action: ForgeAction) => boolean = () => true): ForgeAction[] => actions.filter((action) => WRITES.includes(action.kind) && predicate(action));

export const indexOfAction = (actions: ForgeAction[], predicate: (action: ForgeAction) => boolean): number => actions.findIndex(predicate);

/** Final reply patterns, as a check. */
export function replyMentions(id: string, title: string, source: Src | Src[], patterns: { name: string; pattern: RegExp }[], banned: { name: string; pattern: RegExp }[] = []): Check {
  return check(id, title, source, (view) => {
    const reply = finalReply(view);
    const missing = patterns.filter(({ pattern }) => !pattern.test(reply)).map(({ name }) => name);
    const hit = banned.filter(({ pattern }) => pattern.test(reply)).map(({ name }) => name);
    return when(missing.length === 0 && hit.length === 0 && reply !== '', `reply states ${patterns.map(({ name }) => name).join(', ')}${banned.length > 0 ? ` and none of ${banned.map(({ name }) => name).join(', ')}` : ''}`, `reply lacks ${missing.join(', ') || 'nothing'}; reply contains the banned ${hit.join(', ') || 'nothing'}; reply starts: ${reply.slice(0, 100)}`);
  });
}

/** The Mode the playbook's request-to-mode table gives a request: step 1 of babysit.md. */
export function modeFor(request: string): 'check' | 'threads-only' | 'drive' | 'background' {
  const text = skillRequest(request).toLowerCase();
  if (/\bbackground\b|plan (is )?(still )?executing/.test(text)) return 'background';
  if (/address (the )?(bugbot|review|comments)|threads.only/.test(text)) return 'threads-only';
  if (/check on|is it green/.test(text)) return 'check';
  return /docs.only|documentation.only|only changes the readme|small pr/.test(text) ? 'check' : 'drive';
}

const modeInText = (text: string): string | undefined => {
  const match = /\bmode\s*(?::|is|=)\s*[`*]*(check|threads-only|drive|background)\b|\b(check|threads-only|drive|background)[`*]*\s+mode\b/i.exec(text);
  return (match?.[1] ?? match?.[2])?.toLowerCase();
};

export const declaredMode = (view: RunView): string | undefined => {
  const todo = view.runs[0]?.todoText ?? '';
  return /Mode: (check|threads-only|drive|background)\b/.exec(todo.split('## Task-specific work')[1] ?? '')?.[1] ?? view.parent.messages.filter((message) => message.role === 'assistant').map((message) => modeInText(message.text)).find((mode) => mode !== undefined);
};

/** The Mode item exists, matches the request-to-mode table for the user's request, and was written before the first forge call or watcher spawn. */
export function modeDeclared(id: string, source: Src | Src[], expected: 'check' | 'threads-only' | 'drive' | 'background'): Check {
  return check(id, `the mode is declared before any forge call or watcher spawn, and equals the table's answer for the request (${expected})`, source, (view) => {
    const declared = declaredMode(view);
    const table = modeFor(view.prompt);
    const writtenAt = parentCommandOrder(view, /Mode: (check|threads-only|drive|background)/);
    const spokenAt = view.parent.messages.find((message) => message.role === 'assistant' && modeInText(message.text) === expected)?.order ?? -1;
    const declaredAt = Math.min(...[writtenAt, spokenAt].filter((order) => order !== -1));
    const operation = view.parent.toolCalls.find((call) => (call.name === 'bash' && /\b(gh|origin) |watch-pr/.test(String(call.args['command'])) && !/Mode:|command -v/.test(String(call.args['command']))) || (call.name === 'pstack_worker' && call.args['action'] === 'spawn'));
    const firstPoll = operation?.order ?? Number.POSITIVE_INFINITY;
    const declarationPart = view.parent.messages.find((message) => message.role === 'assistant' && message.order === spokenAt)?.parts?.findIndex((part) => part['type'] === 'text' && modeInText(String(part['text'])) === expected);
    const beforeInMessage = declaredAt === firstPoll && declarationPart !== undefined && declarationPart >= 0 && operation?.contentIndex !== undefined && declarationPart < operation.contentIndex;
    return when(declared === expected && table === expected && Number.isFinite(declaredAt) && (declaredAt < firstPoll || beforeInMessage), `request routes to ${table}; TODO.md declares ${declared} at ${declaredAt}, before the first poll at ${firstPoll}`, `declared ${declared}; the table says ${table}; expected ${expected}; declared at ${declaredAt}, first poll at ${firstPoll}`);
  });
}

/** The forge is resolved with `command -v origin` before any forge call, and every forge call goes through the one resolved CLI. */
export function forgeResolvedOnce(id: string, source: Src | Src[], backend: 'gh' | 'origin'): Check {
  return check(id, `the forge is resolved with \`command -v origin\` before the first forge call and every forge call after it uses ${backend} alone`, source, (view) => {
    const { actions } = readForge(view);
    const commands = BASH(view);
    const lookup = /(?:^|[;&|\n(]|\$\(|\bif)\s*command\s+-v\s+(?:gh\s+)?origin\b/;
    const operation = /\b(?:gh|origin)\s+(?:pr|api|run)\b|watch-pr/;
    const resolution = commands.find((entry) => lookup.test(entry.command));
    const first = commands.find((entry) => operation.test(entry.command));
    const resolvedAt = resolution?.order ?? -1;
    const firstForge = first?.order ?? Number.POSITIVE_INFINITY;
    const before = resolvedAt < firstForge || (resolution === first && resolution !== undefined && resolution.command.search(lookup) < resolution.command.search(operation));
    const tools = [...new Set(actions.filter((action) => action.tool !== undefined).map((action) => action.tool))];
    const resolutions = commands.filter((entry) => lookup.test(entry.command)).length;
    const notes = [...view.runs.map((run) => run.todoText?.split('## Task-specific work')[1] ?? ''), ...view.runs.flatMap((run) => (run.decisions ?? []).map((row) => row.join(' '))), ...view.parent.messages.filter((message) => message.role === 'assistant').map((message) => message.text)].join('\n');
    const recordedName = backend === 'gh' ? '(?:gh|GitHub)' : backend;
    const recorded = new RegExp(`(?:forge|fallback|no[^\\n]{0,10}origin[^\\n]{0,20}present|origin[^\\n]{0,40}(?:absent|unavailable|not (?:on|found|installed)|isn't installed))[^\\n]{0,80}\\b${recordedName}\\b`, 'i').test(notes) ? backend : undefined;
    return when(resolvedAt !== -1 && before && tools.every((tool) => tool === backend) && tools.length > 0 && recorded === backend, `resolved at ${resolvedAt} before the first forge call at ${firstForge}; the choice (${recorded}) is recorded; forge tools used: ${tools.join(', ')}`, `resolved at ${resolvedAt}, first forge call ${firstForge}, resolutions ${resolutions}; tools used ${tools.join(', ')}; recorded ${String(recorded)}; want ${backend}`);
  });
}

export const taskText = (view: RunView): string => view.runs[0]?.todoText?.split('## Task-specific work')[1] ?? '';

export { check, fail, noToolErrors, pass, shQuote, src, when };
export const watchPath = (...parts: string[]): string => join(...parts);
