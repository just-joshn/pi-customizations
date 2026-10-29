import { EDIT_FORMAT_NAMES } from '../feature.ts';
import { booleanOption, intOption, listOption, stringOption, tristateOption } from '../settings/spec.ts';

/** The edit SAR's options from `aider/args.py`, with Aider's defaults and help text. */
export const editOptions = {
  editFormat: stringOption({
    name: 'edit-format',
    aliases: ['chat-mode'],
    defaultValue: null,
    choices: EDIT_FORMAT_NAMES,
    constFlags: [{ name: 'architect', value: 'architect', help: 'Use architect edit format for the main chat' }],
    help: 'Specify what edit format the LLM should use (default depends on model)',
    sar: 'edit',
  }),
  autoAcceptArchitect: booleanOption({ name: 'auto-accept-architect', defaultValue: true, negatable: true, help: 'Enable/disable automatic acceptance of architect changes (default: True)', sar: 'edit' }),
  weakModel: stringOption({
    name: 'weak-model',
    defaultValue: null,
    help: 'Specify the model to use for commit messages and chat history summarization (default depends on --model)',
    sar: 'edit',
  }),
  maxChatHistoryTokens: intOption({
    name: 'max-chat-history-tokens',
    defaultValue: null,
    help: "Soft limit on tokens for chat history, after which summarization begins. If unspecified, defaults to the model's max_chat_history_tokens.",
    sar: 'edit',
  }),
  editorModel: stringOption({ name: 'editor-model', defaultValue: null, help: 'Specify the model to use for editor tasks (default depends on --model)', sar: 'edit' }),
  editorEditFormat: stringOption({ name: 'editor-edit-format', defaultValue: null, choices: EDIT_FORMAT_NAMES, help: 'Specify the edit format for the editor model (default: depends on editor model)', sar: 'edit' }),
  yesAlways: tristateOption({ name: 'yes-always', negatable: false, help: 'Always say yes to every confirmation', sar: 'edit' }),
  dryRun: booleanOption({ name: 'dry-run', defaultValue: false, negatable: true, help: 'Perform a dry run without modifying files (default: False)', sar: 'edit' }),
  encoding: stringOption({ name: 'encoding', defaultValue: 'utf-8', help: 'Specify the encoding for input and output (default: utf-8)', sar: 'edit' }),
  lineEndings: stringOption({ name: 'line-endings', defaultValue: 'platform', choices: ['platform', 'lf', 'crlf'], help: 'Line endings to use when writing files (default: platform)', sar: 'edit' }),
  file: listOption({ name: 'file', help: 'specify a file to edit (can be used multiple times)', sar: 'edit' }),
  read: listOption({ name: 'read', help: 'specify a read-only file (can be used multiple times)', sar: 'edit' }),
  messageFile: stringOption({
    name: 'message-file',
    defaultValue: null,
    help: 'Specify a file containing the message to send the LLM, process reply, then exit (disables chat mode)',
    sar: 'edit',
  }),
  apply: stringOption({ name: 'apply', defaultValue: null, help: 'Apply the changes from the given file instead of running the chat (debug)', sar: 'edit' }),
  suggestShellCommands: booleanOption({ name: 'suggest-shell-commands', defaultValue: true, negatable: true, help: 'Enable/disable suggesting shell commands (default: True)', sar: 'edit' }),
  setEnv: listOption({ name: 'set-env', help: 'Set an environment variable (to control API settings, can be used multiple times)', sar: 'edit' }),
  apiKey: listOption({
    name: 'api-key',
    help: 'Set an API key for a provider (eg: --api-key provider=<key> sets PROVIDER_API_KEY=<key>)',
    sar: 'edit',
  }),
  chatLanguage: stringOption({ name: 'chat-language', defaultValue: null, help: 'Specify the language to use in the chat (default: None, uses system settings)', sar: 'edit' }),
  verbose: booleanOption({ name: 'verbose', defaultValue: false, negatable: false, help: 'Enable verbose output', sar: 'edit' }),
} as const;

export const editOptionList = Object.values(editOptions);
