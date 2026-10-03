import { expect, test } from 'vitest';
import { defaultMaxConcurrency, defaultMaxDepth, parseReferenceSettings } from '../src/subagents/settings.ts';

const defaults = {
  subagents: { agents: {}, disabledSubagents: [], contextManagementTools: false },
  builtInAgents: { rubberDuck: true, rubberDuckAutoInvoke: true },
  workflows: { maxConcurrentRuns: 4, logPhaseNames: false, defaultLimits: {} },
};

test.for([undefined, null, 'text', 7, [], {}])('settings input %j yields the defaults without warnings', (raw) => {
  expect(parseReferenceSettings(raw)).toEqual({ settings: defaults, warnings: [] });
});

test('a full settings document is read field by field', () => {
  const { settings, warnings } = parseReferenceSettings({
    subagents: {
      agents: { explore: { model: 'gpt-6-luna', modelPolicy: 'required', effortLevel: 'medium', contextTier: 'default' }, 'rubber-duck': { autoInvoke: false } },
      disabledSubagents: ['task'],
      maxConcurrency: 6,
      maxDepth: 2,
      contextManagementTools: true,
    },
    builtInAgents: { rubberDuck: false, rubberDuckAutoInvoke: false },
    workflows: { maxConcurrentRuns: 9, logPhaseNames: true, defaultLimits: { maxConcurrentSubagents: 3, maxTotalSubagents: 20, timeoutSeconds: 600, maxAiCredits: 1.5 } },
  });
  expect(warnings).toEqual([]);
  expect(settings).toEqual({
    subagents: {
      agents: { explore: { model: 'gpt-6-luna', modelPolicy: 'required', effortLevel: 'medium', contextTier: 'default' }, 'rubber-duck': { autoInvoke: false } },
      disabledSubagents: ['task'],
      maxConcurrency: 6,
      maxDepth: 2,
      contextManagementTools: true,
    },
    builtInAgents: { rubberDuck: false, rubberDuckAutoInvoke: false },
    workflows: { maxConcurrentRuns: 9, logPhaseNames: true, defaultLimits: { maxConcurrentSubagents: 3, maxTotalSubagents: 20, timeoutSeconds: 600, maxAiCredits: 1.5 } },
  });
});

test('the legacy sub_agents key maps to subagents and the new key wins on conflict', () => {
  const { settings } = parseReferenceSettings({ sub_agents: { maxDepth: 3, maxConcurrency: 5, disabledSubagents: ['research'] }, subagents: { maxDepth: 6 } });
  expect(settings.subagents).toEqual({ agents: {}, disabledSubagents: ['research'], maxConcurrency: 5, maxDepth: 6, contextManagementTools: false });
});

test.for([
  { name: 'zero depth', raw: { subagents: { maxDepth: 0 } }, warning: 'subagents.maxDepth is invalid and was ignored' },
  { name: 'depth over 128', raw: { subagents: { maxDepth: 129 } }, warning: 'subagents.maxDepth is invalid and was ignored' },
  { name: 'fractional concurrency', raw: { subagents: { maxConcurrency: 2.5 } }, warning: 'subagents.maxConcurrency is invalid and was ignored' },
  { name: 'text depth', raw: { subagents: { maxDepth: 'deep' } }, warning: 'subagents.maxDepth is invalid and was ignored' },
  { name: 'unknown policy', raw: { subagents: { agents: { explore: { modelPolicy: 'always' } } } }, warning: 'subagents.agents.explore.modelPolicy is invalid and was ignored' },
  { name: 'unknown tier', raw: { subagents: { agents: { task: { contextTier: 'huge' } } } }, warning: 'subagents.agents.task.contextTier is invalid and was ignored' },
  { name: 'disabled list of numbers', raw: { subagents: { disabledSubagents: [1] } }, warning: 'subagents.disabledSubagents is invalid and was ignored' },
  { name: 'workflow runs over 16', raw: { workflows: { maxConcurrentRuns: 17 } }, warning: 'workflows.maxConcurrentRuns is invalid and was ignored' },
  { name: 'negative credit limit', raw: { workflows: { defaultLimits: { maxAiCredits: -1 } } }, warning: 'workflows.defaultLimits.maxAiCredits is invalid and was ignored' },
])('$name is ignored with a warning', ({ raw, warning }) => {
  const { settings, warnings } = parseReferenceSettings(raw);
  expect(warnings).toEqual([warning]);
  expect(settings.subagents.maxDepth).toBeUndefined();
  expect(settings.subagents.maxConcurrency).toBeUndefined();
  expect(settings.workflows.maxConcurrentRuns).toBe(4);
});

test('a valid sibling survives an invalid field in the same entry', () => {
  const { settings, warnings } = parseReferenceSettings({ subagents: { agents: { explore: { model: 'm', modelPolicy: 'nope' } } } });
  expect(settings.subagents.agents).toEqual({ explore: { model: 'm' } });
  expect(warnings).toEqual(['subagents.agents.explore.modelPolicy is invalid and was ignored']);
});

test('the default depth is four', () => {
  expect(defaultMaxDepth).toBe(4);
});

test.for([
  { cpus: 1, expected: 4 },
  { cpus: 8, expected: 8 },
  { cpus: 12.9, expected: 12 },
  { cpus: 64, expected: 32 },
])('the computed default concurrency for $cpus cpus is $expected', ({ cpus, expected }) => {
  expect(defaultMaxConcurrency(cpus)).toBe(expected);
});
