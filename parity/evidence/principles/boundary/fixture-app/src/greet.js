import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatGreeting } from './core.js';
import { loadConfig } from './load-config.js';

export function greet() {
  const cfgPath = join(dirname(fileURLToPath(import.meta.url)), '..', 'config', 'app.json');
  const cfg = loadConfig(cfgPath);
  return formatGreeting(cfg);
}
