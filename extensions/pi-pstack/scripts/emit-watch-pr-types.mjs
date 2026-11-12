import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const sourceDir = join(root, 'generated/skills/poteto-mode/scripts/watch-pr');
const destination = join(root, 'src/vendor-types/watch-pr');
const check = process.argv.includes('--check');
const temporary = mkdtempSync(join(tmpdir(), 'watch-pr-types-'));
try {
  const output = join(temporary, 'output');
  const config = join(temporary, 'tsconfig.json');
  writeFileSync(config, JSON.stringify({
    compilerOptions: {
      target: 'ES2023', module: 'NodeNext', moduleResolution: 'NodeNext',
      strict: true, skipLibCheck: true, declaration: true, emitDeclarationOnly: true,
      allowImportingTsExtensions: true, rootDir: sourceDir, outDir: output,
      types: ['node'], typeRoots: [join(root, 'node_modules/@types')],
    },
    files: ['github.ts', 'types.ts'].map((name) => join(sourceDir, name)),
  }));
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', config], { stdio: 'inherit' });
  const files = readdirSync(output).sort();
  if (check && (!existsSync(destination) || JSON.stringify(readdirSync(destination).sort()) !== JSON.stringify(files))) {
    throw new Error('Stale watcher declaration file list. Run node scripts/emit-watch-pr-types.mjs.');
  }
  if (!check) mkdirSync(destination, { recursive: true });
  for (const name of files) {
    const generated = readFileSync(join(output, name), 'utf8');
    if (check) {
      if (readFileSync(join(destination, name), 'utf8') !== generated) {
        throw new Error(`Stale watcher declaration ${name}. Run node scripts/emit-watch-pr-types.mjs.`);
      }
    } else {
      writeFileSync(join(destination, name), generated);
    }
    console.log(`${check ? 'Checked' : 'Emitted'} src/vendor-types/watch-pr/${name}`);
  }
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
