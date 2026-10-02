import { closeSync } from 'node:fs';

closeSync(0);
process.stdout.write('{"type":"stdin_closed"}\n');
setTimeout(() => process.exit(5), 300);
