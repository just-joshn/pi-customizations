/**
 * Real `Theme` built from this package's shipped `themes/cursor-ui.json`, with
 * values that name a `vars` entry resolved first, matching how pi loads a theme
 * document. Shared by the suites that need a real `Theme` instance.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { Theme } from '@earendil-works/pi-coding-agent';

type ThemeDocument = { vars: Record<string, string | number>; colors: Record<string, string | number> };
type ResolvedColors = Record<string, string | number>;

function resolveColors(): ResolvedColors {
  const document: ThemeDocument = JSON.parse(readFileSync(fileURLToPath(new URL('../themes/cursor-ui.json', import.meta.url)), 'utf8'));
  const resolve = (value: string | number): string | number => (typeof value === 'string' && value.length > 0 && !value.startsWith('#') ? (document.vars[value] ?? value) : value);
  return Object.fromEntries(Object.entries(document.colors).map(([role, value]) => [role, resolve(value)]));
}

function foregroundColors(resolved: ResolvedColors): ConstructorParameters<typeof Theme>[0] {
  return {
    accent: resolved.accent,
    border: resolved.border,
    borderAccent: resolved.borderAccent,
    borderMuted: resolved.borderMuted,
    success: resolved.success,
    error: resolved.error,
    warning: resolved.warning,
    muted: resolved.muted,
    dim: resolved.dim,
    text: resolved.text,
    thinkingText: resolved.thinkingText,
    userMessageText: resolved.userMessageText,
    customMessageText: resolved.customMessageText,
    customMessageLabel: resolved.customMessageLabel,
    toolTitle: resolved.toolTitle,
    toolOutput: resolved.toolOutput,
    mdHeading: resolved.mdHeading,
    mdLink: resolved.mdLink,
    mdLinkUrl: resolved.mdLinkUrl,
    mdCode: resolved.mdCode,
    mdCodeBlock: resolved.mdCodeBlock,
    mdCodeBlockBorder: resolved.mdCodeBlockBorder,
    mdQuote: resolved.mdQuote,
    mdQuoteBorder: resolved.mdQuoteBorder,
    mdHr: resolved.mdHr,
    mdListBullet: resolved.mdListBullet,
    toolDiffAdded: resolved.toolDiffAdded,
    toolDiffRemoved: resolved.toolDiffRemoved,
    toolDiffContext: resolved.toolDiffContext,
    syntaxComment: resolved.syntaxComment,
    syntaxKeyword: resolved.syntaxKeyword,
    syntaxFunction: resolved.syntaxFunction,
    syntaxVariable: resolved.syntaxVariable,
    syntaxString: resolved.syntaxString,
    syntaxNumber: resolved.syntaxNumber,
    syntaxType: resolved.syntaxType,
    syntaxOperator: resolved.syntaxOperator,
    syntaxPunctuation: resolved.syntaxPunctuation,
    thinkingOff: resolved.thinkingOff,
    thinkingMinimal: resolved.thinkingMinimal,
    thinkingLow: resolved.thinkingLow,
    thinkingMedium: resolved.thinkingMedium,
    thinkingHigh: resolved.thinkingHigh,
    thinkingXhigh: resolved.thinkingXhigh,
    bashMode: resolved.bashMode,
  };
}

function backgroundColors(resolved: ResolvedColors): ConstructorParameters<typeof Theme>[1] {
  return {
    selectedBg: resolved.selectedBg,
    userMessageBg: resolved.userMessageBg,
    customMessageBg: resolved.customMessageBg,
    toolPendingBg: resolved.toolPendingBg,
    toolSuccessBg: resolved.toolSuccessBg,
    toolErrorBg: resolved.toolErrorBg,
  };
}

export function createThemeFixture(): Theme {
  const resolved = resolveColors();
  return new Theme(foregroundColors(resolved), backgroundColors(resolved), 'truecolor', { name: 'cursor-ui' });
}
