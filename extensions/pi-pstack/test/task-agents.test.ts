import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { findAgent, loadAgentDefinitions } from '../src/task/agents.ts';
import { resolveSubagentModel } from '../src/task/models.ts';
import { cursorAgents as cursor, forPi } from './cursor-reference.ts';

// Cursor's reminder is the shared subagent reminder, a blank line, then the type's own text.
const ownReminder = (reminder: string) => forPi(reminder).slice(forPi(cursor.subagentReminder).length).replace(/^\n\n/, '');

describe('subagent definitions match Cursor', () => {
  test('ships the built-in generalPurpose, explore, and shell types plus pstack and team-kit agents', () => {
    expect(loadAgentDefinitions().map((agent) => agent.type)).toEqual(['generalPurpose', 'explore', 'shell', 'ci-watcher', 'comment-sicko', 'poteto-agent', 'thermo-nuclear-code-quality-review']);
  });

  test.for(cursor.builtIns.map((agent) => [agent.type, agent] as const))('built-in %s has Cursor desktop description and reminder', ([type, expected]) => {
    const agent = findAgent(loadAgentDefinitions(), type);
    expect({ description: agent.description, reminder: agent.reminder }).toEqual({ description: expected.description, reminder: ownReminder(expected.reminder) });
  });

  test.for(cursor.agents.map((agent) => [agent.type, agent] as const))('plugin agent %s loads as Cursor loads plugin agents', ([type, expected]) => {
    const agent = findAgent(loadAgentDefinitions(), type);
    expect({ description: agent.description, readonly: agent.readonly, reminder: agent.reminder }).toEqual({ description: expected.description, readonly: expected.readonly, reminder: ownReminder(expected.reminder) });
  });

  test('plugin agents run in the foreground on the parent model, as Cursor strips their model and is_background', () => {
    const parent = { provider: 'p', id: 'm', thinking: 'high' as const };
    const available = [
      { provider: 'p', id: 'm', reasoning: true, levels: ['low', 'high'] },
      { provider: 'p', id: 'm-fast', reasoning: true, levels: ['low', 'high'] },
    ];
    expect(cursor.agents.map(({ type, model, background }) => ({ type, model, background }))).toEqual(cursor.agents.map(({ type }) => ({ type, model: 'inherit', background: false })));
    expect(resolveSubagentModel(undefined, available, parent)).toEqual(parent);
  });

  test('explore never launches subagents', () => {
    expect(findAgent(loadAgentDefinitions(), 'explore').spawns).toBe(false);
  });

  test.for([
    { input: 'shell', expected: 'shell' },
    { input: 'SHELL', expected: 'shell' },
    { input: 'shell_agent', expected: 'shell' },
    { input: ' shell-subagent-type ', expected: 'shell' },
    { input: 'shellmode', expected: 'shell' },
    { input: 'General-Purpose-Agent', expected: 'generalPurpose' },
    { input: 'POTETO_AGENT', expected: 'poteto-agent' },
    { input: 'poteto-agent-mode', expected: 'poteto-agent' },
    { input: '', expected: 'generalPurpose' },
  ])('resolves $input to its canonical type (HOST-AGENT-TYPE-LOOKUP)', ({ input, expected }) => {
    expect(findAgent(loadAgentDefinitions(), input).type).toBe(expected);
  });

  test('defaults an omitted subagent_type to generalPurpose with only the shared reminder', () => {
    expect(findAgent(loadAgentDefinitions(), undefined)).toMatchObject({ type: 'generalPurpose', reminder: '', readonly: false });
  });

  test('rejects an unknown type with the valid list', () => {
    expect(() => findAgent(loadAgentDefinitions(), 'not-installed')).toThrow(
      'Unknown subagent_type "not-installed". Available subagent types: generalPurpose, explore, shell, ci-watcher, comment-sicko, poteto-agent, thermo-nuclear-code-quality-review.',
    );
  });

  test('the pre-0.15.20 display name is no longer a type, as upstream renamed the agent id', () => {
    expect(() => findAgent(loadAgentDefinitions(), 'Comment Sicko')).toThrow('Unknown subagent_type "Comment Sicko".');
  });
});

describe('agent file parsing follows Cursor plugin-agent rules', () => {
  const withAgents = (files: Record<string, string>) => {
    const dir = mkdtempSync(join(tmpdir(), 'agents-'));
    for (const [name, text] of Object.entries(files)) writeFileSync(join(dir, name), text);
    return dir;
  };

  test('readonly comes only from permissionMode, and model, tools, and background frontmatter change nothing', ({ onTestFinished }) => {
    const dir = withAgents({
      'auditor.md': '---\ndescription: Audits.\nmodel: claude-opus-5-5-high\nreadonly: true\nis_background: true\ntools: read, grep\n---\nAudit it.\n',
      'watcher.md': '---\ndescription: Watches.\npermissionMode: " ReadOnly "\nbackground: true\n---\nWatch it.\n',
    });
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    const agents = loadAgentDefinitions(dir);
    expect(findAgent(agents, 'auditor')).toEqual({
      type: 'auditor',
      description: 'Audits.',
      readonly: false,
      reminder: 'You are operating as the "auditor" custom subagent. DO NOT create unnecessary markdown files unless explicitly requested by the user.\nAudits.\n\nAudit it.',
      file: join(dir, 'auditor.md'),
    });
    expect(findAgent(agents, 'watcher').readonly).toBe(true);
  });

  test('a missing name comes from the file name, and a missing description adds no line', ({ onTestFinished }) => {
    const dir = withAgents({ 'my agent_x.md': 'Just do it.\n' });
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    expect(findAgent(loadAgentDefinitions(dir), 'my-agent-x')).toMatchObject({
      type: 'my-agent-x',
      description: '',
      reminder: 'You are operating as the "my-agent-x" custom subagent. DO NOT create unnecessary markdown files unless explicitly requested by the user.\n\nJust do it.',
    });
  });

  test('an agent file with no body or broken YAML is not a type', ({ onTestFinished }) => {
    const dir = withAgents({ 'empty.md': '---\nname: empty\ndescription: Nothing.\n---\n\n', 'broken.md': '---\nname: [broken\n---\nBody.\n' });
    onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
    expect(loadAgentDefinitions(dir).map((agent) => agent.type)).toEqual(['generalPurpose', 'explore', 'shell']);
  });
});
