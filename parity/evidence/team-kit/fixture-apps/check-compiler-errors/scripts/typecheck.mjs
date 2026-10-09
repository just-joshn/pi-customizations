import { readFileSync } from 'node:fs';
import { join } from 'node:path';
const src = readFileSync(join(import.meta.dirname, '..', 'src', 'broken.js'), 'utf8');
if (/VALUE\s*=\s*null\s*;/.test(src)) {
  console.error('typecheck failed: VALUE must be a number, found null');
  process.exit(1);
}
if (!/VALUE\s*=\s*7\s*;/.test(src)) {
  console.error('typecheck failed: VALUE must equal 7');
  process.exit(1);
}
console.log('typecheck ok');
