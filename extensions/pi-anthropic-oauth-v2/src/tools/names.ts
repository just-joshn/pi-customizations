import type { Tool } from '@earendil-works/pi-ai';

/** Translates tool names between Pi and the wire, so callers never branch on the sign-in mode. */
export type NameCodec = {
  readonly toWire: (name: string) => string;
  readonly fromWire: (name: string) => string;
};

const CLAUDE_CODE_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob', 'AskUserQuestion', 'TodoWrite', 'WebFetch', 'WebSearch'];

const claudeCodeNames: ReadonlyMap<string, string> = new Map(CLAUDE_CODE_TOOLS.map((name) => [name.toLowerCase(), name]));

const keepName = (name: string): string => name;

const PASSTHROUGH: NameCodec = { toWire: keepName, fromWire: keepName };

/** OAuth requests must call Claude Code's tools by their Claude Code names. API-key requests keep Pi's names. */
export function createNameCodec(isOAuth: boolean, tools: readonly Tool[]): NameCodec {
  if (!isOAuth) return PASSTHROUGH;
  return {
    toWire: (name) => claudeCodeNames.get(name.toLowerCase()) ?? name,
    fromWire: (name) => tools.find((tool) => tool.name.toLowerCase() === name.toLowerCase())?.name ?? name,
  };
}
