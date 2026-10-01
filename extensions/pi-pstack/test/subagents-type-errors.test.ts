import { expect, test, vi } from 'vitest';
import { AgentPreconditionError } from '../src/subagents/precondition-error.ts';
import { workerFixture } from './worker-fixture.ts';

test('[G1-10] missing implicit type retains source error identity and telemetry reason', async () => {
  vi.stubEnv('CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS', '1');
  const fixture = await workerFixture({ flags: { agents: JSON.stringify({ explicit: { description: 'explicit worker', prompt: 'Work directly.' } }) } });
  const refusals: unknown[] = [];
  const off = fixture.eventBus.on('pstack:subagent-refused', (value) => refusals.push(value));
  try {
    const operation = fixture.call('Agent', { description: 'missing type', prompt: 'ordinary task' });
    await expect(operation).rejects.toMatchObject({ name: 'AgentTypeError', code: 'subagent_type_missing', message: 'subagent_type is required: the general-purpose agent is not available in this session. Available agents: explicit' });
    await expect(operation).rejects.not.toBeInstanceOf(AgentPreconditionError);
    expect(refusals).toEqual([{ code: 'subagent_type_missing' }]);
    expect((await fixture.call('ListAgents', {})).details).toEqual({ agents: [] });
  } finally {
    off();
    await fixture.close();
  }
});

test('[G1-10] ambiguous normalized type retains a distinct type error and creates no child', async () => {
  const definitions = { 'case-one': { description: 'first spelling', prompt: 'Work directly.' }, CASE_ONE: { description: 'second spelling', prompt: 'Work directly.' } };
  const fixture = await workerFixture({ flags: { agents: JSON.stringify(definitions) } });
  const refusals: unknown[] = [];
  const off = fixture.eventBus.on('pstack:subagent-refused', (value) => refusals.push(value));
  try {
    const operation = fixture.call('Agent', { description: 'ambiguous type', prompt: 'ordinary task', subagent_type: 'case one' });
    await expect(operation).rejects.toMatchObject({ name: 'AgentTypeError', code: 'subagent_type_ambiguous', message: "Agent type 'case one' is ambiguous \u2014 matches CASE_ONE, case-one. Use the exact name: CASE_ONE or case-one" });
    await expect(operation).rejects.not.toBeInstanceOf(AgentPreconditionError);
    expect(refusals).toEqual([{ code: 'subagent_type_ambiguous' }]);
    expect((await fixture.call('ListAgents', {})).details).toEqual({ agents: [] });
  } finally {
    off();
    await fixture.close();
  }
});
