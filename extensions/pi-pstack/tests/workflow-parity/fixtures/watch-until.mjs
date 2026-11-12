// Runs watch-pr and stops it once it has printed a verdict of the wanted kind, so a check can read a non-terminal verdict
// (WAITING in queued mode) without waiting for the watcher's own timeout. Prints every line it saw.
import { spawn } from 'node:child_process';

const [watcher, wanted, ...args] = process.argv.slice(2);
const child = spawn(watcher, args, { stdio: ['ignore', 'pipe', 'inherit'] });
let buffer = '';
const lines = [];
const finish = () => {
  child.kill('SIGTERM');
  process.stdout.write(`${lines.join('\n')}\n`);
  process.exit(0);
};
child.stdout.on('data', (chunk) => {
  buffer += chunk.toString('utf8');
  for (let at = buffer.indexOf('\n'); at !== -1; at = buffer.indexOf('\n')) {
    const line = buffer.slice(0, at);
    buffer = buffer.slice(at + 1);
    if (line.trim() === '') continue;
    lines.push(line);
    try {
      if (JSON.parse(line).kind === wanted) finish();
    } catch {
      // not a verdict line
    }
  }
});
child.on('close', finish);
setTimeout(finish, 45_000);
