import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, onTestFinished, test } from 'vitest';
import type { Snapshot } from '../../src/core/branch.ts';
import { absRootPath } from '../../src/core/chat-files.ts';
import { ExchangeController } from '../../src/core/exchange.ts';
import type { Host } from '../../src/core/host.ts';
import { diffFormat } from '../../src/edit/feature.ts';
import { REASONING_TAG, removeReasoningContent, replyTextForAuxiliary, textFromAssistantContent } from '../../src/edit/reasoning.ts';
import { createWorkingTree } from '../../src/edit/working-tree.ts';
import { disabledGitPolicy, disabledRepositoryContext, disabledValidation } from '../../src/feature.ts';

const prompts = {
  get: async () => ({
    mainSystem: 'MAIN',
    systemReminder: 'REMINDER',
    exampleMessages: [] as const,
    filesContentPrefix: 'EDITABLE',
    filesContentAssistantReply: 'Ok.',
    filesNoFullFiles: 'NONE',
    filesNoFullFilesWithRepoMap: '',
    filesNoFullFilesWithRepoMapReply: '',
    readOnlyFilesPrefix: 'READ ONLY',
    filesContentGptEditsNoRepo: 'I updated the files.',
  }),
};

function snapshot(root: string, editable: string[]): Snapshot {
  return {
    schema: 1,
    kind: 'snapshot',
    root,
    mode: 'diff',
    phase: { kind: 'main' },
    files: { editable, readOnly: [] },
    originalReadOnly: [],
    returnMode: null,
    ignoredMentions: [],
    neverAsk: [],
    lastUserEntry: 'user-1',
    historyThrough: null,
    physicalModel: { provider: 'test', id: 'scripted' },
    editorModel: null,
    weakModel: null,
    assistantCommits: [],
    lifecycle: { kind: 'active', userEntries: ['user-1'], reflectionsSent: 0, preparedTargets: [], writtenPaths: [], waitingFor: null },
  };
}

async function harness(options: { readonly reasoningTag?: string } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'reasoning-bind-')));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  await writeFile(join(root, 'target.txt'), 'before\n');
  const host: Host = {
    output: () => {},
    warning: () => {},
    error: () => {},
    confirm: async () => true,
    select: async () => undefined,
    exec: async () => ({ stdout: '', stderr: '', code: 0, killed: false }),
  };
  const tree = createWorkingTree({ notices: host });
  const editable = [absRootPath(root, 'target.txt')];
  const controller = new ExchangeController(snapshot(root, editable), {
    ports: {
      edit: {
        formats: new Map([['diff', diffFormat]]),
        requestedFormat: 'diff',
        initialFiles: { editable: [], readOnly: [] },
        messageFile: null,
        applyFile: null,
        dryRun: false,
        yesAlways: true,
        autoAcceptArchitect: true,
        editorModel: null,
        chatLanguage: null,
        editorEditFormat: 'editor-diff',
        tree,
      },
      git: disabledGitPolicy,
      map: disabledRepositoryContext,
      lint: disabledValidation,
    },
    host,
    source: prompts,
    append: () => {},
    suggestShellCommands: false,
    ...(options.reasoningTag !== undefined ? { reasoningTag: options.reasoningTag } : {}),
  });
  await controller.projectRequest({
    messages: [{ role: 'user', content: 'edit', timestamp: Date.now() }],
    projection: [],
    supportsImages: false,
  });
  return { root, controller };
}

const EDIT = `target.txt
<<<<<<< SEARCH
before
=======
after
>>>>>>> REPLACE
`;

test('removeReasoningContent drops paired tags and text before a stray closing tag', {
  meta: {
    aider: ['test_reasoning/TestReasoning.test_remove_reasoning_content', 'aider/reasoning_tags.py:14-40'],
  },
}, () => {
  const tagged = 'Here is <think>some reasoning</think> and regular text';
  expect(removeReasoningContent(tagged, null)).toBe(tagged);
  expect(removeReasoningContent(tagged, undefined)).toBe(tagged);

  const multiline = `Here is some text
<think>
This is reasoning that should be removed
Over multiple lines
</think>
And more text here`;
  expect(removeReasoningContent(multiline, 'think')).toBe(`Here is some text

And more text here`);

  expect(
    removeReasoningContent(
      `Start
<think>Block 1</think>
Middle
<think>Block 2</think>
End`,
      'think',
    ),
  ).toBe(`Start

Middle

End`);

  expect(removeReasoningContent('Just regular text', 'think')).toBe('Just regular text');

  expect(removeReasoningContent('noise</think>\nanswer', 'think')).toBe('answer');

  const wrapped = `<${REASONING_TAG}>
hidden
</${REASONING_TAG}>

visible`;
  expect(removeReasoningContent(wrapped, REASONING_TAG)).toBe('visible');
});

test('Pi thinking content blocks are omitted from reply text before edits', {
  meta: {
    aider: [
      'test_reasoning/TestReasoning.test_send_with_reasoning_content',
      'test_reasoning/TestReasoning.test_send_with_reasoning_content_stream',
      'test_reasoning/TestReasoning.test_send_with_reasoning',
      'test_reasoning/TestReasoning.test_send_with_reasoning_stream',
    ],
  },
}, () => {
  expect(
    textFromAssistantContent([
      { type: 'thinking', thinking: 'My step-by-step reasoning process' },
      { type: 'text', text: 'Final answer after reasoning' },
    ]),
  ).toBe('Final answer after reasoning');
});

test('think tags are stripped from the reply before edits apply', {
  meta: {
    aider: ['test_reasoning/TestReasoning.test_send_with_think_tags', 'test_reasoning/TestReasoning.test_send_with_think_tags_stream', 'aider/coders/base_coder.py:1521-1522,1986-1992'],
  },
}, async () => {
  const h = await harness({ reasoningTag: 'think' });
  const reply = `<think>
do not apply this
target.txt
<<<<<<< SEARCH
before
=======
wrong
>>>>>>> REPLACE
</think>

${EDIT}`;
  const decision = await h.controller.completeReply({ kind: 'complete', id: 'reply-think', text: reply });
  expect(decision.continue).toBe(false);
  expect(await readFile(join(h.root, 'target.txt'), 'utf8')).toBe('after\n');
});

test('default reply tag strips REASONING_TAG wrappers before edits', {
  meta: {
    aider: ['aider/coders/base_coder.py:1521-1522,1986-1992', 'aider/reasoning_tags.py:14-40'],
  },
}, async () => {
  const h = await harness();
  const reply = `<${REASONING_TAG}>
target.txt
<<<<<<< SEARCH
before
=======
wrong
>>>>>>> REPLACE
</${REASONING_TAG}>

${EDIT}`;
  await h.controller.completeReply({ kind: 'complete', id: 'reply-default', text: reply });
  expect(await readFile(join(h.root, 'target.txt'), 'utf8')).toBe('after\n');
});

test('auxiliary replies strip the model reasoning tag', {
  meta: {
    aider: ['test_reasoning/TestReasoning.test_simple_send_with_retries_removes_reasoning', 'aider/models.py:1039-1066'],
  },
}, () => {
  const raw = `Here is some text
<think>
This reasoning should be removed
</think>
And this text should remain`;
  expect(replyTextForAuxiliary(raw, 'think')).toBe(`Here is some text

And this text should remain`);
  expect(replyTextForAuxiliary(raw, null)).toBe(raw);
});
