import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

export const PARITY_ROOT = resolve(here, '../..');
export const REPO_ROOT = resolve(PARITY_ROOT, '../..');
export const EXTENSION_ROOT = join(REPO_ROOT, 'extensions/pi-rea');
export const FIXTURES = join(PARITY_ROOT, 'fixtures');
export const TARGETS = join(FIXTURES, 'targets');
export const EVIDENCE_DIR = join(PARITY_ROOT, 'evidence/differential');
export const MISMATCHES_PATH = join(EVIDENCE_DIR, 'mismatches.json');
export const NOTEPAD_APP = join(REPO_ROOT, 'parity/reverse-engineer-anything/fixtures/targets/notepad-app');

export const target = (...parts) => join(TARGETS, ...parts);
