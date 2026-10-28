import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { minimalElf64CoreFixture } from '../../../../extensions/pi-rea/src/analysis/recorded-crash.ts';
import { TARGETS } from './paths.mjs';

export const ensureDevicetreeFixture = () => {
  const dir = join(TARGETS, 'devicetree');
  const path = join(dir, 'board.dtb');
  if (existsSync(path)) return path;
  mkdirSync(dir, { recursive: true });
  const strings = Buffer.from('model\0board\0', 'ascii');
  const begin = Buffer.alloc(8);
  begin.writeUInt32BE(1, 0);
  begin.writeUInt32BE(0, 4);
  const value = Buffer.from('board\0\0\0', 'ascii');
  const prop = Buffer.alloc(20);
  prop.writeUInt32BE(3, 0);
  prop.writeUInt32BE(6, 4);
  prop.writeUInt32BE(0, 8);
  value.copy(prop, 12);
  const endNode = Buffer.alloc(4);
  endNode.writeUInt32BE(2, 0);
  const end = Buffer.alloc(4);
  end.writeUInt32BE(9, 0);
  const structure = Buffer.concat([begin, prop, endNode, end]);
  const headerBytes = 40;
  const rsv = Buffer.alloc(16);
  const offMem = headerBytes;
  const offStruct = offMem + rsv.length;
  const offStrings = offStruct + structure.length;
  const totalsize = offStrings + strings.length;
  const header = Buffer.alloc(headerBytes);
  header.writeUInt32BE(0xd00dfeed, 0);
  header.writeUInt32BE(totalsize, 4);
  header.writeUInt32BE(offStruct, 8);
  header.writeUInt32BE(offStrings, 12);
  header.writeUInt32BE(offMem, 16);
  header.writeUInt32BE(17, 20);
  header.writeUInt32BE(16, 24);
  header.writeUInt32BE(0, 28);
  header.writeUInt32BE(strings.length, 32);
  header.writeUInt32BE(structure.length, 36);
  writeFileSync(path, Buffer.concat([header, rsv, structure, strings]));
  return path;
};

export const ensureGoMachoFixtures = () => {
  const thin = join(TARGETS, 'fixture-go-macho');
  const fat = join(TARGETS, 'fixture-go-macho-fat');
  const goFixture = join(TARGETS, 'go-fixture');
  if (!existsSync(thin)) {
    const built = spawnSync('go', ['build', '-o', thin, '-ldflags', '-X main.banner=injected', '.'], {
      cwd: goFixture,
      encoding: 'utf8',
    });
    if (built.status !== 0) throw new Error(`go build thin failed: ${built.stderr || built.stdout}`);
  }
  if (!existsSync(fat)) {
    const amd64 = join('/tmp', 'fixture-go-amd64-parity');
    const built = spawnSync('go', ['build', '-o', amd64, '-ldflags', '-X main.banner=injected', '.'], {
      cwd: goFixture,
      encoding: 'utf8',
      env: { ...process.env, GOOS: 'darwin', GOARCH: 'amd64' },
    });
    if (built.status !== 0) throw new Error(`go build amd64 failed: ${built.stderr || built.stdout}`);
    const lipo = spawnSync('lipo', ['-create', thin, amd64, '-output', fat], { encoding: 'utf8' });
    if (lipo.status !== 0) throw new Error(`lipo create failed: ${lipo.stderr || lipo.stdout}`);
  }
  return { thin, fat };
};

export const ensureEmptyEvidenceBundles = () => {
  const dir = join(TARGETS, 'bundles');
  mkdirSync(dir, { recursive: true });
  const empty = `${JSON.stringify({
    artifacts: [],
    captures: [],
    environments: [],
    providers: [],
    records: [],
    scenarios: [],
    unknowns: [],
  })}\n`;
  const left = join(dir, 'empty-left.json');
  const right = join(dir, 'empty-right.json');
  if (!existsSync(left)) writeFileSync(left, empty);
  if (!existsSync(right)) writeFileSync(right, empty);
  return { left, right };
};

export const ensureMinimalElfCoreFixture = () => {
  const dir = join(TARGETS, 'crash');
  const path = join(dir, 'minimal.core');
  if (existsSync(path)) return path;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path, minimalElf64CoreFixture());
  return path;
};

export const ensureAltGoPeFixture = () => {
  const base = join(TARGETS, 'pe/fixture-go-pe.exe');
  const alt = join(TARGETS, 'pe/fixture-go-pe-alt.exe');
  if (!existsSync(alt)) {
    writeFileSync(alt, Buffer.concat([readFileSync(base), Buffer.from([0])]));
  }
  return { base, alt };
};

const writeJsApp = (root, mainBody) => {
  mkdirSync(join(root, 'src'), { recursive: true });
  writeFileSync(join(root, 'package.json'), `${JSON.stringify({ name: 'fixture', main: 'src/main.js' })}\n`);
  writeFileSync(join(root, 'src/main.js'), mainBody);
};

export const ensureJsCompareFixtures = () => {
  const root = join(TARGETS, 'js-compare');
  const left = join(root, 'left');
  const right = join(root, 'right');
  writeJsApp(
    left,
    `export function shape(kind) {
  if (kind === 'a') return { x: 1, y: 2 };
  return { x: 1, z: 3 };
}
export const plain = { a: 1 };
`,
  );
  writeJsApp(
    right,
    `export function shape(kind) {
  if (kind === 'a') return { x: 1, y: 2 };
  return { x: 1, z: 3, w: 4 };
}
export const plain = { a: 2 };
export const extra = 1;
`,
  );
  return { left, right, root };
};

export const ensureWebPageCaptureFixture = () => {
  const dir = join(TARGETS, 'web');
  mkdirSync(dir, { recursive: true });
  const capturePath = join(dir, 'page-capture.json');
  const outputDirectory = join(dir, 'exported-scripts');
  writeFileSync(
    capturePath,
    `${JSON.stringify({
      evidence_id: `ev_${'c'.repeat(64)}`,
      operation: 'inspect_web_page',
      normalized_result: {
        script_sources: [{ url: 'https://example.com/app.js', text: 'export const x = 1;\n' }],
      },
    })}\n`,
  );
  return { capturePath, outputDirectory };
};

export const resetWebScriptOutputDirectory = (outputDirectory) => {
  rmSync(outputDirectory, { recursive: true, force: true });
  return outputDirectory;
};

export const ensureFixtureAppZip = () => {
  const app = join(TARGETS, 'bundle/Fixture.app');
  const zip = join(TARGETS, 'bundle/Fixture.app.zip');
  const built = spawnSync('zip', ['-qr', zip, 'Fixture.app'], {
    cwd: join(TARGETS, 'bundle'),
    encoding: 'utf8',
  });
  if (built.status !== 0) throw new Error(`zip Fixture.app failed: ${built.stderr || built.stdout}`);
  if (!existsSync(app)) throw new Error(`missing ${app}`);
  return zip;
};
