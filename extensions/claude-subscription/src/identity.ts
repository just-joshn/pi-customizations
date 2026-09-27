export const CLAUDE_CODE_PREAMBLE = "You are Claude Code, Anthropic's official CLI for Claude.";

// Anthropic's subscription gateway attributes requests to the Claude Code plan
// by this first system block. Without it the request is billed against extra
// usage and refused, so the exact captured string must stay intact.
export const CLAUDE_CODE_BILLING = "x-anthropic-billing-header: cc_version=2.1.280.3a6; cc_entrypoint=sdk-cli;";

export const ANTHROPIC_VERSION = "2023-06-01";

export const DEFAULT_CLAUDE_CODE_VERSION = "2.1.280";

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

export function toClaudeCodeName(name: string): string {
	return toolByLowerName.get(name.toLowerCase()) ?? name;
}

export function fromClaudeCodeName(name: string, tools: readonly { name: string }[] | undefined): string {
	const match = tools?.find((tool) => tool.name.toLowerCase() === name.toLowerCase());
	return match?.name ?? name;
}

export function claudeCodeUserAgent(version: string): string {
	return `claude-cli/${version}`;
}
