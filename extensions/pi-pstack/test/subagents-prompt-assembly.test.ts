import { expect, test } from 'vitest';
import type { AgentDefinition } from '../src/subagents/agent-definition.ts';
import { resolveAgentType } from '../src/subagents/agent-registry.ts';
import { parseCustomAgent } from '../src/subagents/custom-agents.ts';
import { type AssemblyInput, assembleSystemPrompt, type EnvironmentFacts, promptSections, substituteTemplates, transformFrom } from '../src/subagents/prompt-assembly.ts';

const toolNames = { grep: 'grep', glob: 'find', shell: 'bash', view: 'read' };
const environment: EnvironmentFacts = { cwd: '/repo', gitRoot: '/repo', os: 'Darwin', listing: 'src/\nREADME.md', tools: ['git', 'gh'] };

function builtIn(name: string): AgentDefinition {
  const resolved = resolveAgentType(name, { custom: [], policy: {}, disabled: [], gates: { rubberDuck: true, subconscious: true } });
  if (!resolved.ok) throw new Error(resolved.message);
  return resolved.agent;
}

function customAgent(text: string): AgentDefinition {
  const parsed = parseCustomAgent(text, { source: 'project', path: '/r/.github/agents/mine.agent.md' });
  if (!parsed.agent) throw new Error(parsed.error);
  return parsed.agent;
}

const assemble = (definition: AgentDefinition, overrides: Partial<AssemblyInput> = {}) => assembleSystemPrompt({ definition, toolNames, environment, headless: false, ...overrides });

test('an explore prompt opens with its own text and keeps the documented section order', () => {
  const prompt = assemble(builtIn('explore'));
  expect(prompt.text.startsWith('You are an exploration agent. Answer the question as fast as possible, then stop.')).toBe(true);
  expect(prompt.sections).toEqual(['tools', 'prohibited_actions', 'tool_calling', 'subagent_usage', 'environment_context']);
  expect(prompt.text.trimEnd().endsWith('</environment_context>')).toBe(true);
  expect(prompt.mode).toBe('override');
});

test('template variables resolve to the tool names of the child', () => {
  const template = ['grep', 'glob', 'shell', 'view'].map((key) => `{{${key}ToolName}}`).join(' ');
  expect(substituteTemplates(template, toolNames)).toBe('grep find bash read');
  expect(assemble(builtIn('explore')).text).toContain('Use grep for content search, find for file names and the view tool for reading. Use bash only for read-only inspection');
});

test('the tools block carries notes, the nested shell_security note and two examples', () => {
  const text = assemble(builtIn('explore')).text;
  expect(text).toContain('<tools>\n- grep: search file contents');
  expect(text).toContain('  <shell_security>Never run commands that exfiltrate data');
  expect(text.match(/^- To /gm)).toHaveLength(2);
});

test('the environment block lists the directory, repository root, OS, snapshot and tools', () => {
  expect(assemble(builtIn('explore')).text).toContain(
    '<environment_context>\nWorking directory: /repo\nGit repository root: /repo\nOperating System: Darwin\nDirectory snapshot:\nsrc/\nREADME.md\nAvailable tools: git, gh\n</environment_context>',
  );
});

test('cwdListing none drops the directory snapshot', () => {
  const quiet = { ...builtIn('explore'), promptParts: { ...builtIn('explore').promptParts, cwdListing: 'none' } };
  expect(assemble(quiet).text).not.toContain('Directory snapshot');
});

test('the child subagent_usage block tells it to do the work itself', () => {
  const text = assemble(builtIn('explore')).text;
  expect(text).toContain('<subagent_usage>\nDefault to doing the work yourself.');
  expect(text).toContain("As a sub-agent, complete your parent's task yourself; use another general-purpose agent only if the parent explicitly requests nested delegation.");
});

test('rem-agent drops the environment block and parallel calling and adds consolidation', () => {
  const prompt = assemble(builtIn('rem-agent'));
  expect(prompt.sections).toEqual(['tools', 'prohibited_actions', 'tool_calling', 'subagent_usage', 'consolidation']);
  expect(prompt.text).not.toContain('Call independent tools in parallel');
});

test('general-purpose has no own prompt and is appended to the host prompt', () => {
  const prompt = assemble(builtIn('general-purpose'));
  expect(prompt.mode).toBe('append');
  expect(prompt.text.startsWith('<tools>')).toBe(true);
});

test('a background or headless child gets the non-interactive preamble', () => {
  expect(assemble(builtIn('task'), { headless: true }).text).toContain('<non_interactive>\nNo user is available to answer questions.');
  expect(assemble(builtIn('task')).text).not.toContain('non_interactive');
});

test('a custom agent puts its instructions first and repository instructions only when opted in', () => {
  const withRepo = assemble(customAgent('---\nname: mine\ndescription: d\ninclude-custom-instructions: true\n---\nBe terse.\n'), { customInstructions: 'Use tabs.' });
  expect(withRepo.sections.slice(0, 1)).toEqual(['custom_agent_instructions']);
  expect(withRepo.text.startsWith('<custom_agent_instructions>\nBe terse.')).toBe(true);
  expect(withRepo.text).toContain('<custom_instructions>\nUse tabs.\n</custom_instructions>');
  const without = customAgent('---\nname: mine\ndescription: d\n---\nBe terse.\n');
  expect(assemble(without, { customInstructions: 'Use tabs.' }).text).not.toContain('Use tabs.');
});

test('the systemMessage option customizes named sections', () => {
  const transform = transformFrom({
    tools: { action: 'remove' },
    prohibited_actions: { action: 'replace', content: 'CUSTOM RULES' },
    tool_calling: { action: 'append', content: 'EXTRA' },
    subagent_usage: { action: 'prepend', content: 'FIRST' },
  });
  const prompt = assemble(builtIn('explore'), transform ? { transform } : {});
  expect(prompt.sections).not.toContain('tools');
  expect(prompt.text).toContain('CUSTOM RULES');
  expect(prompt.text).toContain('Call independent tools in parallel in one turn instead of one after another.\n</tool_calling>\nEXTRA');
  expect(prompt.text).toMatch(/FIRST\n<subagent_usage>/);
});

test('a transform exists only when a systemMessage option was given', () => {
  expect(transformFrom({ tools: { action: 'remove' } })?.('tools', 'text')).toBe(undefined);
  expect(transformFrom({})?.('tools', 'text')).toBe('text');
  expect(transformFrom(undefined)).toBe(undefined);
});

test('the section table holds the twelve named sections of the report', () => {
  expect(promptSections).toHaveLength(12);
  expect(promptSections.at(-1)).toBe('environment_context');
});
