import { readFileSync } from 'node:fs';

const files = ['src/host.ts', 'src/workers.ts', 'src/context.ts', 'src/shells.ts', 'src/goal.ts', 'src/questions.ts', 'src/state.ts'];
const hedge = /not (?:implemented|supplied|available|reproduced|enabled|verified)|unavailable|unsupported|unmet|unsatisfied|cannot|Reference/gi;
const rows = files.map((file) => [file, (readFileSync(file, 'utf8').match(hedge) ?? []).length]);
for (const [file, count] of rows) process.stdout.write(`${count}\t${file}\n`);
process.stdout.write(`${rows.reduce((sum, [, count]) => sum + count, 0)}\ttotal\n`);
