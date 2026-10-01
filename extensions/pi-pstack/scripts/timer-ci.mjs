import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import Type from 'typebox';
import { Check } from 'typebox/value';

const run = promisify(execFile);
const REPO = '^([A-Za-z0-9.-]+/)?[A-Za-z0-9._-]+/[A-Za-z0-9._-]+$';
const TERMINAL = new Set(['success', 'failure', 'merged', 'closed']);

export const CiToolSchema = Type.Object({
  pr: Type.Integer({ minimum: 1 }),
  repo: Type.Optional(Type.String({ pattern: REPO })),
  pollSeconds: Type.Optional(Type.Integer({ minimum: 1, maximum: 86400 })),
  name: Type.Optional(Type.String({ minLength: 1, maxLength: 160 })),
  prompt: Type.Optional(Type.String({ minLength: 1 })),
});

const CiSchema = Type.Intersect([
  CiToolSchema,
  Type.Object({ forge: Type.Union([Type.Literal('github'), Type.Literal('origin')]), cwd: Type.String({ minLength: 1 }), command: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { minItems: 1 })) }),
]);

export function parseCi(input) {
  if (!Check(CiSchema, input) || (input.name !== undefined && !input.name.trim()) || (input.prompt !== undefined && !input.prompt.trim())) throw new Error('Invalid CI subscription: forge, pr, repo, pollSeconds and cwd must be well formed.');
  if (input.forge === 'origin' && !input.command) throw new Error('Invalid CI subscription: an origin subscription needs the forge-neutral command contract.');
  const label = ciLabel(input);
  return { ...input, pollSeconds: input.pollSeconds ?? 30, name: input.name ?? `ci-${input.forge}-${input.repo ?? 'cwd'}-${input.pr}`, prompt: input.prompt ?? `Check the CI result for ${label} and act on it.` };
}

export const ciLabel = (ci) => `${ci.repo ?? ci.forge}#${ci.pr}`;

function classify(checks) {
  if (checks.some((check) => check.bucket === 'pending')) return 'pending';
  return checks.some((check) => check.bucket === 'fail' || check.bucket === 'cancel') ? 'failure' : 'success';
}

async function gh(args, cwd) {
  try {
    return (await run('gh', args, { cwd, timeout: 20000, maxBuffer: 8 * 1024 * 1024 })).stdout;
  } catch (error) {
    if (error.stdout?.trim()) return error.stdout;
    if (/no checks reported/i.test(error.stderr ?? '')) return '[]';
    throw new Error(`gh ${args.slice(0, 2).join(' ')} failed: ${(error.stderr || error.message).trim()}`);
  }
}

async function github(ci) {
  const repo = ci.repo ? ['-R', ci.repo] : [];
  const view = JSON.parse(await gh(['pr', 'view', String(ci.pr), ...repo, '--json', 'headRefOid,state,url'], ci.cwd));
  if (view.state === 'MERGED' || view.state === 'CLOSED') return { head: view.headRefOid, state: view.state.toLowerCase(), summary: `${view.url} is ${view.state.toLowerCase()}.` };
  const checks = JSON.parse(await gh(['pr', 'checks', String(ci.pr), ...repo, '--json', 'name,bucket,state,link'], ci.cwd));
  const state = checks.length ? classify(checks) : 'pending';
  const summary = checks.length ? checks.map((check) => `${check.name}: ${check.bucket}${check.link ? ` ${check.link}` : ''}`).join('\n') : 'No checks reported yet.';
  return { head: view.headRefOid, state, summary };
}

async function neutral(ci) {
  const [executable, ...args] = ci.command;
  const { stdout } = await run(executable, [...args, String(ci.pr)], { cwd: ci.cwd, timeout: 20000, maxBuffer: 8 * 1024 * 1024, env: { ...process.env, ...(ci.repo ? { PSTACK_CI_REPO: ci.repo } : {}) } });
  const result = JSON.parse(stdout);
  if (typeof result.head !== 'string' || !['pending', ...TERMINAL].includes(result.state)) throw new Error('CI command contract violated: print {"head": string, "state": pending|success|failure|merged|closed, "summary"?: string}.');
  return { head: result.head, state: result.state, summary: result.summary ?? '' };
}

export const checkCi = (ci) => (ci.forge === 'github' ? github(ci) : neutral(ci));

export function ciObservation(previous, observed) {
  const base = { state: observed.state, head: observed.head, error: undefined };
  if (observed.state === 'pending') return { ci: { ...previous, ...base, notified: undefined } };
  const key = `${observed.head}:${observed.state}`;
  if (key === previous.notified) return { ci: { ...previous, ...base } };
  return { ci: { ...previous, ...base, notified: key, report: observed }, wake: true };
}

export function wakeText(item) {
  const report = item.ci?.report;
  if (!report) return item.receipt.prompt;
  return `CI for ${ciLabel(item.receipt)} reached ${report.state} at ${report.head.slice(0, 12)}.\n${report.summary}\n\n${item.receipt.prompt}`;
}
