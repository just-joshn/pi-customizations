import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { installMaintainer, type MaintainerOptions } from '../../src/core/install.ts';
import type { PromptSource } from '../../src/core/prompts.ts';
import { editFeature } from '../../src/edit/feature.ts';

export const testPrompts: PromptSource = {
  get: () => ({
    mainSystem: 'TEST MAIN',
    systemReminder: 'TEST REMINDER',
    exampleMessages: [],
    filesContentPrefix: 'EDITABLE',
    filesContentAssistantReply: 'Ok, any changes I propose will be to those files.',
    filesNoFullFiles: 'NO EDITABLE FILES',
    filesNoFullFilesWithRepoMap: '',
    filesNoFullFilesWithRepoMapReply: '',
    readOnlyFilesPrefix: 'READ ONLY',
    filesContentGptEditsNoRepo: 'I updated the files.',
  }),
};

export const maintainerExtension =
  (options: MaintainerOptions = {}): ExtensionFactory =>
  (pi) =>
    installMaintainer(pi, [editFeature], { promptSource: testPrompts, home: () => '/nonexistent-maintainer-home', processEnvironment: () => ({}), ...options });

export const textOf = (message: { content: unknown }): string =>
  typeof message.content === 'string' ? message.content : Array.isArray(message.content) ? message.content.map((block) => (block.type === 'text' ? block.text : '')).join('') : '';
