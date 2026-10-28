import { readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { invalidInput } from './errors.mjs';
import { readPrefix } from './target.mjs';

const GO_MARKER = Buffer.from([0xff, 0x20, 0x47, 0x6f, 0x20, 0x62, 0x75, 0x69, 0x6c, 0x64, 0x69, 0x6e, 0x66, 0x3a]);

export const ROUTES = Object.freeze({
  directory: { operation: 'analyze-javascript-application', kind: 'javascript-application' },
  asar: { operation: 'analyze-javascript-application', kind: 'javascript-application' },
  zip: { operation: 'inspect-artifact', kind: 'archive' },
  apk: { operation: 'inspect-artifact', kind: 'archive' },
  ipa: { operation: 'inspect-artifact', kind: 'archive' },
  msix: { operation: 'inspect-artifact', kind: 'archive' },
  har: { operation: 'inspect-web-network-capture', kind: 'network-capture' },
  'mach-o': { operation: 'inspect-binary-layout', kind: 'binary' },
  elf: { operation: 'inspect-binary-layout', kind: 'binary' },
  pe: { operation: 'inspect-binary-layout', kind: 'binary' },
});

const UNSUPPORTED = {
  dmg: { reason: 'Disk images need a mount this port does not perform.', code: 'unsupported_format' },
  gzip: { reason: 'Gzip streams are not inventoried; the port reads ZIP containers only.', code: 'unsupported_format' },
  tar: { reason: 'Tar archives are not inventoried.', code: 'unsupported_format' },
  '7z': { reason: '7z archives are not inventoried.', code: 'unsupported_format' },
  wasm: { reason: 'WebAssembly artifacts are outside this port’s scope; no WABT-backed decoder ships here.', code: 'unsupported_format' },
  sqlite: { reason: 'SQLite databases are outside this port’s scope.', code: 'unsupported_format' },
  unknown: { reason: 'The target’s format was not identified from its leading bytes.', code: 'unsupported_target' },
};

export async function routeByPath(path) {
  const resolved = resolve(path);
  const { describeSubject } = await import('./target.mjs');
  const subject = await describeSubject(resolved);
  if (subject.format === 'directory') return decision({ target: resolved, format: 'directory', subject, goBinary: false });
  if (subject.format === 'mach-o' || subject.format === 'elf') {
    const prefix = await readPrefix(resolved, 1 << 20);
    return decision({ target: resolved, format: subject.format, subject, goBinary: prefix.includes(GO_MARKER) });
  }
  return decision({ target: resolved, format: subject.format, subject, goBinary: false });
}

function decision({ target, format, subject, goBinary }) {
  const route = ROUTES[format];
  if (route === undefined) {
    const unsupported = UNSUPPORTED[format] ?? UNSUPPORTED.unknown;
    return {
      target,
      name: basename(target),
      format,
      kind: 'unsupported',
      operation: null,
      supported: false,
      availability_code: unsupported.code,
      reason: unsupported.reason,
      alternatives: ['analyze-javascript-application', 'inspect-artifact', 'inspect-binary-layout', 'inspect-go-binary', 'inspect-web-network-capture'].sort(),
      subject,
    };
  }
  if (goBinary) {
    return { target, name: basename(target), format, kind: 'go-binary', operation: 'inspect-go-binary', supported: true, subject, alternatives: ['inspect-binary-layout'] };
  }
  return { target, name: basename(target), format, kind: route.kind, operation: route.operation, supported: true, subject, alternatives: [] };
}

export function discoverLocalApplications(directories = ['/Applications', join(homedir(), 'Applications')]) {
  const found = [];
  for (const directory of directories) {
    let names;
    try {
      names = readdirSync(directory);
    } catch {
      continue;
    }
    for (const entry of names) {
      if (!entry.endsWith('.app')) continue;
      const path = join(directory, entry);
      try {
        if (!statSync(path).isDirectory()) continue;
      } catch {
        continue;
      }
      found.push({ name: entry, path });
    }
  }
  return found;
}

export function resolveTargetName(name, candidates) {
  const matches = candidates.filter((candidate) => matchesName(name, candidate));
  if (matches.length === 0) {
    throw invalidInput('No installed artifact matches that name.', [{ path: ['target'], reason: 'not_found', message: `no candidate matches: ${name}` }]);
  }
  if (matches.length > 1) {
    throw invalidInput('Several artifacts match that name; choose one.', [
      { path: ['target'], reason: 'ambiguous', message: `${matches.length} candidates match: ${name}`, candidates: matches.map((candidate) => candidate.path ?? candidate.name) },
    ]);
  }
  return matches[0];
}

function matchesName(name, candidate) {
  const trimmed = String(name).trim().toLowerCase();
  const candidateName = String(candidate.name ?? '').toLowerCase();
  return candidateName === trimmed || candidateName.replace(/\.app$/, '') === trimmed || candidateName.includes(trimmed);
}
