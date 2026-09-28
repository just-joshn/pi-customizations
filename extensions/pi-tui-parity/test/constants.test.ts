import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as c from "../src/constants.ts";

describe("tui constants", () => {
	it("carries the shared UI constants", () => {
		assert.equal(c.DETAIL_ROW_MARGIN, 2);
		assert.equal(c.SHELL_INPUT_LINES, 2);
		assert.equal(c.SHELL_TOOL_OUTPUT_LINES, 2);
		assert.equal(c.SHELL_TURN_OUTPUT_LINES, 6);
		assert.equal(c.THINKING_LINES, 6);
		assert.equal(c.EXPANDED_MAX_LINES, 256);
		assert.equal(c.SHELL_OUTPUT_BYTE_CAP, 1048576);
		assert.equal(c.MAX_CHARS_PER_LINE, 2000);
		assert.equal(c.MAX_TOTAL_CHARS, 64000);
		assert.equal(c.PATH_TRUNCATE_WIDTH, 50);
		assert.equal(c.CWD_TRUNCATE_WIDTH, 50);
		assert.equal(c.BACKGROUND_NUDGE_DELAY_MS, 5000);
		assert.equal(c.TOOL_VERB_STATUS_DELAY_MS, 100);
		assert.equal(c.MAX_USER_MESSAGE_LINES, 150);
	});

	it("carries the braille spinner frames and interval", () => {
		assert.deepEqual([...c.SPINNER_FRAMES], ["⠀⠞", "⠠⠜", "⠰⠰", "⠘⠤", "⠘⠆", "⠘⠣", "⠰⠳", "⠠⠛"]);
		assert.equal(c.SPINNER_FRAMES.length, 8);
		assert.equal(c.SPINNER_INTERVAL_MS, 250);
	});

	it("carries the verb table pairs", () => {
		assert.deepEqual(c.TOOL_VERBS.read, ["Reading", "Read"]);
		assert.deepEqual(c.TOOL_VERBS.grep, ["Grepping", "Grepped"]);
		assert.deepEqual(c.TOOL_VERBS.writeStdin, ["Writing to stdin", "Wrote to stdin"]);
		assert.deepEqual(c.TOOL_VERBS.subagent, ["Running subagent", "Ran subagent"]);
		assert.deepEqual(c.TOOL_VERBS.createGoal, ["Creating goal", "Created goal"]);
		assert.deepEqual(c.TOOL_VERBS.updateGoal, ["Updating goal", "Updated goal"]);
	});

	it("carries composer placeholders verbatim", () => {
		assert.equal(c.COMPOSER_PLACEHOLDERS.emptyChat, "Plan, search, build anything");
		assert.equal(c.COMPOSER_PLACEHOLDERS.followUp, "Add a follow-up");
		assert.equal(c.COMPOSER_PLACEHOLDERS.followUpWithPlan, "Add a follow-up — /plan to review and build");
		assert.equal(c.COMPOSER_PLACEHOLDERS.decision, "Waiting for decision (y/n/p)...");
		assert.equal(c.COMPOSER_PLACEHOLDERS.shellNarrow, "Run a command");
	});

	it("carries decision titles verbatim", () => {
		assert.equal(c.DECISION_TITLES.shell, "Run this command?");
		assert.equal(c.DECISION_TITLES.write, "Write to this file?");
		assert.equal(c.DECISION_TITLES.delete, "Delete this file?");
		assert.equal(c.DECISION_TITLES.image, "Proceed with this edit?");
	});

	it("carries key hint abbreviations verbatim", () => {
		assert.equal(c.KEY_HINT_ABBREVIATIONS.NAV, "↑/↓ to navigate");
		assert.equal(c.KEY_HINT_ABBREVIATIONS.SEL, "Enter to select");
		assert.equal(c.KEY_HINT_ABBREVIATIONS.CLOSE, "Esc to close");
		assert.equal(c.KEY_HINT_ABBREVIATIONS.BACK, "Esc to go back");
		assert.equal(c.HINT_SEPARATOR, " • ");
	});

	it("carries composer and palette geometry", () => {
		assert.equal(c.COMPOSER_MAX_VISUAL_LINES, 6);
		assert.equal(c.COMPOSER_WIDTH_MARGIN, 7);
		assert.equal(c.PALETTE_LABEL_COLS, 24);
		assert.equal(c.PALETTE_PAGE_ROWS, 10);
		assert.equal(c.AT_PALETTE_WINDOW, 6);
		assert.equal(c.PASTE_COLLAPSE_CHARS, 800);
		assert.equal(c.SWITCH_MODE_COUNTDOWN_S, 15);
		assert.equal(c.EPHEMERAL_TIMEOUT_MS, 3000);
	});
});
