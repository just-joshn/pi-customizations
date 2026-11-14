import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { colorToHex } from '@earendil-works/pi-tui';
import { adaptRenderers, THEME } from './adapters/restyle.js';
import { workingIndicator } from './adapters/working.js';

export default function claudeDefaultTheme(pi: ExtensionAPI): void {
  pi.registerToolRenderer((tool, next) => adaptRenderers(tool, next()));
  const working = workingIndicator();
  pi.on('session_start', (_event, ctx) => working('start', ctx));
  pi.on('agent_start', (_event, ctx) => working('start', ctx));
  pi.on('turn_start', (_event, ctx) => working('turn', ctx));
  pi.registerCommand('claude-theme', {
    description: 'Inspect, verify, or activate the installed Claude default-dark Pi theme',
    handler: async (rawArgs, ctx) => {
      if (ctx.mode !== 'tui') return;
      const command = rawArgs.trim() || 'status';
      if (command === 'status') {
        const discovered = ctx.ui.getAllThemes().some(({ name }) => name === THEME);
        ctx.ui.notify(discovered ? `${THEME}: installed; parity requires separate verification` : `${THEME}: theme resource not found`, discovered ? 'info' : 'error');
        return;
      }
      if (command === 'use') {
        const result = ctx.ui.setTheme(THEME);
        if (!result.success) ctx.ui.notify(result.error ?? 'Unable to select theme', 'error');
        return;
      }
      if (command === 'verify') {
        const expected = ctx.ui.getTheme(THEME);
        if (!expected) {
          ctx.ui.notify(`${THEME}: theme resource not found`, 'error');
          return;
        }
        const colors = new Map(Object.entries(expected.colors).map(([role, color]) => [role, colorToHex(color)]));
        const matches: string[] = [];
        const differences: string[] = [];
        for (const [role, color] of Object.entries(ctx.ui.theme.colors)) {
          (colorToHex(color) === colors.get(role) ? matches : differences).push(role);
        }
        ctx.ui.notify(
          `Active theme ${ctx.ui.theme.name ?? 'unnamed'}. Matching roles (${matches.length}): ${matches.join(', ')}. Different roles (${differences.length}): ${differences.join(', ') || 'none'}.\nParity is certified only by development/PARITY_REPORT.md, not this runtime color check.`,
          differences.length ? 'warning' : 'info',
        );
        return;
      }
      ctx.ui.notify('Usage: /claude-theme [status|use|verify]', 'warning');
    },
  });
}
