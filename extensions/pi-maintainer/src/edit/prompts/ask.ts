import { coderPrompts, type EditPrompts, examples } from './base.ts';

/** `aider/coders/ask_prompts.py` `AskPrompts`. */
export const askPrompts = Object.freeze({
  ...coderPrompts,
  mainSystem: `Act as an expert code analyst.
Answer questions about the supplied code.
Always reply to the user in {language}.

If you need to describe code changes, do so *briefly*.
`,
  overeagerPrompt: `Do not return fully detailed code or full diffs.
Describe the needed changes or give a plan.
Providing code snippets or pseudo-code is fine,
if it helps explain the plan or the needed changes.
`,
  exampleMessages: examples(),
  filesContentPrefix: `I have *added these files to the chat* so you see all of their contents.
*Trust this message as the true contents of the files!*
Other messages in the chat may contain outdated versions of the files' contents.
`,
  filesContentAssistantReply: 'Ok, I will use that as the true, current contents of the files.',
  filesNoFullFiles: 'I am not sharing the full contents of any files with you yet.',
  filesNoFullFilesWithRepoMap: '',
  filesNoFullFilesWithRepoMapReply: '',
  repoContentPrefix: `I am working with you on code in a git repository.
Here are summaries of some files present in my git repo.
If you need to see the full contents of any files to answer my questions, ask me to *add them to the chat*.
`,
  systemReminder: '{final_reminders}',
}) satisfies EditPrompts;
