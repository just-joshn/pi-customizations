/**
 * Exact constants from the pi CLI build 2026.09.26-dd393fe
 * (research inventory under the repository audit trail, source-conversation.md §0,
 * source-composer.md, source-screens.md).
 */

export const DETAIL_ROW_MARGIN = 2; // SK
export const SHELL_INPUT_LINES = 2; // WE
export const SHELL_TOOL_OUTPUT_LINES = 2; // Ok
export const SHELL_TURN_OUTPUT_LINES = 6; // a6
export const THINKING_LINES = 6; // WT
export const EXPANDED_MAX_LINES = 256; // U5
export const SHELL_OUTPUT_BYTE_CAP = 1024 * 1024; // qg
export const MAX_CHARS_PER_LINE = 2000; // CN
export const MAX_TOTAL_CHARS = 64000; // UM
export const PATH_TRUNCATE_WIDTH = 50; // rY
export const CWD_TRUNCATE_WIDTH = 50; // DN
export const BACKGROUND_NUDGE_DELAY_MS = 5000; // dd
export const TOOL_VERB_STATUS_DELAY_MS = 100; // V2
export const MAX_USER_MESSAGE_LINES = 150; // p9

export const EDIT_DIFF_MAX_LINES = 12;
export const EDIT_DIFF_LONG_LINE_CUT = 116;
export const EDIT_DIFF_LONG_LINE_WIDTH = 120;
export const GREP_PATTERN_KEEP = 37;
export const GREP_PATTERN_MAX = 40;
export const SHELL_EXPANDED_OUTPUT_LINES = 256;
export const MERGED_WINDOW_ROWS = 3;
export const CODE_LINE_NUMBER_WIDTH = 4;
export const CODE_TAB_SIZE = 4;
export const MARKDOWN_RULE_WIDTH = 40;
export const PLAN_COLLAPSED_LINES = 12;
export const PLAN_COLLAPSED_CHARS = 800;
export const TASK_LAST_OUTPUT_LINES = 8;
export const TASK_LAST_OUTPUT_CHARS = 600;
export const SWITCH_MODE_COUNTDOWN_S = 15; // uz
export const PASTE_COLLAPSE_CHARS = 800;
export const COMPOSER_MAX_VISUAL_LINES = 6; // V1
export const COMPOSER_WIDTH_MARGIN = 7; // Re
export const PALETTE_PAGE_ROWS = 10;
export const PALETTE_LABEL_COLS = 24;
export const AT_PALETTE_WINDOW = 6;
export const AT_PALETTE_LABEL_MAX = 40;
export const EPHEMERAL_TIMEOUT_MS = 3000;
export const CONTEXT_TWO_COL_MIN_WIDTH = 88;
export const RESUME_FOOTER_TIME_COL = 22;

export const SPINNER_FRAMES = ["⠀⠞", "⠠⠜", "⠰⠰", "⠘⠤", "⠘⠆", "⠘⠣", "⠰⠳", "⠠⠛"] as const;
export const SPINNER_INTERVAL_MS = 250;

export type ToolVerb = readonly [progressive: string, past: string];

export const TOOL_VERBS: Record<string, ToolVerb> = {
	read: ["Reading", "Read"],
	grep: ["Grepping", "Grepped"],
	search: ["Searching", "Searched"],
	glob: ["Globbing", "Globbed"],
	ls: ["Listing", "Listed"],
	delete: ["Deleting", "Deleted"],
	edit: ["Editing", "Edited"],
	run: ["Running", "Ran"],
	wait: ["Waiting", "Waited"],
	call: ["Calling", "Called"],
	explore: ["Exploring", "Explored"],
	update: ["Updating", "Updated"],
	plan: ["Planning", "Planned"],
	writeStdin: ["Writing to stdin", "Wrote to stdin"],
	subagent: ["Running subagent", "Ran subagent"],
	createGoal: ["Creating goal", "Created goal"],
	updateGoal: ["Updating goal", "Updated goal"],
};

export const ABORT_LABELS = {
	short: ["Cancelled", "Interrupted by follow-up", "Interrupted"],
	long: ["Cancelled by user", "Interrupted by follow-up message", "Interrupted"],
} as const;

export const COMPOSER_PLACEHOLDERS = {
	emptyChat: "Plan, search, build anything",
	followUp: "Add a follow-up",
	followUpWithPlan: "Add a follow-up — /plan to review and build",
	shellWide: "Run a command — e.g., git status",
	shellWideNoRepo: "Run a command — e.g., ls",
	shellNarrow: "Run a command",
	askQuestion: "Answer questions (Enter to select/next, Esc to skip)",
	switchMode: "Approve mode switch (y/n)",
	decision: "Waiting for decision (y/n/p)...",
	imageDecision: "Edit the image prompt, then press Enter to generate",
	rejectionReason: "Tell the agent what to do instead (Enter to send, empty to skip, Esc to cancel)",
	planRevision: "Describe how to revise the plan (Enter to submit, Esc to cancel)",
} as const;

export const FOOTER_HEADLINES = {
	plan: "Plan (shift+tab to cycle)",
	ask: "Ask (shift+tab to cycle)",
	debug: "Debug (shift+tab to cycle)",
	customSuffix: " (shift+tab to exit)",
	cloudTransfer: "^ Move to cloud agent",
	cloudTransferNarrow: "^ Cloud agent",
} as const;

export const KEY_HINT_ABBREVIATIONS = {
	NAV: "↑/↓ to navigate",
	SCROLL: "↑/↓ to scroll",
	SEL: "Enter to select",
	CONF: "Enter to confirm",
	EDIT: "Enter to edit",
	SAVE: "Enter to save",
	USE: "Enter to use",
	DEL: "d to delete",
	KILL: "k to kill",
	TABSEC: "Tab to switch sections",
	TABED: "Tab to edit",
	CLOSE: "Esc to close",
	BACK: "Esc to go back",
	CANCEL: "Esc to cancel",
} as const;

export const HINT_SEPARATOR = " • ";

export const HELP_GRID: readonly (readonly [key: string, description: string])[] = [
	["/", "commands"],
	["!", "shell"],
	["@", "files"],
	["&", "to move to cloud"],
	["\\ + ⏎ or shift + ⏎", "for new line"],
	["Ctrl+L", "to clear screen"],
	["Ctrl+G", "open prompt in $EDITOR"],
	["shift + tab", "to switch mode"],
	["/run-everything", "to enable Run Everything"],
];

export const PALETTE_STRINGS = {
	noMatches: "No matches",
	moreAbove: "↑ more above",
	moreBelow: "↓ more below",
	skillAttachHint: "enter to attach · option+enter to use as mode",
	selectedPrefix: "→ ",
	unselectedPrefix: "  ",
} as const;

export const RESUME_EMPTY_ALL = {
	title: "No sessions found.",
	hint: "Press Ctrl-D, q or ESC to go back",
} as const;

export const RESUME_EMPTY_WORKSPACE = {
	title: "No sessions in this workspace.",
	hint: "Press ← to see all chats, or Ctrl-D / q / ESC to go back",
} as const;

export const DECISION_TITLES = {
	shell: "Run this command?",
	shellOutsideSandbox: "Run this command outside the sandbox?",
	mcp: "Run this MCP tool?",
	delete: "Delete this file?",
	write: "Write to this file?",
	webSearch: "Allow this web search?",
	webFetch: "Allow this web fetch?",
	image: "Proceed with this edit?",
} as const;

export const PAGER_TOKENS = {
	countdownElapsed: "─",
	countdownRemaining: "━",
	optionOn: "● ",
	optionOff: "○ ",
	optionOnAlt: "◉ ",
	optionOffAlt: "◯ ",
	currentMark: "✓",
	tabSeparator: " | ",
} as const;

export const NOTIFY_MESSAGES = {
	waitingForYou: "pi is waiting for you",
	needsInput: "the reference CLI needs your input",
	approveCommand: (cmd: string) => `Approve command: ${cmd}`,
} as const;
