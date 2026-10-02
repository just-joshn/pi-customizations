import { describe, expect, it } from 'vitest';
import * as c from '../src/constants.ts';

describe('tui layout constants', () => {
  it('carries the shared UI constants', () => {
    expect(c.DETAIL_ROW_MARGIN).toBe(2);
    expect(c.SHELL_INPUT_LINES).toBe(2);
    expect(c.SHELL_TOOL_OUTPUT_LINES).toBe(2);
    expect(c.SHELL_TURN_OUTPUT_LINES).toBe(6);
    expect(c.THINKING_LINES).toBe(6);
    expect(c.EXPANDED_MAX_LINES).toBe(256);
    expect(c.SHELL_OUTPUT_BYTE_CAP).toBe(1048576);
    expect(c.MAX_CHARS_PER_LINE).toBe(2000);
    expect(c.MAX_TOTAL_CHARS).toBe(64000);
    expect(c.PATH_TRUNCATE_WIDTH).toBe(50);
    expect(c.CWD_TRUNCATE_WIDTH).toBe(50);
    expect(c.BACKGROUND_NUDGE_DELAY_MS).toBe(5000);
    expect(c.TOOL_VERB_STATUS_DELAY_MS).toBe(100);
    expect(c.MAX_USER_MESSAGE_LINES).toBe(150);
  });

  it('carries the braille spinner frames and interval', () => {
    expect([...c.SPINNER_FRAMES]).toEqual(['⠀⠞', '⠠⠜', '⠰⠰', '⠘⠤', '⠘⠆', '⠘⠣', '⠰⠳', '⠠⠛']);
    expect(c.SPINNER_FRAMES.length).toBe(8);
    expect(c.SPINNER_INTERVAL_MS).toBe(250);
  });

  it('carries key hint abbreviations verbatim', () => {
    expect(c.KEY_HINT_ABBREVIATIONS.NAV).toBe('↑/↓ to navigate');
    expect(c.KEY_HINT_ABBREVIATIONS.SEL).toBe('Enter to select');
    expect(c.KEY_HINT_ABBREVIATIONS.CLOSE).toBe('Esc to close');
    expect(c.KEY_HINT_ABBREVIATIONS.BACK).toBe('Esc to go back');
    expect(c.HINT_SEPARATOR).toBe(' • ');
  });
});

describe('tui copy constants', () => {
  it('carries the verb table pairs', () => {
    expect(c.TOOL_VERBS.read).toEqual(['Reading', 'Read']);
    expect(c.TOOL_VERBS.grep).toEqual(['Grepping', 'Grepped']);
    expect(c.TOOL_VERBS.writeStdin).toEqual(['Writing to stdin', 'Wrote to stdin']);
    expect(c.TOOL_VERBS.subagent).toEqual(['Running subagent', 'Ran subagent']);
    expect(c.TOOL_VERBS.createGoal).toEqual(['Creating goal', 'Created goal']);
    expect(c.TOOL_VERBS.updateGoal).toEqual(['Updating goal', 'Updated goal']);
  });

  it('carries composer placeholders verbatim', () => {
    expect(c.COMPOSER_PLACEHOLDERS.emptyChat).toBe('Plan, search, build anything');
    expect(c.COMPOSER_PLACEHOLDERS.followUp).toBe('Add a follow-up');
    expect(c.COMPOSER_PLACEHOLDERS.followUpWithPlan).toBe('Add a follow-up — /plan to review and build');
    expect(c.COMPOSER_PLACEHOLDERS.decision).toBe('Waiting for decision (y/n/p)...');
    expect(c.COMPOSER_PLACEHOLDERS.shellNarrow).toBe('Run a command');
  });

  it('carries decision titles verbatim', () => {
    expect(c.DECISION_TITLES.shell).toBe('Run this command?');
    expect(c.DECISION_TITLES.write).toBe('Write to this file?');
    expect(c.DECISION_TITLES.delete).toBe('Delete this file?');
    expect(c.DECISION_TITLES.image).toBe('Proceed with this edit?');
  });
});
