import { createHash } from 'node:crypto';
import type { BigIntStats } from 'node:fs';
import { lstat as lstatCallback, readdir, realpath, stat as statCallback } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

import { invalidRequest } from '../contract/errors.ts';

export const DEFAULT_MAX_ENTRIES = 20_000;
export const DEFAULT_MAX_PROBE_BYTES = 8_388_608;

export const DESKTOP_LIMITATIONS = [
  'Runtime candidates and component markers do not establish loaded code, execution, or build correspondence.',
  "The directory SHA-256 commits only to retained paths, omission kinds, available filesystem metadata and read-range digests, not to every file's contents. Unread bytes are unknown.",
  'Special-entry payloads are not read. Their paths and kinds are retained; other special-entry metadata is unavailable in this report.',
  'Child symlinks are not followed. Executable section-embedded PCKs without a trailer and encrypted contents remain unexamined.',
  'This is a sequence of stable entry observations, not an atomic snapshot of the entire directory.',
  "Unity reference decoding stops after a witness in each Data/Managed directory; other assemblies' references are unexamined. Header facts remain per-file.",
] as const;

type FileIdentity = {
  readonly device: string;
  readonly inode: string;
  readonly size: string;
  readonly mode: string;
  readonly mtime_ns: string;
  readonly ctime_ns: string;
};

export interface DesktopApplicationInspection {
  readonly root: {
    readonly path: string;
    readonly canonical_path: string;
    readonly namespace_id: string;
    readonly identity: { readonly device: string; readonly inode: string };
    readonly snapshot_sha256: string;
    readonly identity_scope: 'examined-metadata-and-read-ranges';
  };
  readonly files: readonly DesktopFile[];
  readonly omissions: readonly { readonly omission_id: string; readonly path: string; readonly kind: string }[];
  readonly candidates: readonly {
    readonly candidate_id: string;
    readonly family: string;
    readonly confidence: 'observed' | 'inferred';
    readonly basis_file_ids: readonly string[];
    readonly rationale: string;
  }[];
  readonly components: readonly {
    readonly component_id: string;
    readonly name: string;
    readonly category: string;
    readonly basis_file_ids: readonly string[];
    readonly confidence: 'observed' | 'inferred';
    readonly runtime_presence: 'unknown';
  }[];
  readonly next_probes: readonly {
    readonly probe_id: string;
    readonly operation: string;
    readonly path: string;
    readonly file_id: string | null;
    readonly rationale: string;
    readonly confidence: 'observed' | 'inferred';
  }[];
  readonly coverage: {
    readonly status: 'complete-within-scan' | 'budget_exhausted';
    readonly entries_examined: number;
    readonly files_probed: number;
    readonly bytes_read: number;
    readonly symlinks_not_followed: number;
    readonly special_entries_omitted: number;
    readonly limits: { readonly max_entries: number; readonly max_probe_bytes: number };
  };
  readonly limitations: readonly string[];
}

interface DesktopFile {
  readonly file_id: string;
  readonly path: string;
  readonly local_path: string;
  readonly kind: 'file' | 'directory';
  readonly bytes: number | null;
  readonly identity: FileIdentity | null;
  readonly read_status: 'not-selected' | 'probed' | 'listed_only' | 'skipped';
  readonly ranges: readonly { readonly offset: number; readonly bytes: number; readonly sha256: string }[];
  readonly facts: readonly { readonly kind: string; readonly offset: null; readonly value: string }[];
  readonly issues: readonly string[];
}

const inputError = (path: string, reason: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_desktop_application',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

const sha256 = (bytes: Buffer | string): string =>
  createHash('sha256')
    .update(typeof bytes === 'string' ? Buffer.from(bytes) : bytes)
    .digest('hex');

const branded = (prefix: 'dsf' | 'dsc' | 'dsp' | 'dsr' | 'dso', material: string): string => `${prefix}_${sha256(material)}`;

const lstatBigint = (target: string): Promise<BigIntStats> => lstatCallback(target, { bigint: true });
const statBigint = (target: string): Promise<BigIntStats> => statCallback(target, { bigint: true });

const fileIdentity = (st: BigIntStats): FileIdentity => ({
  device: st.dev.toString(),
  inode: st.ino.toString(),
  size: st.size.toString(),
  mode: st.mode.toString(),
  mtime_ns: st.mtimeNs.toString(),
  ctime_ns: st.ctimeNs.toString(),
});

export interface DesktopOptions {
  readonly maxEntries?: number;
  readonly maxProbeBytes?: number;
  readonly cwd?: string;
}

export const inspectDesktopApplicationFromPath = async (path: string, options: DesktopOptions = {}): Promise<{ record: DesktopApplicationInspection; path: string; resolvedPath: string }> => {
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  const maxProbeBytes = options.maxProbeBytes ?? DEFAULT_MAX_PROBE_BYTES;
  if (!Number.isInteger(maxEntries) || maxEntries < 1) throw inputError(path, 'invalid_value', 'max_entries must be a positive integer.');
  if (!Number.isInteger(maxProbeBytes) || maxProbeBytes < 16) throw inputError(path, 'invalid_value', 'max_probe_bytes must be an integer >= 16.');

  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let canonical: string;
  let rootStat: BigIntStats;
  try {
    rootStat = await statBigint(resolvedPath);
    canonical = await realpath(resolvedPath);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no path exists there' : `it could not be read (${(error as Error).message})`;
    throw inputError(path, 'invalid_value', reason);
  }
  if (!rootStat.isDirectory()) throw inputError(path, 'invalid_format', 'desktop application inspection requires a directory root.');

  const files: DesktopFile[] = [];
  const omissions: DesktopApplicationInspection['omissions'][number][] = [];
  let entriesExamined = 0;
  let symlinksNotFollowed = 0;
  let specialEntriesOmitted = 0;
  let budgetExhausted = false;
  const snapshot = createHash('sha256');

  const queue = [''];
  while (queue.length > 0) {
    const rel = queue.shift()!;
    const abs = rel.length === 0 ? resolvedPath : join(resolvedPath, rel);
    let dirents;
    try {
      dirents = await readdir(abs, { withFileTypes: true });
    } catch (error) {
      omissions.push({ omission_id: branded('dso', `omit:${omissions.length}:${rel}`), path: rel || '.', kind: `readdir_failed:${(error as Error).message}` });
      continue;
    }
    const ordered = [...dirents].toSorted((left, right) => left.name.localeCompare(right.name));
    for (const dirent of ordered) {
      entriesExamined += 1;
      if (entriesExamined > maxEntries) {
        budgetExhausted = true;
        break;
      }
      const childRel = rel.length === 0 ? dirent.name : `${rel}/${dirent.name}`;
      const childAbs = join(resolvedPath, childRel);
      snapshot.update(childRel);
      if (dirent.isSymbolicLink()) {
        symlinksNotFollowed += 1;
        omissions.push({ omission_id: branded('dso', `omit:${omissions.length}:${childRel}`), path: childRel, kind: 'symlink_not_followed' });
        continue;
      }
      if (dirent.isDirectory()) {
        let dirStat: BigIntStats;
        try {
          dirStat = await lstatBigint(childAbs);
        } catch (error) {
          omissions.push({ omission_id: branded('dso', `omit:${omissions.length}:${childRel}`), path: childRel, kind: `stat_failed:${(error as Error).message}` });
          continue;
        }
        snapshot.update(`dir:${dirStat.dev.toString()}:${dirStat.ino.toString()}`);
        files.push({
          file_id: branded('dsf', `${canonical}\0${childRel}\0${dirStat.dev.toString()}\0${dirStat.ino.toString()}`),
          path: childRel,
          local_path: childAbs,
          kind: 'directory',
          bytes: null,
          identity: null,
          read_status: 'not-selected',
          ranges: [],
          facts: [],
          issues: [],
        });
        queue.push(childRel);
        continue;
      }
      if (!dirent.isFile()) {
        specialEntriesOmitted += 1;
        omissions.push({ omission_id: branded('dso', `omit:${omissions.length}:${childRel}`), path: childRel, kind: 'special_entry' });
        continue;
      }
      let fileStat: BigIntStats;
      try {
        fileStat = await lstatBigint(childAbs);
      } catch (error) {
        omissions.push({ omission_id: branded('dso', `omit:${omissions.length}:${childRel}`), path: childRel, kind: `stat_failed:${(error as Error).message}` });
        continue;
      }
      snapshot.update(`file:${fileStat.dev.toString()}:${fileStat.ino.toString()}:${fileStat.size.toString()}`);
      const facts: DesktopFile['facts'][number][] = [];
      const normalizedRel = childRel.replaceAll('\\', '/');
      if (normalizedRel === 'resources/app.asar' || normalizedRel.endsWith('/resources/app.asar')) {
        facts.push({ kind: 'electron-asar-convention', offset: null, value: normalizedRel });
      }
      if (dirent.name === 'GameAssembly.dll' || dirent.name === 'GameAssembly.dylib' || dirent.name === 'libil2cpp.so') {
        facts.push({ kind: 'il2cpp-binary-name', offset: null, value: dirent.name });
      }
      if (dirent.name.endsWith('.unity3d') || dirent.name === 'global-metadata.dat') {
        facts.push({ kind: 'unity-marker', offset: null, value: dirent.name });
      }
      files.push({
        file_id: branded('dsf', `${canonical}\0${childRel}\0${fileStat.dev.toString()}\0${fileStat.ino.toString()}`),
        path: childRel,
        local_path: childAbs,
        kind: 'file',
        bytes: Number(fileStat.size),
        identity: fileIdentity(fileStat),
        read_status: 'not-selected',
        ranges: [],
        facts,
        issues: [],
      });
    }
    if (budgetExhausted) break;
  }

  files.sort((left, right) => left.path.localeCompare(right.path));

  const byPath = new Map(files.map((file) => [file.path.replaceAll('\\', '/'), file]));
  const candidates: DesktopApplicationInspection['candidates'][number][] = [];
  const nextProbes: DesktopApplicationInspection['next_probes'][number][] = [];

  const asar = [...byPath.values()].find((file) => {
    const normalized = file.path.replaceAll('\\', '/');
    return normalized === 'resources/app.asar' || normalized.endsWith('/resources/app.asar');
  });
  if (asar) {
    candidates.push({
      candidate_id: branded('dsc', `electron:${asar.file_id}`),
      family: 'electron',
      confidence: 'inferred',
      basis_file_ids: [asar.file_id],
      rationale: 'An app.asar in a resources directory suggests an Electron application; archive validity and execution are unverified.',
    });
    nextProbes.push({
      probe_id: branded('dsp', `open_binary:${asar.file_id}`),
      operation: 'open_binary',
      path: asar.local_path,
      file_id: asar.file_id,
      rationale: 'Select this ASAR target with open_binary, then call inspect_artifact to inventory it before selecting JavaScript sources.',
      confidence: 'inferred',
    });
    nextProbes.push({
      probe_id: branded('dsp', `analyze_javascript_application:${asar.file_id}`),
      operation: 'analyze_javascript_application',
      path: asar.local_path,
      file_id: asar.file_id,
      rationale: 'Analyze the candidate application archive with the static JavaScript workflow.',
      confidence: 'inferred',
    });
  }

  const unityMarkers = [...byPath.values()].filter((file) => file.facts.some((fact) => fact.kind === 'unity-marker' || fact.kind === 'il2cpp-binary-name'));
  if (unityMarkers.length > 0) {
    candidates.push({
      candidate_id: branded('dsc', `unity-il2cpp:${unityMarkers.map((file) => file.file_id).join(',')}`),
      family: 'unity-il2cpp',
      confidence: 'inferred',
      basis_file_ids: unityMarkers.map((file) => file.file_id),
      rationale: 'Unity/IL2CPP path markers were observed',
    });
    const metadata = unityMarkers.find((file) => file.path.endsWith('global-metadata.dat'));
    if (metadata) {
      nextProbes.push({
        probe_id: branded('dsp', `inspect_il2cpp_metadata:${metadata.file_id}`),
        operation: 'inspect_il2cpp_metadata',
        path: metadata.local_path,
        file_id: metadata.file_id,
        rationale: 'IL2CPP global-metadata.dat present',
        confidence: 'observed',
      });
    }
  }

  const rootIdentity = {
    device: rootStat.dev.toString(),
    inode: rootStat.ino.toString(),
  };

  return {
    record: {
      root: {
        path,
        canonical_path: canonical,
        namespace_id: branded('dsr', `${canonical}\0${rootStat.dev.toString()}\0${rootStat.ino.toString()}`),
        identity: rootIdentity,
        snapshot_sha256: snapshot.digest('hex'),
        identity_scope: 'examined-metadata-and-read-ranges',
      },
      files,
      omissions,
      candidates,
      components: [],
      next_probes: nextProbes,
      coverage: {
        status: budgetExhausted ? 'budget_exhausted' : 'complete-within-scan',
        entries_examined: entriesExamined,
        files_probed: 0,
        bytes_read: 0,
        symlinks_not_followed: symlinksNotFollowed,
        special_entries_omitted: specialEntriesOmitted,
        limits: { max_entries: maxEntries, max_probe_bytes: maxProbeBytes },
      },
      limitations: [...DESKTOP_LIMITATIONS],
    },
    path,
    resolvedPath,
  };
};
