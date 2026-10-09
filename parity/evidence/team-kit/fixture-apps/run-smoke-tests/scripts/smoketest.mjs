import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(import.meta.dirname, '..', 'app.js'), 'utf8');
if (!/export\s+const\s+ready\s*=\s*true\s*;/.test(src)) {
  console.error('smoketest failed: ready must be true');
  process.exit(1);
}
console.log('SMOKE_OK');
