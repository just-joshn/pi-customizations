/**
 * Real `Theme` built from this package's shipped `themes/tui-skin.json`, with
 * values that name a `vars` entry resolved first, matching how pi loads a theme
 * document. Shared by the suites that need a real `Theme` instance.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Theme, type ThemeToken } from '@earendil-works/pi-coding-agent';

type ThemeDocument = { vars: Record<string, string | number>; colors: Record<string, string | number> };
type ResolvedColors = Readonly<Record<string, string | number>>;

function resolveColors(): ResolvedColors {
  const document: ThemeDocument = JSON.parse(readFileSync(fileURLToPath(new URL('../themes/tui-skin.json', import.meta.url)), 'utf8'));
  const resolve = (value: string | number): string | number => (typeof value === 'string' && value.length > 0 && !value.startsWith('#') ? (document.vars[value] ?? value) : value);
  return Object.fromEntries(Object.entries(document.colors).map(([role, value]) => [role, resolve(value)]));
}

function requiredColor(resolved: ResolvedColors, role: ThemeToken): string | number {
  const value = resolved[role];
  if (value === undefined) throw new Error(`Shipped theme is missing color ${role}`);
  return value;
}

function foregroundColors(resolved: ResolvedColors): ConstructorParameters<typeof Theme>[0] {
  return {
    accent: requiredColor(resolved, 'accent'),
    border: requiredColor(resolved, 'border'),
    borderAccent: requiredColor(resolved, 'borderAccent'),
    borderMuted: requiredColor(resolved, 'borderMuted'),
    success: requiredColor(resolved, 'success'),
    error: requiredColor(resolved, 'error'),
    warning: requiredColor(resolved, 'warning'),
    muted: requiredColor(resolved, 'muted'),
    dim: requiredColor(resolved, 'dim'),
    text: requiredColor(resolved, 'text'),
    thinkingText: requiredColor(resolved, 'thinkingText'),
    userMessageText: requiredColor(resolved, 'userMessageText'),
    customMessageText: requiredColor(resolved, 'customMessageText'),
    customMessageLabel: requiredColor(resolved, 'customMessageLabel'),
    toolTitle: requiredColor(resolved, 'toolTitle'),
    toolOutput: requiredColor(resolved, 'toolOutput'),
    mdHeading: requiredColor(resolved, 'mdHeading'),
    mdLink: requiredColor(resolved, 'mdLink'),
    mdLinkUrl: requiredColor(resolved, 'mdLinkUrl'),
    mdCode: requiredColor(resolved, 'mdCode'),
    mdCodeBlock: requiredColor(resolved, 'mdCodeBlock'),
    mdCodeBlockBorder: requiredColor(resolved, 'mdCodeBlockBorder'),
    mdQuote: requiredColor(resolved, 'mdQuote'),
    mdQuoteBorder: requiredColor(resolved, 'mdQuoteBorder'),
    mdHr: requiredColor(resolved, 'mdHr'),
    mdListBullet: requiredColor(resolved, 'mdListBullet'),
    toolDiffAdded: requiredColor(resolved, 'toolDiffAdded'),
    toolDiffRemoved: requiredColor(resolved, 'toolDiffRemoved'),
    toolDiffContext: requiredColor(resolved, 'toolDiffContext'),
    syntaxComment: requiredColor(resolved, 'syntaxComment'),
    syntaxKeyword: requiredColor(resolved, 'syntaxKeyword'),
    syntaxFunction: requiredColor(resolved, 'syntaxFunction'),
    syntaxVariable: requiredColor(resolved, 'syntaxVariable'),
    syntaxString: requiredColor(resolved, 'syntaxString'),
    syntaxNumber: requiredColor(resolved, 'syntaxNumber'),
    syntaxType: requiredColor(resolved, 'syntaxType'),
    syntaxOperator: requiredColor(resolved, 'syntaxOperator'),
    syntaxPunctuation: requiredColor(resolved, 'syntaxPunctuation'),
    thinkingOff: requiredColor(resolved, 'thinkingOff'),
    thinkingMinimal: requiredColor(resolved, 'thinkingMinimal'),
    thinkingLow: requiredColor(resolved, 'thinkingLow'),
    thinkingMedium: requiredColor(resolved, 'thinkingMedium'),
    thinkingHigh: requiredColor(resolved, 'thinkingHigh'),
    thinkingXhigh: requiredColor(resolved, 'thinkingXhigh'),
    bashMode: requiredColor(resolved, 'bashMode'),
  };
}

function backgroundColors(resolved: ResolvedColors): ConstructorParameters<typeof Theme>[1] {
  return {
    selectedBg: requiredColor(resolved, 'selectedBg'),
    userMessageBg: requiredColor(resolved, 'userMessageBg'),
    customMessageBg: requiredColor(resolved, 'customMessageBg'),
    toolPendingBg: requiredColor(resolved, 'toolPendingBg'),
    toolSuccessBg: requiredColor(resolved, 'toolSuccessBg'),
    toolErrorBg: requiredColor(resolved, 'toolErrorBg'),
  };
}

export function createThemeFixture(): Theme {
  const resolved = resolveColors();
  return new Theme(foregroundColors(resolved), backgroundColors(resolved), 'truecolor', { name: 'tui-skin' });
}
