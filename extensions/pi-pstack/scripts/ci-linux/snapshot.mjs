// What the Linux runner receives: the package's tracked files, plus the workspace files that decide which dependencies get installed
// and that the source digest covers, so the runner installs from the locked versions and hashes the same inputs as the local run.
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PACKAGE_DIR = 'extensions/pi-pstack';
const EXCLUDE = /^(parity-results\/|node_modules\/)/;
/** A frozen install resolves every workspace member, so each member's manifest must exist even though its code is not shipped. */
const MEMBER_MANIFEST = /^(extensions|skills)\/[^/]+\/package\.json$/;
const WORKSPACE_FILES = ['package.json', 'bun.lock', 'tsconfig.json', 'biome.json'];

const lsFiles = (cwd, ...args) =>
  execFileSync('git', ['-C', cwd, 'ls-files', '-z', ...args], { encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\0')
    .filter(Boolean);

/** Copies the snapshot into `dest` (an empty directory) and returns the number of package files. `root` is the package, `repoRoot` the workspace. */
export function buildSnapshot({ root, repoRoot, dest, commit }) {
  const place = (from, to) => {
    mkdirSync(dirname(join(dest, to)), { recursive: true });
    cpSync(from, join(dest, to));
  };
  const files = lsFiles(root).filter((f) => !EXCLUDE.test(f));
  for (const f of files) place(join(root, f), `${PACKAGE_DIR}/${f}`);
  for (const f of WORKSPACE_FILES) place(join(repoRoot, f), f);
  for (const f of lsFiles(repoRoot).filter((f) => MEMBER_MANIFEST.test(f) && f !== `${PACKAGE_DIR}/package.json`)) place(join(repoRoot, f), f);
  place(join(root, 'scripts/ci-linux/workflow.yml'), '.github/workflows/linux-tests.yml');
  writeFileSync(join(dest, PACKAGE_DIR, 'ci-snapshot.json'), `${JSON.stringify({ commit, files: files.length })}\n`);
  return files.length;
}
