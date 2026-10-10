import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { installMaintainer } from '../../../src/core/install.ts';
import type { PromptSource } from '../../../src/core/prompts.ts';
import { editFeature } from '../../../src/edit/feature.ts';

/** Temporary PromptSource until production index wires E7 (CORE.md). */
const journeyPrompts: PromptSource = {
  get: () => ({
    mainSystem: 'JOURNEY MAIN',
    systemReminder: 'JOURNEY REMINDER',
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

export default function journeyHost(pi: ExtensionAPI): void {
  installMaintainer(pi, [editFeature], {
    promptSource: journeyPrompts,
    home: () => '/nonexistent-maintainer-journey-home',
    processEnvironment: () => ({}),
  });
}
