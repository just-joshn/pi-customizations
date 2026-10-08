const code = Number(process.argv[2] ?? 0);
const size = () => `size:${process.stdout.rows}x${process.stdout.columns}\n`;
process.stdout.write(`tty:0=${Number(process.stdin.isTTY)} 1=${Number(process.stdout.isTTY)} 2=${Number(process.stderr.isTTY)}\n`);
process.stdout.write(size());
process.stdout.write(Buffer.from([0xff, 0xfe, 0x41, 0x0a]));
process.stdout.write(Buffer.from([0xe2, 0x82]));
setTimeout(() => process.stdout.write(Buffer.from([0xac, 0x0a])), 50);
process.on('SIGWINCH', () => process.stdout.write(size()));
process.stdin.setRawMode(true);
setTimeout(() => process.stdout.write('ready\n'), 100);
process.stdin.on('data', (d) => {
  process.stdout.write(Buffer.concat([Buffer.from('echo:'), d]));
  if (d.includes(0x0d)) setTimeout(() => process.exit(code), 100);
});
