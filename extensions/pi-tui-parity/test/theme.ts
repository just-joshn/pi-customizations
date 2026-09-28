/** Builds a real pi Theme from the package's tui theme JSON (shared test harness). */
export async function makeTheme(name = 'tui-dark'): Promise<import('@earendil-works/pi-coding-agent').Theme> {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const ThemeCtor = (await import('@earendil-works/pi-coding-agent')).Theme;
  const themeJson = JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/${name}.json`, import.meta.url)), 'utf8'));
  const colors = themeJson.colors as Record<string, string>;
  const fgRoles = [
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
  const bgRoles = ['customMessageBg', 'searchMatchBg', 'selectedBg', 'toolErrorBg', 'toolPendingBg', 'toolSuccessBg', 'userMessageBg'];
  const fg = Object.fromEntries(fgRoles.map((r) => [r, colors[r] ?? '']));
  const bg = Object.fromEntries(bgRoles.map((r) => [r, colors[r] ?? '']));
  return new ThemeCtor(fg as never, bg as never, 'truecolor', { name });
}
