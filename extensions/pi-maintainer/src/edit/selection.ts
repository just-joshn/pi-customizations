import { glob, lstat, readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative } from 'node:path';

import type { Snapshot } from '../core/branch.ts';
import { absRootPath, getRelFname, isImageFile, readText } from '../core/chat-files.ts';
import type { Host } from '../core/host.ts';
import type { GitPolicy } from '../feature.ts';
import { parseQuotedFilenames } from './quoted-filenames.ts';
import type { WorkingTree } from './working-tree.ts';

export interface SelectionState {
  readonly editable: readonly string[];
  readonly readOnly: readonly string[];
  readonly originalReadOnly: readonly string[];
}

export interface SelectionEnv {
  readonly root: string;
  readonly host: Host;
  readonly tree: WorkingTree;
  readonly git: GitPolicy;
  readonly autoCommits: boolean;
  readonly supportsImages: boolean;
}

export class ModeSwitchError extends Error {
  readonly command: string;
  constructor(command: string) {
    super(`Command '${command}' is only supported in interactive mode`);
    this.name = 'ModeSwitchError';
    this.command = command;
  }
}

const expandUser = (path: string): string => {
  if (path === '~') return homedir();
  if (path.startsWith('~/')) return join(homedir(), path.slice(2));
  return path;
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isFile();
  } catch {
    return false;
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await lstat(path);
    return true;
  } catch {
    return false;
  }
}

async function expandSubdir(path: string): Promise<string[]> {
  if (await isDirectory(path)) {
    const entries = await readdir(path);
    const nested: string[] = [];
    for (const entry of entries) nested.push(...(await expandSubdir(join(path, entry))));
    return nested;
  }
  return [path];
}

/** `Commands.glob_filtered_to_repo`. */
export async function globFilteredToRepo(pattern: string, env: SelectionEnv): Promise<string[]> {
  if (!pattern.trim()) return [];
  let raw: string[] = [];
  try {
    if (isAbsolute(pattern)) raw = [pattern];
    else {
      for await (const path of glob(pattern, { cwd: env.root })) raw.push(path);
    }
  } catch (error) {
    env.host.error(`Error matching ${pattern}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  const expanded: string[] = [];
  for (const path of raw) {
    const full = isAbsolute(path) ? path : join(env.root, path);
    expanded.push(...(await expandSubdir(full)));
  }
  const underRoot = expanded.filter((path) => path === env.root || path.startsWith(`${env.root}/`)).map((path) => relative(env.root, path) || '.');
  const tracked = await env.git.trackedFiles();
  if (tracked === null) return underRoot;
  const allowed = new Set(tracked);
  return underRoot.filter((path) => allowed.has(path));
}

async function matchAddWord(word: string, env: SelectionEnv): Promise<string[]> {
  const fname = isAbsolute(word) ? word : join(env.root, word);
  if (await env.git.isGitIgnored(getRelFname(env.root, fname))) {
    env.host.warning(`Skipping ${fname} due to aiderignore or --subtree-only.`);
    return [];
  }
  if (await pathExists(fname)) {
    if (await isFile(fname)) return [fname];
    const escaped = word.replace(/([*?[\]])/g, '[$1]');
    const matched = await globFilteredToRepo(escaped, env);
    if (matched.length) return matched.map((path) => absRootPath(env.root, path));
  } else {
    const matched = await globFilteredToRepo(word, env);
    if (matched.length) return matched.map((path) => absRootPath(env.root, path));
  }
  if (fname.includes('*') || fname.includes('?')) {
    env.host.error(`No match, and cannot create file with wildcard characters: ${fname}`);
    return [];
  }
  if ((await pathExists(fname)) && (await isDirectory(fname)) && env.git.repoRoot() !== null) {
    env.host.error(`Directory ${fname} is not in git.`);
    env.host.output(`You can add to git with: /git add ${fname}`);
    return [];
  }
  if (!(await env.host.confirm({ question: `No files matched '${word}'. Do you want to create ${fname}?` }))) return [];
  try {
    await env.tree.mkdir(dirname(fname));
    if (!(await env.tree.touch(fname))) {
      env.host.error(`Error creating file ${fname}`);
      return [];
    }
    return [fname];
  } catch (error) {
    env.host.error(`Error creating file ${fname}: ${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
}

async function pathInRepo(matchedFile: string, abs: string, env: SelectionEnv): Promise<boolean> {
  if (env.git.repoRoot() === null) return abs.startsWith(env.root);
  const tracked = await env.git.trackedFiles();
  if (tracked === null) return abs.startsWith(env.root);
  return tracked.includes(getRelFname(env.root, abs)) || tracked.includes(matchedFile);
}

async function admitEditable(matchedFile: string, state: SelectionState, env: SelectionEnv): Promise<SelectionState> {
  const abs = absRootPath(env.root, matchedFile);
  const inRoot = abs === env.root || abs.startsWith(`${env.root}/`);
  if (!inRoot && !isImageFile(matchedFile) && env.autoCommits) {
    env.host.error(`Can not add ${abs}, which is not within ${env.root}`);
    return state;
  }
  if (env.git.repoRoot() !== null && (await env.git.isGitIgnored(matchedFile))) {
    env.host.error(`Can't add ${matchedFile} which is in gitignore`);
    return state;
  }
  if (state.editable.includes(abs)) {
    env.host.error(`${matchedFile} is already in the chat as an editable file`);
    return state;
  }
  if (state.readOnly.includes(abs)) {
    if (await pathInRepo(matchedFile, abs, env)) {
      env.host.output(`Moved ${matchedFile} from read-only to editable files in the chat`);
      return { ...state, editable: [...state.editable, abs], readOnly: state.readOnly.filter((path) => path !== abs) };
    }
    env.host.error(`Cannot add ${matchedFile} as it's not part of the repository`);
    return state;
  }
  if (isImageFile(matchedFile) && !env.supportsImages) {
    env.host.error(`Cannot add image file ${matchedFile} as the model does not support images.`);
    return state;
  }
  const content = await readText(abs, env.tree, env.host);
  if (content === null) {
    env.host.error(`Unable to read ${matchedFile}`);
    return state;
  }
  env.host.output(`Added ${getRelFname(env.root, abs)} to the chat`);
  return { ...state, editable: [...state.editable, abs] };
}

/** `/add` body from `aider/commands.py:cmd_add`. */
export async function addFiles(args: string, state: SelectionState, env: SelectionEnv): Promise<SelectionState> {
  const matched = new Set<string>();
  for (const word of parseQuotedFilenames(args)) {
    for (const path of await matchAddWord(word, env)) matched.add(path);
  }
  let next = state;
  for (const path of [...matched].sort()) next = await admitEditable(path, next, env);
  return next;
}

/** Bare `/drop` retention of originally supplied read-only files. */
export function dropAll(state: SelectionState, root: string): SelectionState {
  if (!state.originalReadOnly.length) return { ...state, editable: [], readOnly: [] };
  const toKeep = state.readOnly.filter((abs) => {
    const rel = getRelFname(root, abs);
    return state.originalReadOnly.includes(abs) || state.originalReadOnly.includes(rel);
  });
  return { ...state, editable: [], readOnly: toKeep };
}

/** `/drop` with arguments. */
export async function dropMatches(args: string, state: SelectionState, env: SelectionEnv): Promise<SelectionState> {
  let editable = [...state.editable];
  let readOnly = [...state.readOnly];
  for (const word of parseQuotedFilenames(args)) {
    const expanded = expandUser(word);
    const readOnlyMatched = readOnly.filter((f) => {
      if (f.includes(expanded)) return true;
      try {
        return absRootPath(env.root, expanded) === f;
      } catch {
        return false;
      }
    });
    for (const matched of readOnlyMatched) {
      readOnly = readOnly.filter((path) => path !== matched);
      env.host.output(`Removed read-only file ${matched} from the chat`);
    }
    let matchedFiles: string[];
    if (/[*?[\]]/.test(expanded)) matchedFiles = await globFilteredToRepo(expanded, env);
    else matchedFiles = editable.map((f) => getRelFname(env.root, f)).filter((f) => f.includes(expanded));
    if (!matchedFiles.length) matchedFiles = [expanded];
    for (const matched of matchedFiles) {
      const abs = absRootPath(env.root, matched);
      if (editable.includes(abs)) {
        editable = editable.filter((path) => path !== abs);
        env.host.output(`Removed ${matched} from the chat`);
      }
    }
  }
  return { ...state, editable, readOnly };
}

async function addReadOnlyFile(abs: string, originalName: string, state: SelectionState, env: SelectionEnv): Promise<SelectionState> {
  if (isImageFile(originalName) && !env.supportsImages) {
    env.host.error(`Cannot add image file ${originalName} as the model does not support images.`);
    return state;
  }
  if (state.readOnly.includes(abs)) {
    env.host.error(`${originalName} is already in the chat as a read-only file`);
    return state;
  }
  if (state.editable.includes(abs)) {
    env.host.output(`Moved ${originalName} from editable to read-only files in the chat`);
    return { ...state, editable: state.editable.filter((path) => path !== abs), readOnly: [...state.readOnly, abs] };
  }
  env.host.output(`Added ${originalName} to read-only files.`);
  return { ...state, readOnly: [...state.readOnly, abs] };
}

async function addReadOnlyDirectory(abs: string, originalName: string, state: SelectionState, env: SelectionEnv): Promise<SelectionState> {
  const files = await expandSubdir(abs);
  let next = state;
  let added = 0;
  for (const file of files) {
    if (!next.editable.includes(file) && !next.readOnly.includes(file)) {
      next = { ...next, readOnly: [...next.readOnly, file] };
      added += 1;
    }
  }
  env.host.output(added > 0 ? `Added ${added} files from directory ${originalName} to read-only files.` : `No new files added from directory ${originalName}.`);
  return next;
}

/** `/read-only`. */
export async function readOnlyFiles(args: string, state: SelectionState, env: SelectionEnv): Promise<SelectionState> {
  if (!args.trim()) {
    let next = state;
    for (const fname of state.editable) {
      next = { ...next, editable: next.editable.filter((path) => path !== fname), readOnly: [...new Set([...next.readOnly, fname])] };
      env.host.output(`Converted ${getRelFname(env.root, fname)} to read-only`);
    }
    return next;
  }
  const allPaths: string[] = [];
  for (const pattern of parseQuotedFilenames(args)) {
    const expanded = expandUser(pattern);
    const pathObj = isAbsolute(expanded) ? expanded : join(env.root, expanded);
    let matches: string[] = [];
    if (await pathExists(pathObj)) matches = [pathObj];
    else if (isAbsolute(expanded)) {
      for await (const path of glob(expanded)) matches.push(path);
    } else {
      for await (const path of glob(expanded, { cwd: env.root })) matches.push(join(env.root, path));
    }
    if (!matches.length) env.host.error(`No matches found for: ${pattern}`);
    else allPaths.push(...matches);
  }
  let next = state;
  for (const path of [...allPaths].sort()) {
    const abs = absRootPath(env.root, path);
    if (await isFile(abs)) next = await addReadOnlyFile(abs, String(path), next, env);
    else if (await isDirectory(abs)) next = await addReadOnlyDirectory(abs, String(path), next, env);
    else env.host.error(`Not a file or directory: ${abs}`);
  }
  return next;
}

/** `/save` reconstruction commands. */
export function saveSelectionCommands(state: SelectionState, root: string): string[] {
  const lines = ['/drop'];
  for (const fname of [...state.editable].sort()) lines.push(`/add       ${getRelFname(root, fname)}`);
  for (const fname of [...state.readOnly].sort()) {
    try {
      const rel = relative(root, fname);
      lines.push(rel.startsWith('..') || isAbsolute(rel) ? `/read-only ${fname}` : `/read-only ${getRelFname(root, fname)}`);
    } catch {
      lines.push(`/read-only ${fname}`);
    }
  }
  return lines;
}

export function selectionFromSnapshot(snapshot: Snapshot): SelectionState {
  return {
    editable: snapshot.files.editable,
    readOnly: snapshot.files.readOnly,
    originalReadOnly: snapshot.originalReadOnly ?? [],
  };
}

export function applySelection(snapshot: Snapshot, state: SelectionState): Snapshot {
  return {
    ...snapshot,
    files: { editable: [...state.editable], readOnly: [...state.readOnly] },
    originalReadOnly: [...state.originalReadOnly],
  };
}
