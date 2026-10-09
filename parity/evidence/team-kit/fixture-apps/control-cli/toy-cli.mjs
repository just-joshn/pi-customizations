import readline from 'node:readline';
process.stdout.write('READY\n');
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
rl.on('line', (line) => {
  if (line.trim() === 'ping') {
    process.stdout.write('PONG\n');
    rl.close();
    process.exit(0);
  }
});
