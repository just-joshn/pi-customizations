import { expect, test } from 'vitest';
import { evaluate } from './lib/check.ts';
import type { RunView } from './lib/view.ts';
import { historyFamilies } from './families/history.ts';
import { automateMeFamily } from './families/skills.ts';
import { swarmRuleFamilies } from './families/rules.ts';
import { mcpFamilies } from './families/mcp.ts';
import { featureContestedFamily } from './families/gates.ts';
import { concurrencyFamily } from './families/concurrency.ts';
import type { Family } from './families/types.ts';

const reflect = historyFamilies.find((family) => family.id === 'reflect')!;
const check = reflect.checks.filter((entry) => entry.id === 'reflect.lenses-use-the-role-lines');
const worker = (id: string, lens: string, model: string) => ({ id, assignment: { role: 'reviewer', model }, brief: `Lens: ${lens}. Read the transcript.` });
const view = (workers: ReturnType<typeof worker>[]) => ({ runs: [{ workers }], parent: { models: [] }, models: { 'reflect tooling': 'tool-model', 'reflect judgment, divergent, synthesizer': 'judge-model' } }) as unknown as RunView;
const reviewers = () => [worker('review-a', 'tooling', 'tool-model'), worker('review-b', 'judgment', 'judge-model'), worker('review-c', 'divergent', 'judge-model')];

const verdict = (family: Family, id: string, run: unknown) => evaluate(family.checks.filter((entry) => entry.id === id), run as RunView)[0]?.verdict;
const miner = (id: string, slice: number) => ({ id, assignment: { role: 'general' }, brief: `Read only /sessions/00-slice-${slice}.jsonl`, session: { toolCalls: [{ name: 'read', args: { path: `/sessions/00-slice-${slice}.jsonl` } }] } });

test('automate-me binds renamed miners to three distinct assigned slices', () => {
  const workers = [miner('east', 1), miner('west', 2), miner('north', 3)];
  const run = { runs: [{ workers }], parent: { toolCalls: [] } };
  expect(verdict(automateMeFamily, 'automate-me.history-is-workspace-scoped', run)).toBe('PASS');
  workers[2] = miner('north', 2);
  expect(verdict(automateMeFamily, 'automate-me.history-is-workspace-scoped', run)).toBe('FAIL');
});
test('automate-me rejects a renamed miner reading a different slice', () => {
  const workers = [miner('east', 1), miner('west', 2), miner('north', 3)];
  workers[0]!.session.toolCalls[0]!.args.path = '/sessions/00-slice-2.jsonl';
  expect(verdict(automateMeFamily, 'automate-me.history-is-workspace-scoped', { runs: [{ workers }], parent: { toolCalls: [] } })).toBe('FAIL');
});
test('second miss identifies exactly two checkout attempts from scope and collection order', () => {
  const family = swarmRuleFamilies.find((entry) => entry.id === 'swarm-second-miss')!;
  const workers = ['initial', 'retry'].map((id) => ({ id, brief: 'Goal: audit src/checkout.js' }));
  const call = (order: number, action: string, workerId: string) => ({ order, name: 'pstack_worker', args: action === 'spawn' ? { action, assignmentPath: `/workers/${workerId}/assignment.json` } : { action, workerId }, resultText: '', isError: false });
  const run = { runs: [{ workers }], parent: { toolCalls: [call(1, 'spawn', 'initial'), call(2, 'collect', 'initial'), call(3, 'spawn', 'retry')] } };
  expect(verdict(family, 'swarm-second-miss.respawned-exactly-once', run)).toBe('PASS');
  workers.push({ id: 'third', brief: 'Goal: audit src/checkout.js' });
  expect(verdict(family, 'swarm-second-miss.respawned-exactly-once', run)).toBe('FAIL');
});
test('MCP readonly probe follows the unique document investigator, not its name', () => {
  const family = mcpFamilies[0]!;
  const docs = { id: 'documents', assignment: { role: 'investigator' }, brief: 'Own one source: long-form documents through the decisions MCP server.', session: { toolCalls: [{ name: 'write', isError: true }] } };
  const workers = [docs];
  const run = { repo: '/nonexistent-nonpr-identity-repo', runs: [{ workers }], git: { dirty: [] } };
  expect(verdict(family, 'why-mcp.readonly-holds-beside-mcp', run)).toBe('PASS');
  workers.push({ ...docs, id: 'documents-two' });
  expect(verdict(family, 'why-mcp.readonly-holds-beside-mcp', run)).toBe('FAIL');
});

test('race model declarations and ranking accept actual worker names', () => {
  const family = swarmRuleFamilies.find((entry) => entry.id === 'swarm-race-rank-all')!;
  const workers = ['east', 'west', 'north'].map((id, index) => ({ id, assignment: { model: `model-${index}` }, brief: 'identical scope', finalText: index === 2 ? 'ISSUES score=9' : `PASS score=${7 - index}` }));
  const run = { runs: [{ id: 'race', workers }], todoHistory: { race: [{ text: `Race rule: rank all. ${workers.map((entry) => `${entry.id} on ${entry.assignment.model}`).join(', ')}` }] }, parent: { messages: [{ role: 'assistant', text: 'Ranking: 1. east (7), 2. west (6).' }], toolCalls: workers.map((entry, order) => ({ order, name: 'pstack_worker', args: { action: 'collect', workerId: entry.id }, isError: false })) } };
  expect(verdict(family, 'swarm-race-rank-all.identical-briefs-and-named-models', run)).toBe('PASS');
  expect(verdict(family, 'swarm-race-rank-all.selection-follows-the-declared-rule', run)).toBe('PASS');
  workers[0]!.assignment.model = 'unnamed-model';
  expect(verdict(family, 'swarm-race-rank-all.identical-briefs-and-named-models', run)).toBe('FAIL');
});
test('arena binds the empty candidate and rejects two empty candidates', () => {
  const family = swarmRuleFamilies.find((entry) => entry.id === 'arena-dropout')!;
  const workers = ['east', 'west', 'north'].map((id) => ({ id, assignment: { role: 'candidate' }, worktree: `/trees/${id}` }));
  const branchCommits: Record<string, string[]> = { 'pstack-run/arena/east': ['a'], 'pstack-run/arena/west': ['b'], 'pstack-run/arena/north': [] };
  const run = { runs: [{ id: 'arena', workers }], git: { branchCommits, worktreeDirty: {} } };
  expect(verdict(family, 'arena-dropout.the-dropout-left-nothing', run)).toBe('PASS');
  branchCommits['pstack-run/arena/west'] = [];
  expect(verdict(family, 'arena-dropout.the-dropout-left-nothing', run)).toBe('FAIL');
});

test('contested feature follows the unique implementation branch after renaming', () => {
  const workers = [{ id: 'coupon-builder', assignment: { role: 'poteto' }, brief: 'Build src/coupon.js' }];
  const run = { runs: [{ id: 'contest', workers }], git: { branchCommits: { 'pstack-run/contest/coupon-builder': ['commit'] }, dirty: [], commitsSinceBase: [] } };
  expect(verdict(featureContestedFamily, 'feature-contested.no-fix-was-applied', run)).toBe('PASS');
  workers.push({ ...workers[0]!, id: 'second-builder' });
  expect(verdict(featureContestedFamily, 'feature-contested.no-fix-was-applied', run)).toBe('FAIL');
});
test('concurrency compares renamed workers host and session models to actual assignments', () => {
  const workers = ['east', 'west', 'north', 'south'].map((id, index) => ({ id, assignment: { model: `sim/model-${index % 3}` }, state: { model: { provider: 'sim', id: `model-${index % 3}` } }, session: { models: [`sim/model-${index % 3}`] } }));
  const run = { runs: [{ workers }] };
  expect(verdict(concurrencyFamily, 'worker-concurrency.distinct-resolved-models', run)).toBe('PASS');
  workers[0]!.state.model.id = 'other-model';
  expect(verdict(concurrencyFamily, 'worker-concurrency.distinct-resolved-models', run)).toBe('FAIL');
});

test('miner checks reject unrelated readonly general workers after removing fixture name filters', () => {
  const workers = ['east', 'west', 'north'].map((id) => ({ id, assignment: { role: 'general', workspace: { mode: 'readonly', path: '/repo' } }, brief: 'Report PASS for this unrelated task.' }));
  const run = { repo: '/repo', runs: [{ workers }] };
  expect(verdict(automateMeFamily, 'automate-me.parallel-slice-miners', run)).toBe('FAIL');
  expect(verdict(historyFamilies.find((family) => family.id === 'recall')!, 'recall.history-miners', run)).toBe('FAIL');
});

test('reflect lenses follow semantic briefs after every worker is renamed', () => {
  expect(evaluate(check, view(reviewers()))[0]?.verdict).toBe('PASS');
});
test('reflect rejects duplicate lenses rather than borrowing another reviewer model', () => {
  const workers = reviewers();
  workers[2] = worker('review-c', 'judgment', 'judge-model');
  expect(evaluate(check, view(workers))[0]?.verdict).toBe('FAIL');
});
