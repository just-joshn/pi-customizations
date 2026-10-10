import { type AssistantMessage, getCurrentSystemMessage, type ImageContent } from '@earendil-works/pi-ai';
import type { ContextWithSystemEvent, ProjectedSessionEntry } from '@earendil-works/pi-coding-agent';
import { BRANDING } from '../branding.ts';
import { chooseFence, type Fence } from '../edit/fences.ts';
import type { Notices, WorkingTree } from '../edit/working-tree.ts';
import type { EditFormatName } from '../feature.ts';
import { strip } from '../support/pystr.ts';
import { chatFilesOf, type Snapshot } from './branch.ts';
import { type ChatFiles, getRelFname, isImageFile, readText, withoutEditable } from './chat-files.ts';
import { type Dialogue, defaultPromptPolicy, type PromptPolicy, type PromptSet, type PromptSource } from './prompts.ts';

export type ContextMessage = ContextWithSystemEvent['messages'][number];
export type FileContent = readonly [path: string, content: string];

export function getFilesContent(root: string, contents: readonly FileContent[], fence: Fence): string {
  return contents
    .filter(([path]) => !isImageFile(path))
    .map(([path, content]) => `\n${getRelFname(root, path)}\n${fence[0]}\n${content}${fence[1]}\n`)
    .join('');
}

export async function readChatFiles(snapshot: Snapshot, tree: WorkingTree, notices: Notices) {
  let files: ChatFiles = chatFilesOf(snapshot);
  const editable: FileContent[] = [];
  const readOnly: FileContent[] = [];
  for (const path of files.editable) {
    const content = await readText(path, tree, notices);
    if (content === null) {
      notices.warning(`Dropping ${getRelFname(snapshot.root, path)} from the chat.`);
      files = withoutEditable(files, path);
    } else editable.push([path, content]);
  }
  for (const path of files.readOnly) {
    const content = await readText(path, tree, notices);
    if (content !== null) readOnly.push([path, content]);
  }
  return { editable, readOnly, files: { editable: [...files.editable], readOnly: [...files.readOnly] } };
}

const usage = (): AssistantMessage['usage'] => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } });

function dialogue(message: Dialogue, model: { provider: string; id: string }, timestamp: number): ContextMessage {
  if (message.role === 'user') return { role: 'user', content: message.content, timestamp };
  return { role: 'assistant', content: [{ type: 'text', text: message.content }], provider: model.provider, model: model.id, api: 'request-only-acknowledgment', usage: usage(), stopReason: 'stop', timestamp };
}

function expandDialogue(messages: readonly ContextMessage[], model: { provider: string; id: string }): ContextMessage[] {
  return messages.flatMap((message): ContextMessage[] => {
    if (message.role !== 'custom' || message.customType !== BRANDING.dialogueEntry) return [message];
    const details: unknown = message.details;
    if (typeof details !== 'object' || details === null || !('ack' in details) || typeof details.ack !== 'string') return [message];
    return [message, dialogue({ role: 'assistant', content: details.ack }, model, message.timestamp)];
  });
}

export function partitionHistory(incoming: readonly ContextMessage[], projected: readonly ProjectedSessionEntry[], cut: string | null) {
  const contributions = projected.flatMap((entry) => entry.messages.filter((message) => message.role !== 'system').map((message) => ({ id: entry.sourceEntry.id, message })));
  const sameShape = contributions.length === incoming.length && contributions.every((entry, index) => entry.message.role === incoming[index]?.role);
  if (!sameShape) return { done: [], current: [...incoming], partition: 'unpartitioned' };
  const index = cut === null ? -1 : contributions.findIndex((entry) => entry.id === cut);
  if (cut !== null && index < 0) return { done: [], current: [...incoming], partition: 'unpartitioned' };
  return { done: incoming.slice(0, index + 1), current: incoming.slice(index + 1), partition: 'position-preserving' };
}

function examples(prompts: PromptSet, policy: PromptPolicy): { main: string; examples: Dialogue[] } {
  let main = policy.systemPromptPrefix ? `${policy.systemPromptPrefix}\n${prompts.mainSystem}` : prompts.mainSystem;
  if (policy.examplesAsSystemMessage) {
    if (prompts.exampleMessages.length) main += '\n# Example conversations:\n\n';
    for (const message of prompts.exampleMessages) main += `## ${message.role.toUpperCase()}: ${message.content}\n\n`;
    main = strip(main);
    return { main, examples: [] };
  }
  const reset: Dialogue[] = prompts.exampleMessages.length
    ? [
        { role: 'user', content: "I switched to a new code base. Please don't consider the above files or try to edit them any longer." },
        { role: 'assistant', content: 'Ok.' },
      ]
    : [];
  return { main, examples: [...prompts.exampleMessages, ...reset] };
}

const mimeTypes: Readonly<Record<string, string>> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', bmp: 'image/bmp', tiff: 'image/tiff', webp: 'image/webp' };

function images(root: string, contents: readonly FileContent[], timestamp: number): ContextMessage[] {
  const content = contents.flatMap(([path, data]): ({ type: 'text'; text: string } | ImageContent)[] => {
    const mimeType = mimeTypes[path.split('.').at(-1) ?? ''];
    return mimeType
      ? [
          { type: 'text', text: `Image file: ${getRelFname(root, path)}` },
          { type: 'image', data, mimeType },
        ]
      : [];
  });
  return content.length ? [{ role: 'user', content, timestamp }] : [];
}

export interface RequestView {
  readonly messages: readonly ContextMessage[];
  readonly projection: readonly ProjectedSessionEntry[];
  readonly supportsImages: boolean;
}

export interface ContextInputs {
  readonly snapshot: Snapshot;
  readonly view: RequestView;
  readonly tree: WorkingTree;
  readonly notices: Notices;
  readonly source: PromptSource;
  readonly promptFormat: EditFormatName;
  readonly suggestShellCommands: boolean;
  readonly policy?: PromptPolicy | undefined;
  readonly repository?: string | null;
}

export async function projectRequest(input: ContextInputs) {
  const { snapshot } = input;
  const model = snapshot.physicalModel;
  if (model === null) throw new Error('No physical maintainer model is bound');
  const contents = await readChatFiles(snapshot, input.tree, input.notices);
  const chosen = chooseFence(
    contents.editable.map(([, text]) => text),
    contents.readOnly.map(([, text]) => text),
  );
  for (const warning of chosen.warnings) input.notices.warning(warning);
  const prompts = await input.source.get(input.promptFormat, { model, root: snapshot.root, fence: chosen.fence, suggestShellCommands: input.suggestShellCommands });
  const assembled = assembleRequest({ input, contents, fence: chosen.fence, prompts, model });
  return { prompts, fence: chosen.fence, files: contents.files, ...assembled };
}

function assembleRequest({ input, contents, fence, prompts, model }: { input: ContextInputs; contents: Awaited<ReturnType<typeof readChatFiles>>; fence: Fence; prompts: PromptSet; model: { provider: string; id: string } }) {
  const { snapshot, view } = input;
  const policy = input.policy ?? defaultPromptPolicy;
  const prompt = examples(prompts, policy);
  const main = prompt.main + (prompts.systemReminder ? `\n${prompts.systemReminder}` : '');
  const folded = getCurrentSystemMessage(view.messages) ?? { role: 'system', content: '', timestamp: Date.now() };
  const timestamp = folded.timestamp;
  const convert = (items: readonly Dialogue[]) => items.map((item) => dialogue(item, model, timestamp));
  const pair = (text: string, ack: string) =>
    text
      ? convert([
          { role: 'user', content: text },
          { role: 'assistant', content: ack },
        ])
      : [];
  const history = partitionHistory(
    view.messages.filter((message) => message.role !== 'system'),
    view.projection,
    snapshot.historyThrough,
  );
  const readOnlyText = getFilesContent(snapshot.root, contents.readOnly, fence);
  const filesText = contents.files.editable.length
    ? prompts.filesContentPrefix + getFilesContent(snapshot.root, contents.editable, fence)
    : input.repository && prompts.filesNoFullFilesWithRepoMap
      ? prompts.filesNoFullFilesWithRepoMap
      : prompts.filesNoFullFiles;
  const filesAck = contents.files.editable.length ? prompts.filesContentAssistantReply : input.repository && prompts.filesNoFullFilesWithRepoMap ? prompts.filesNoFullFilesWithRepoMapReply : 'Ok.';
  const readOnlyImages = view.supportsImages ? images(snapshot.root, contents.readOnly, timestamp) : [];
  const editableImages = view.supportsImages ? images(snapshot.root, contents.editable, timestamp) : [];
  const current = expandDialogue(history.current, model);
  const reminder = tailReminder(current, prompts.systemReminder, policy, timestamp);
  return {
    partition: history.partition,
    messages: [
      { ...folded, sections: { ...folded.sections, preamble: policy.useSystemPrompt ? main : '' } } satisfies ContextMessage,
      ...(!policy.useSystemPrompt ? pair(main, 'Ok.') : []),
      ...convert(prompt.examples),
      ...pair(readOnlyText ? prompts.readOnlyFilesPrefix + readOnlyText : '', 'Ok, I will use these files as references.'),
      ...readOnlyImages,
      ...(readOnlyImages.length ? convert([{ role: 'assistant', content: 'Ok, I will use these images as references.' }]) : []),
      ...pair(input.repository ?? '', "Ok, I won't try and edit those files without asking first."),
      ...expandDialogue(history.done, model),
      ...pair(filesText, filesAck),
      ...editableImages,
      ...(editableImages.length ? convert([{ role: 'assistant', content: 'Ok.' }]) : []),
      ...reminder.current,
      ...reminder.tail,
    ],
  };
}

function tailReminder(current: ContextMessage[], text: string, policy: PromptPolicy, timestamp: number) {
  if (policy.reminder === 'sys' && text) return { current, tail: [{ role: 'system', content: text, timestamp } satisfies ContextMessage] };
  const last = current.at(-1);
  if (policy.reminder === 'user' && text && last?.role === 'user' && typeof last.content === 'string') return { current: [...current.slice(0, -1), { ...last, content: `${last.content}\n\n${text}` }], tail: [] };
  return { current, tail: [] };
}
