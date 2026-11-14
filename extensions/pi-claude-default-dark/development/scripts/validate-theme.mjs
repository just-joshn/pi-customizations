import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dev = join(dirname(fileURLToPath(import.meta.url)), '..');
const themeDir = join(dev, 'node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme');
const { validateThemeJson } = await import(join(themeDir, 'theme-schema.js'));
const { loadThemeFromPath, setThemeJsonValidator } = await import(join(themeDir, 'theme.js'));
const stockRoles = Object.keys(JSON.parse(readFileSync(join(themeDir, 'dark.json'), 'utf8')).colors);

const path = process.argv[2] ?? join(dev, '../themes/claude-default-dark.json');
const json = JSON.parse(readFileSync(path, 'utf8'));
const problems = [];
const missing = stockRoles.filter((r) => !(r in json.colors));
const unknown = Object.keys(json.colors).filter((r) => !stockRoles.includes(r));
if (missing.length) problems.push(`missing roles: ${missing.join(' ')}`);
if (unknown.length) problems.push(`unknown roles: ${unknown.join(' ')}`);
if (json.$schema !== 'https://pi.dev/schemas/theme.schema.json') problems.push('wrong $schema');
if (json.name !== 'claude-default-dark' || json.appearance !== 'dark') problems.push('name or appearance');
setThemeJsonValidator(validateThemeJson);
try {
  const theme = loadThemeFromPath(path, 'truecolor');
  for (const role of stockRoles) {
    try {
      theme.fg(role, 'x');
    } catch {
      try {
        theme.bg(role, 'x');
      } catch (error) {
        problems.push(`${role}: ${error.message}`);
      }
    }
  }
} catch (error) {
  problems.push(`Pi 1.5.2 loader: ${error.message}`);
}
if (problems.length) {
  console.error(`theme INVALID:\n${problems.join('\n')}`);
  process.exit(1);
}
console.log(`theme valid: ${stockRoles.length} roles, Pi 1.5.2 schema and loader accept it`);
