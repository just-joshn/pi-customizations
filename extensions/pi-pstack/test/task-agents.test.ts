import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, test } from 'vitest';
import { findAgent, loadAgentDefinitions } from '../src/task/agents.ts';

describe('subagent definitions', () => {
  test('ships generalPurpose plus the two pstack agents (TASK-006)', () => {
    const agents = loadAgentDefinitions();
    expect(agents.map((agent) => agent.type)).toEqual(['generalPurpose', 'comment-sicko', 'poteto-agent']);
  });

  test('reads Cursor frontmatter: name, description, is_background, and the prompt body (TASK-006, TASK-009)', () => {
    const poteto = findAgent(loadAgentDefinitions(), 'poteto-agent');
    expect(poteto).toMatchObject({ type: 'poteto-agent', background: true, readonly: false });
    expect(poteto.description.startsWith('Delegate subagent for code-writing and helper tasks spawned during a `/poteto-mode` run.')).toBe(true);
    expect(poteto.prompt).toBe(
      "# Poteto subagent\n\nYou are operating as poteto-mode's full agent style. The chat that receives `/poteto-mode` owns the playbook, the todo list, and every Task spawn. You are one of its delegates. Read the `poteto-mode` skill's `SKILL.md` in full before doing any work, including its inline Principles index. Use the absolute path your parent gave you. Navigate to a leaf `principle-*` skill whenever you apply that principle.",
    );
    const sicko = findAgent(loadAgentDefinitions(), 'comment-sicko');
    expect(sicko).toMatchObject({ type: 'comment-sicko', background: false, readonly: false });
    expect(sicko.prompt.startsWith('# Comment Sicko\n\nMy first output when spawned is exactly this.')).toBe(true);
  });

  test('defaults an omitted subagent_type to generalPurpose with no extra prompt (TASK-006)', () => {
    expect(findAgent(loadAgentDefinitions(), undefined)).toMatchObject({ type: 'generalPurpose', prompt: '', background: false });
  });

  test('rejects an unknown type with the valid list (TASK-006)', () => {
    expect(() => findAgent(loadAgentDefinitions(), 'explore')).toThrow('Unknown subagent_type "explore". Available subagent types: generalPurpose, comment-sicko, poteto-agent.');
  });

  test('the pre-0.15.20 display name is no longer a type, as upstream renamed the agent id (TASK-006)', () => {
    expect(() => findAgent(loadAgentDefinitions(), 'Comment Sicko')).toThrow('Unknown subagent_type "Comment Sicko".');
  });
});

describe('agent file parsing', () => {
  let dir = '';
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  test('derives the name from the file and honors model and readonly', () => {
    dir = mkdtempSync(join(tmpdir(), 'agents-'));
    writeFileSync(join(dir, 'auditor.md'), '---\ndescription: Audits.\nmodel: claude-opus-5-5-high\nreadonly: true\n---\nAudit it.\n');
    const [, auditor] = loadAgentDefinitions(dir);
    expect(auditor).toEqual({ type: 'auditor', description: 'Audits.', model: 'claude-opus-5-5-high', readonly: true, background: false, prompt: 'Audit it.', file: join(dir, 'auditor.md') });
  });
});
