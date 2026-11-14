import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dev = join(dirname(fileURLToPath(import.meta.url)), '..');
const stock = JSON.parse(readFileSync(join(homedir(), '.pi/agent/install/releases/1.5.2/node_modules/@earendil-works/pi-coding-agent/dist/modes/interactive/theme/dark.json'), 'utf8'));
const hex = (n) => n.toString(16).padStart(2, '0');
export const probeColor = (i) => `#${hex(0x40 + i * 3)}${hex(0x7b)}${hex(0x20 + i)}`;

const roles = Object.keys(stock.colors);
const colors = Object.fromEntries(roles.map((role, i) => [role, probeColor(i)]));
const theme = { $schema: stock.$schema, name: 'role-probe', appearance: 'dark', colors };
writeFileSync(join(dev, 'captures/role-probe.theme.json'), `${JSON.stringify(theme, null, 2)}\n`);
writeFileSync(join(dev, 'captures/role-probe.map.json'), `${JSON.stringify(Object.fromEntries(roles.map((r, i) => [probeColor(i), r])), null, 2)}\n`);
console.log(`${roles.length} roles probed`);
