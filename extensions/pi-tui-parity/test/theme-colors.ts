/**
 * The role lists pi's Theme constructor requires, shared by the two test
 * theme builders. The tui theme JSON only names the roles it overrides, so
 * every role falls back to an empty string.
 */

export const FG_ROLES = [
  'accent',
  'bashMode',
  'border',
  'borderAccent',
  'borderMuted',
  'customMessageLabel',
  'customMessageText',
  'dim',
  'error',
  'mdCode',
  'mdCodeBlock',
  'mdCodeBlockBorder',
  'mdHeading',
  'mdHr',
  'mdLink',
  'mdLinkUrl',
  'mdListBullet',
  'mdQuote',
  'mdQuoteBorder',
  'muted',
  'success',
  'syntaxComment',
  'syntaxFunction',
  'syntaxKeyword',
  'syntaxNumber',
  'syntaxOperator',
  'syntaxPunctuation',
  'syntaxString',
  'syntaxType',
  'syntaxVariable',
  'text',
  'thinkingHigh',
  'thinkingLow',
  'thinkingMax',
  'thinkingMedium',
  'thinkingMinimal',
  'thinkingOff',
  'thinkingText',
  'thinkingXhigh',
  'toolDiffAdded',
  'toolDiffContext',
  'toolDiffRemoved',
  'toolOutput',
  'toolTitle',
  'userMessageText',
  'warning',
];

export const BG_ROLES = ['customMessageBg', 'searchMatchBg', 'selectedBg', 'toolErrorBg', 'toolPendingBg', 'toolSuccessBg', 'userMessageBg'];

export function splitThemeColors(colors: Record<string, string>): { fg: Record<string, string>; bg: Record<string, string> } {
  const fg = Object.fromEntries(FG_ROLES.map((role) => [role, colors[role] ?? '']));
  const bg = Object.fromEntries(BG_ROLES.map((role) => [role, colors[role] ?? '']));
  return { fg, bg };
}
