import { expect, test } from 'vitest';
import { builtinAgents } from '../src/subagents/builtins.ts';

const names = (env: NodeJS.ProcessEnv) => builtinAgents(env).map((agent) => agent.agentType);

test.for([
  { env: {}, expected: ['general-purpose', 'statusline-setup', 'Explore', 'Plan', 'claude-code-guide'] },
  { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-ts' }, expected: ['general-purpose', 'statusline-setup', 'Explore', 'Plan'] },
  { env: { CLAUDE_CODE_ENTRYPOINT: 'sdk-cli' }, expected: ['general-purpose', 'statusline-setup', 'Explore', 'Plan'] },
  { env: { CLAUDE_CODE_WEB_FETCH_AGENT: '1' }, expected: ['general-purpose', 'statusline-setup', 'Explore', 'Plan', 'web-fetch', 'claude-code-guide'] },
  { env: { CLAUDE_CODE_WEB_FETCH_AGENT: '1', CLAUDE_CODE_DISABLE_WEB_FETCH: '1' }, expected: ['general-purpose', 'statusline-setup', 'Explore', 'Plan', 'claude-code-guide'] },
  { env: { CLAUDE_CODE_WEB_FETCH_AGENT: '1', CLAUDE_CODE_SIMPLE: '1' }, expected: ['general-purpose', 'statusline-setup', 'Explore', 'Plan', 'claude-code-guide'] },
  { env: { CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS: '1' }, expected: ['general-purpose', 'statusline-setup', 'claude-code-guide'] },
])('the built-in set follows the recovered gates: $env', ({ env, expected }) => {
  expect(names(env)).toEqual(expected);
});

test('web-fetch carries the recovered metadata', () => {
  const webFetch = builtinAgents({ CLAUDE_CODE_WEB_FETCH_AGENT: '1' }).find((agent) => agent.agentType === 'web-fetch');
  expect(webFetch).toMatchObject({ tools: ['WebFetch'], model: 'inherit', color: 'blue', maxTurns: 15, omitClaudeMd: true, source: 'built-in', baseDir: 'built-in' });
  expect(webFetch?.whenToUse.startsWith('Use this to fetch and read web pages / URLs when you do not have a direct WebFetch tool of your own (if you do, just call it).')).toBe(true);
});

test('claude-code-guide carries the recovered metadata and points at the local Pi documentation', () => {
  const guide = builtinAgents({}).find((agent) => agent.agentType === 'claude-code-guide');
  expect(guide).toMatchObject({ tools: ['find', 'grep', 'read', 'WebFetch', 'WebSearch'], model: 'haiku', permissionMode: 'dontAsk' });
  expect(guide?.whenToUse.endsWith('check if there is already a running or recently completed claude-code-guide agent that you can continue via SendMessage.')).toBe(true);
  expect(guide?.systemPrompt).toContain('docs');
});
