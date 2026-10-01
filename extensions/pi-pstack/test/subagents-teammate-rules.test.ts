import { expect, test } from 'vitest';
import { AgentPreconditionError } from '../src/subagents/precondition-error.ts';
import { assertTeammateSpawnAllowed, dispatchesTeammate, teammateCaller } from '../src/subagents/teammate-rules.ts';

const teammate = { teammate: true, addressableWorkers: false };
const lead = { teammate: false, addressableWorkers: false };

function refusal(run: () => void): { code: string; message: string } | undefined {
  try {
    run();
  } catch (error) {
    if (error instanceof AgentPreconditionError) return { code: error.code, message: error.message };
    throw error;
  }
  return undefined;
}

test.for([
  { name: 'a named spawn from a teammate', spawn: { name: 'helper' }, code: 'subagent_nested_teammate', message: 'Teammates cannot spawn other teammates — the team roster is flat. To spawn a subagent instead, omit the `name` parameter.' },
  {
    name: 'an explicit background spawn',
    spawn: { runInBackground: true },
    code: 'subagent_teammate_background_denied',
    message: 'In-process teammates cannot spawn background agents. Use run_in_background=false for synchronous subagents.',
  },
  {
    name: 'a background:true definition',
    spawn: { definition: { agentType: 'watcher', background: true } },
    code: 'subagent_teammate_background_denied',
    message: "In-process teammates cannot spawn background agents. Agent 'watcher' has background: true in its definition.",
  },
  {
    name: 'a rewrite that backgrounded the spawn',
    spawn: { rewritten: { background: true, remote: false } },
    code: 'subagent_teammate_background_denied',
    message: "In-process teammates cannot spawn background agents; a plugin's agent.spawn hook backgrounded this one.",
  },
])('a teammate making $name is refused with the recovered message', ({ spawn, code, message }) => {
  expect(refusal(() => assertTeammateSpawnAllowed(spawn, teammate))).toEqual({ code, message });
});

test.for([
  { name: 'a synchronous unnamed spawn', spawn: { runInBackground: false } },
  { name: 'a rewrite that went remote', spawn: { rewritten: { background: true, remote: true } } },
  { name: 'a foreground rewrite', spawn: { rewritten: { background: false, remote: false } } },
])('a teammate making $name is allowed', ({ spawn }) => {
  expect(refusal(() => assertTeammateSpawnAllowed(spawn, teammate))).toBeUndefined();
});

test('a lead session is never restricted by the teammate rules', () => {
  expect(refusal(() => assertTeammateSpawnAllowed({ name: 'a', runInBackground: true, definition: { agentType: 'x', background: true } }, lead))).toBeUndefined();
});

test('named spawns stay allowed for a teammate once addressable workers are rolled out', () => {
  expect(refusal(() => assertTeammateSpawnAllowed({ name: 'helper' }, { teammate: true, addressableWorkers: true }))).toBeUndefined();
});

test('the caller is a teammate only when the child process says so', () => {
  expect([teammateCaller({}), teammateCaller({ PSTACK_TEAMMATE: '1', CLAUDE_CODE_ADDRESSABLE_WORKERS: 'true' })]).toEqual([lead, { teammate: true, addressableWorkers: true }]);
});

const teams = { CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' };

test.for([
  { name: 'a team context, a name and no isolation or cwd', input: { env: teams, name: 'w' }, expected: true },
  { name: 'no team context', input: { env: {}, name: 'w' }, expected: false },
  { name: 'no name', input: { env: teams }, expected: false },
  { name: 'an isolation', input: { env: teams, name: 'w', isolation: 'worktree' }, expected: false },
  { name: 'a cwd', input: { env: teams, name: 'w', cwd: '/tmp' }, expected: false },
  { name: 'the web-fetch type', input: { env: teams, name: 'w', agentType: 'web-fetch' }, expected: false },
  { name: 'a teammate caller', input: { env: teams, name: 'w', caller: teammate }, expected: false },
  { name: 'rolled-out addressable workers', input: { env: teams, name: 'w', caller: { teammate: false, addressableWorkers: true } }, expected: false },
])('dispatch for $name is $expected', ({ input, expected }) => {
  expect(dispatchesTeammate({ caller: lead, ...input })).toBe(expected);
});
