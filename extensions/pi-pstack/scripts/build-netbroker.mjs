import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const ZIG_VERSION = '0.17.1';
const source = join(root, 'native/netbroker.c');
const output = join(root, 'dist/netbroker-s390x');
const check = process.argv.slice(2).includes('--check');
const [command = 'zig', ...prefix] = (process.env['ZIG'] ?? 'zig').split(' ');

const version = spawnSync(command, [...prefix, 'version'], { encoding: 'utf8' });
if (version.status !== 0 || version.stdout.trim() !== ZIG_VERSION) throw new Error(`The netbroker build requires Zig ${ZIG_VERSION} to reproduce the committed binary. Set ZIG to a command that runs it.`);
const built = join(root, 'dist/.netbroker-s390x.build');
mkdirSync(dirname(built), { recursive: true });
const result = spawnSync(command, [...prefix, 'cc', '-target', 's390x-linux-musl', '-Os', '-static', '-s', '-Wall', '-Wextra', '-Werror', '-o', built, source], { encoding: 'utf8' });
if (result.status !== 0) throw new Error(`Could not build netbroker:\n${result.stderr}`);
const generated = readFileSync(built);
rmSync(built);
if (check) {
  if (!existsSync(output) || !readFileSync(output).equals(generated)) {
    console.error(`Stale dist/netbroker-s390x. Run bun run build:netbroker with Zig ${ZIG_VERSION}.`);
    process.exitCode = 1;
  }
} else writeFileSync(output, generated, { mode: 0o755 });
console.log(`${check ? 'Checked' : 'Built'} dist/netbroker-s390x`);
