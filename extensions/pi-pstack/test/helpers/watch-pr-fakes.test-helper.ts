import { chmodSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { scratchDir } from './scratch.ts';
export interface FakeReply {
  readonly code?: number;
  readonly stdout?: string;
  readonly stderr?: string;
  readonly delayMs?: number;
}
export interface FakeRule {
  readonly tool: 'gh' | 'git';
  readonly match: readonly string[];
  readonly replies: readonly FakeReply[];
}
export interface FakeCall {
  readonly tool: string;
  readonly argv: readonly string[];
  readonly ppid: number;
}
export interface FakeBin {
  readonly dir: string;
  readonly calls: () => FakeCall[];
}

const FAKE_PROGRAM = `#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";

const dir = process.env.FAKE_BIN_DIR;
const tool = basename(process.argv[1]);
const argv = process.argv.slice(2);
appendFileSync(join(dir, "calls.jsonl"), JSON.stringify({ tool, argv, ppid: process.ppid }) + "\\n");
const rules = JSON.parse(readFileSync(join(dir, "rules.json"), "utf8"));
const statePath = join(dir, "state.json");
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath, "utf8")) : {};
const joined = argv.join(" ");
const index = rules.findIndex((rule) => rule.tool === tool && rule.match.every((part) => joined.includes(part)));
if (index < 0) {
  process.stderr.write("no fake rule for " + tool + " " + joined.slice(0, 200) + "\\n");
  process.exit(99);
}
const seen = state[index] ?? 0;
state[index] = seen + 1;
writeFileSync(statePath, JSON.stringify(state));
const reply = rules[index].replies[Math.min(seen, rules[index].replies.length - 1)];
if (reply.delayMs) await Bun.sleep(reply.delayMs);
process.stdout.write(reply.stdout ?? "");
process.stderr.write(reply.stderr ?? "");
process.exit(reply.code ?? 0);
`;

export function installFakeBin(rules: readonly FakeRule[]): FakeBin {
  const dir = scratchDir('watch-pr-fakes-');
  writeFileSync(join(dir, 'rules.json'), JSON.stringify(rules));
  writeFileSync(join(dir, 'calls.jsonl'), '');
  for (const tool of ['gh', 'git']) {
    writeFileSync(join(dir, tool), FAKE_PROGRAM);
    chmodSync(join(dir, tool), 0o755);
  }
  const calls = (): FakeCall[] =>
    readFileSync(join(dir, 'calls.jsonl'), 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as FakeCall);
  return { dir, calls };
}

export function emptyBin(): string {
  return scratchDir('watch-pr-empty-');
}

export function fakeEnv(bin: FakeBin, extra: Record<string, string> = {}): Record<string, string> {
  return { PATH: `${bin.dir}:${process.env.PATH ?? ''}`, FAKE_BIN_DIR: bin.dir, ...extra };
}

export async function withEnv<T>(env: Record<string, string>, body: () => Promise<T>): Promise<T> {
  const saved = Object.fromEntries(Object.keys(env).map((key) => [key, process.env[key]]));
  Object.assign(process.env, env);
  try {
    return await body();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

export function ok(value: unknown): FakeReply {
  return { stdout: JSON.stringify(value) };
}

export const prView = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  mergeable: 'MERGEABLE',
  mergeStateStatus: 'CLEAN',
  reviewDecision: 'APPROVED',
  headRefOid: 'head',
  headRefName: 'feature',
  baseRefName: 'main',
  state: 'OPEN',
  mergedAt: null,
  isDraft: false,
  ...overrides,
});

export const fastCheck = (name: string, bucket: string, state: string): Record<string, string> => ({
  name,
  state,
  bucket,
  description: '',
  link: '',
  workflow: '',
});

export const threadsPage = (nodes: unknown[], pageInfo?: Record<string, unknown>): unknown => ({
  data: { repository: { pullRequest: { reviewThreads: { ...(pageInfo ? { pageInfo } : {}), nodes } } } },
});

export const thread = (id: string, isResolved: boolean): Record<string, unknown> => ({
  id,
  isResolved,
  comments: { nodes: [{ body: 'fix', createdAt: '2026-01-01T00:00:00Z', path: 'a.ts', line: 3, author: { login: 'human' } }] },
});

export const rollupPage = (nodes: unknown[], pageInfo: Record<string, unknown>): unknown => ({
  data: { repository: { pullRequest: { commits: { nodes: [{ commit: { statusCheckRollup: { contexts: { pageInfo, nodes } } } }] } } } },
});

export const commitsPage = (commits: { oid: string; state: string | null }[]): unknown => ({
  data: {
    repository: {
      pullRequest: {
        commits: {
          nodes: commits.map((commit) => ({
            commit: { oid: commit.oid, statusCheckRollup: commit.state === null ? null : { state: commit.state } },
          })),
        },
      },
    },
  },
});
