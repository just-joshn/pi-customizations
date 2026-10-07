import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { type ExtensionAPI, getAgentDir } from '@earendil-works/pi-coding-agent';
import type { ModeController } from './controller.ts';
import { PROSE_MODES } from './modes.ts';
import { SKILLS_DIR } from './ruleset.ts';
import { transitionsFromEntries } from './state.ts';
import { aggregateHistory, appendHistory, attributeByMode, findCompressedPairs, formatHistory, formatShare, formatStats, parseDuration, sessionUsage } from './stats.ts';

const MODE_COMMANDS = [
  // biome-ignore lint/security/noSecrets: command description, not a credential
  { name: 'caveman', description: 'Caveman voice: answer first, fluff gone, every technical fact kept (/caveman [ultra|wenyan|off|status])' },
  { name: 'ultracave', description: 'Ultracave: caveman at maximum compression (/ultracave [off|status])' },
  { name: 'megacave', description: 'Megacave: caveman in Classical Chinese (文言文), technical terms verbatim (/megacave [off|status])' },
] as const;
const CAVEMAN_ARGS = ['off', 'status', ...PROSE_MODES, 'lite', 'full', 'ultra', 'wenyan', 'wenyan-lite', 'wenyan-full', 'wenyan-ultra'];

export function registerModeCommands(pi: ExtensionAPI, controller: ModeController): void {
  for (const command of MODE_COMMANDS) {
    const options = command.name === 'caveman' ? CAVEMAN_ARGS : ['off', 'status'];
    pi.registerCommand(command.name, {
      description: command.description,
      getArgumentCompletions: (prefix) => {
        const items = options.filter((value) => value.startsWith(prefix.trim().toLowerCase())).map((value) => ({ value, label: value }));
        return items.length > 0 ? items : null;
      },
      handler: async (args, ctx) => {
        const before = controller.active();
        const note = controller.handlePrompt(`/${command.name}${args.trim() ? ` ${args.trim()}` : ''}`, ctx);
        if (note?.kind === 'status') {
          ctx.ui.notify(note.report, 'info');
          return;
        }
        if (note) {
          ctx.ui.notify(note.text.replace(/^Tell the user /, ''), 'warning');
          return;
        }
        const after = controller.active();
        ctx.ui.notify(`Caveman mode: ${after ?? 'off'}${after === before ? ' (unchanged)' : ''}`, 'info');
      },
    });
  }
}

export function registerHelp(pi: ExtensionAPI): void {
  pi.registerCommand('caveman-help', {
    description: 'Caveman quick-reference card: modes, commands, triggers',
    handler: async () => {
      const card = readFileSync(join(SKILLS_DIR, 'caveman-help', 'SKILL.md'), 'utf8').replace(/^---[\s\S]*?---\s*/, '');
      await pi.sendMessage({ customType: 'caveman-help', content: card.trim(), display: true });
    },
  });
}

function historyReport(historyPath: string, since: string | null): string | null {
  const sinceMs = since === null ? null : parseDuration(since);
  if (since !== null && sinceMs === null) return null;
  return formatHistory({ ...aggregateHistory({ path: historyPath, sinceMs, now: Date.now() }), since });
}

export function registerStats(pi: ExtensionAPI, controller: ModeController): void {
  pi.registerCommand('caveman-stats', {
    description: 'Token usage and mode attribution for this Pi session (--share, --all, --since 7d)',
    handler: async (args, ctx) => {
      const tail = args.trim().split(/\s+/).filter(Boolean);
      const historyPath = join(getAgentDir(), 'caveman', 'history.jsonl');
      const sinceIndex = tail.indexOf('--since');
      const since = sinceIndex === -1 ? null : (tail[sinceIndex + 1] ?? '');
      if (tail.includes('--all') || since !== null) {
        const report = historyReport(historyPath, since);
        if (report === null) {
          ctx.ui.notify(`caveman-stats: --since takes Nh or Nd (e.g. 7d, 24h), got: ${since}`, 'error');
          return;
        }
        await pi.sendMessage({ customType: 'caveman-stats', content: `\`\`\`\n${report.trim()}\n\`\`\``, display: true });
        return;
      }
      const branch = ctx.sessionManager.getBranch();
      const usage = sessionUsage(branch);
      const mode = controller.active();
      const attribution = attributeByMode({ responses: usage.responses, transitions: transitionsFromEntries(branch), mode, output: usage.output });
      if (usage.turns > 0) {
        appendHistory(historyPath, {
          ts: Date.now(),
          session_id: ctx.sessionManager.getSessionId(),
          mode,
          model: usage.model,
          output_tokens: usage.output.value,
          output_tokens_availability: usage.output.availability,
          turns: usage.turns,
          cache_read_input_tokens: usage.cacheRead.value,
          cache_read_input_tokens_availability: usage.cacheRead.availability,
          output_tokens_by_mode: attribution.byMode,
          unattributed_output_tokens: attribution.unknownTokens,
          mode_attribution: attribution.basis,
        });
      }
      const report = tail.includes('--share') ? formatShare(usage) : formatStats({ usage, mode, sessionPath: ctx.sessionManager.getSessionFile() ?? null, compressed: findCompressedPairs([getAgentDir(), ctx.cwd]), attribution });
      await pi.sendMessage({ customType: 'caveman-stats', content: `\`\`\`\n${report.trim()}\n\`\`\``, display: true });
    },
  });
}
