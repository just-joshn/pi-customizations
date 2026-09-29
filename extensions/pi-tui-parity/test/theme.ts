import { splitThemeColors } from './theme-colors.ts';

/** Builds a real pi Theme from the package's tui theme JSON (shared test harness). */
export async function makeTheme(name = 'tui-dark'): Promise<import('@earendil-works/pi-coding-agent').Theme> {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const ThemeCtor = (await import('@earendil-works/pi-coding-agent')).Theme;
  const themeJson = JSON.parse(readFileSync(fileURLToPath(new URL(`../themes/${name}.json`, import.meta.url)), 'utf8'));
  const { fg, bg } = splitThemeColors(themeJson.colors as Record<string, string>);
  return new ThemeCtor(fg as never, bg as never, 'truecolor', { name });
}
