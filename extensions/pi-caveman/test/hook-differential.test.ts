import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, test, vi } from 'vitest';
import { type Harness, harness } from './support/harness.ts';

type Step = { readonly prompt: string; readonly context: string };
type Scenario = { readonly defaultMode: string; readonly session: string; readonly steps: readonly Step[] };

const oracle: { readonly scenarios: readonly Scenario[] } = JSON.parse(readFileSync(new URL('./upstream/hook-oracle.json', import.meta.url), 'utf8'));

// Claude Code has no native status bar, so upstream's SessionStart appends setup instructions for its
// statusline script. Pi renders the badge through ctx.ui.setStatus instead (ledger row statusline).
const withoutStatuslineNudge = (text: string): string => text.replace(/\n\nSTATUSLINE SETUP NEEDED:[\s\S]*$/, '');
const SWITCH_LINE = /\n\n(Switch: [^\n]+)$/.exec(withoutStatuslineNudge(oracle.scenarios[0]?.session ?? ''))?.[1] ?? 'missing switch line';

// A mid-session switch hands the model the skill body followed by the per-turn reminder. Pi keeps
// the body in its system prompt section, closed by the switch line upstream sends at session start,
// and sends the reminder as the turn's hidden message.
function splitSwitch(context: string): { ruleset: string; reminder: string } {
  const at = context.lastIndexOf('\n\nCAVEMAN MODE ACTIVE (');
  return at === -1 ? { ruleset: context, reminder: '' } : { ruleset: `${context.slice(0, at)}\n\n${SWITCH_LINE}`, reminder: context.slice(at + 2) };
}

type PiTurn = { readonly section: string | undefined; readonly message: string };
type PiStep = { readonly kind: 'command'; readonly notice: string | undefined } | { readonly kind: 'turn'; readonly turn: PiTurn };

async function replay(h: Harness, prompt: string): Promise<PiStep> {
  const [, name = '', args = ''] = /^\/([\w-]+)\s*(.*)$/.exec(prompt) ?? [];
  if (h.commandNames().includes(name)) {
    const before = h.notices.length;
    await h.command(name, args);
    return { kind: 'command', notice: h.notices.slice(before).at(-1) };
  }
  h.emit('input', { text: prompt, source: 'interactive' });
  return { kind: 'turn', turn: modelTurn(h, prompt) };
}

function modelTurn(h: Harness, prompt: string): PiTurn {
  const { sections, result } = h.turn(prompt);
  const message = (result as { message?: { content?: string } } | undefined)?.message?.content ?? '';
  return { section: sections['caveman'], message };
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe.each(oracle.scenarios)('upstream hooks with CAVEMAN_DEFAULT_MODE=$defaultMode', (scenario) => {
  test('the model sees what upstream hooks inject, turn by turn', async () => {
    vi.stubEnv('CAVEMAN_DEFAULT_MODE', scenario.defaultMode);
    const h = harness();
    h.emit('session_start', { reason: 'startup' });

    const sessionRuleset = scenario.session.startsWith('CAVEMAN MODE ACTIVE') ? withoutStatuslineNudge(scenario.session) : undefined;
    let owedRuleset = sessionRuleset;
    const mismatches: string[] = [];
    for (const step of scenario.steps) {
      const pi = await replay(h, step.prompt);
      const upstream = step.context;
      if (upstream.startsWith('Report this status verbatim without changing mode: ')) {
        const report = upstream.slice('Report this status verbatim without changing mode: '.length);
        if (pi.kind !== 'command' || pi.notice !== report) mismatches.push(`${step.prompt}: status ${JSON.stringify(pi)} != ${report}`);
        continue;
      }
      const switched = upstream.startsWith('CAVEMAN MODE ACTIVE — mode: ') ? splitSwitch(upstream) : undefined;
      if (switched) owedRuleset = switched.ruleset;
      if (pi.kind === 'command') continue;
      const { section, message } = pi.turn;
      if (upstream === '') {
        if (section !== undefined || message.includes('CAVEMAN MODE ACTIVE')) mismatches.push(`${step.prompt}: upstream injects nothing, Pi injects ${JSON.stringify({ section, message })}`);
        continue;
      }
      if (owedRuleset === undefined || section !== owedRuleset) mismatches.push(`${step.prompt}: ruleset differs or upstream sent none before injecting context`);
      const reminder = switched ? switched.reminder : upstream;
      if (!message.includes(reminder)) mismatches.push(`${step.prompt}: reinforcement ${JSON.stringify(message)} lacks ${JSON.stringify(reminder)}`);
    }
    expect(mismatches).toStrictEqual([]);
  });
});
