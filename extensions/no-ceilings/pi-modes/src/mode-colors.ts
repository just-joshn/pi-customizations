import type { ThemeColor } from '@earendil-works/pi-coding-agent';
import { MODE_COLOR_IDS, type ModeColorId, ZERO } from './types.ts';

export const DEFAULT_MODE_COLOR_ID: ModeColorId = 'cyan';

export const MODE_ICON_CHOICES = ['⚡', '★', '◆', '●', '▲', '✦', '⬢', '➜', '⚙', '☀', '☾', '⚑', '✎', '⌘', '∞', '◇'] as const;

export const MODE_EXIT_HINT = 'ctrl+alt+m to exit';

const COLOR_ALIASES: Readonly<Record<string, ModeColorId>> = {
  default: 'cyan',
  brand: 'cyan',
  cyan: 'cyan',
  green: 'green',
  blue: 'blue',
  purple: 'purple',
  magenta: 'magenta',
  orange: 'yellow',
  yellow: 'yellow',
  red: 'red',
};

const COLOR_THEME_TOKENS: Readonly<Record<ModeColorId, ThemeColor>> = {
  cyan: 'syntaxVariable',
  green: 'success',
  blue: 'mdLink',
  purple: 'accent',
  magenta: 'thinkingXhigh',
  yellow: 'warning',
  red: 'error',
};

export function normalizeModeColorId(raw: unknown): ModeColorId {
  if (typeof raw !== 'string') {
    return DEFAULT_MODE_COLOR_ID;
  }
  return COLOR_ALIASES[raw.trim().toLowerCase()] ?? DEFAULT_MODE_COLOR_ID;
}

export function isModeColorName(raw: unknown): boolean {
  return typeof raw === 'string' && COLOR_ALIASES[raw.trim().toLowerCase()] !== undefined;
}

export function resolveModeColorToken(colorId: ModeColorId | undefined): ThemeColor {
  return COLOR_THEME_TOKENS[colorId ?? DEFAULT_MODE_COLOR_ID];
}

export function normalizeModeIcon(raw: unknown): string | undefined {
  if (typeof raw !== 'string') {
    return undefined;
  }
  const trimmed = raw.trim();
  return trimmed.length > ZERO ? trimmed : undefined;
}

export function formatCustomModeBadge(label: string, icon: string | undefined): string {
  const prefix = icon ? `${icon} ` : '';
  return `${prefix}${label} (${MODE_EXIT_HINT})`;
}

export function listModeColorChoices(): readonly ModeColorId[] {
  return MODE_COLOR_IDS;
}

export function listModeColorAliases(): readonly string[] {
  return Object.keys(COLOR_ALIASES);
}
