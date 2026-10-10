/** One message of an Aider `example_messages` list. */
export interface ExampleMessage {
  readonly role: 'user' | 'assistant';
  readonly content: string;
}

/** `aider/coders/base_prompts.py` `CoderPrompts`: every prompt attribute, camelCased. */
export interface CoderPrompts {
  readonly systemReminder: string;
  readonly filesContentGptEdits: string;
  readonly filesContentGptEditsNoRepo: string;
  readonly filesContentGptNoEdits: string;
  readonly filesContentLocalEdits: string;
  readonly lazyPrompt: string;
  readonly overeagerPrompt: string;
  readonly exampleMessages: readonly ExampleMessage[];
  readonly filesContentPrefix: string;
  readonly filesContentAssistantReply: string;
  readonly filesNoFullFiles: string;
  readonly filesNoFullFilesWithRepoMap: string;
  readonly filesNoFullFilesWithRepoMapReply: string;
  readonly repoContentPrefix: string;
  readonly readOnlyFilesPrefix: string;
  readonly shellCmdPrompt: string;
  readonly shellCmdReminder: string;
  readonly noShellCmdPrompt: string;
  readonly noShellCmdReminder: string;
  readonly renameWithShell: string;
  readonly goAheadTip: string;
}

/** The prompts of a coder Aider can run. Every `CoderPrompts` subclass defines `main_system`. */
export interface EditPrompts extends CoderPrompts {
  readonly mainSystem: string;
}

/** Freezes an `example_messages` list and each message in it. */
export const examples = (...messages: readonly ExampleMessage[]): readonly ExampleMessage[] => Object.freeze(messages.map((message) => Object.freeze({ ...message })));

/** `aider/coders/base_prompts.py` `CoderPrompts`. */
export const coderPrompts: CoderPrompts = Object.freeze({
  systemReminder: '',
  filesContentGptEdits: 'I committed the changes with git hash {hash} & commit msg: {message}',
  filesContentGptEditsNoRepo: 'I updated the files.',
  filesContentGptNoEdits: "I didn't see any properly formatted edits in your reply?!",
  filesContentLocalEdits: 'I edited the files myself.',
  lazyPrompt: `You are diligent and tireless!
You NEVER leave comments describing code without implementing it!
You always COMPLETELY IMPLEMENT the needed code!
`,
  overeagerPrompt: `Pay careful attention to the scope of the user's request.
Do what they ask, but no more.
Do not improve, comment, fix or modify unrelated parts of the code in any way!
`,
  exampleMessages: examples(),
  filesContentPrefix: `I have *added these files to the chat* so you can go ahead and edit them.

*Trust this message as the true contents of these files!*
Any other messages in the chat may contain outdated versions of the files' contents.
`,
  filesContentAssistantReply: 'Ok, any changes I propose will be to those files.',
  filesNoFullFiles: 'I am not sharing any files that you can edit yet.',
  filesNoFullFilesWithRepoMap: `Don't try and edit any existing code without asking me to add the files to the chat!
Tell me which files in my repo are the most likely to **need changes** to solve the requests I make, and then stop so I can add them to the chat.
Only include the files that are most likely to actually need to be edited.
Don't include files that might contain relevant context, just files that will need to be changed.
`,
  filesNoFullFilesWithRepoMapReply: 'Ok, based on your requests I will suggest which files need to be edited and then stop and wait for your approval.',
  repoContentPrefix: `Here are summaries of some files present in my git repository.
Do not propose changes to these files, treat them as *read-only*.
If you need to edit any of these files, ask me to *add them to the chat* first.
`,
  readOnlyFilesPrefix: `Here are some READ ONLY files, provided for your reference.
Do not edit these files!
`,
  shellCmdPrompt: '',
  shellCmdReminder: '',
  noShellCmdPrompt: '',
  noShellCmdReminder: '',
  renameWithShell: '',
  goAheadTip: '',
});
