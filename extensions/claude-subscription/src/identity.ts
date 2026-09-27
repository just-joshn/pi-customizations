export const PROVIDER_PREAMBLE = "You are Provider CLI, Anthropic's official CLI for Claude.";

export const ANTHROPIC_VERSION = "2023-06-01";

export const DEFAULT_PROVIDER_VERSION = "2.1.280";

export const OAUTH_BETA = "oauth-2025-04-20";

export const CLAUDE_CODE_BETA = "claude-code-20250219";

export const FINE_GRAINED_TOOL_STREAMING_BETA = "fine-grained-tool-streaming-2025-05-14";

export const INTERLEAVED_THINKING_BETA = "interleaved-thinking-2025-05-14";

export const CLAUDE_CODE_TOOL_NAMES = [
	"Read",
	"Write",
	"Edit",
	"Bash",
	"Grep",
	"Glob",
	"AskUserQuestion",
	"EnterPlanMode",
	"ExitPlanMode",
	"KillShell",
	"NotebookEdit",
	"Skill",
	"Task",
	"TaskOutput",
	"TodoWrite",
	"WebFetch",
	"WebSearch",
] as const;

const toolByLowerName = new Map(CLAUDE_CODE_TOOL_NAMES.map((name) => [name.toLowerCase(), name]));

export function toProviderName(name: string): string {
	return toolByLowerName.get(name.toLowerCase()) ?? name;
}

export function fromProviderName(name: string, tools: readonly { name: string }[] | undefined): string {
	const match = tools?.find((tool) => tool.name.toLowerCase() === name.toLowerCase());
	return match?.name ?? name;
}

export function providerUserAgent(version: string): string {
	return `claude-cli/${version}`;
}
