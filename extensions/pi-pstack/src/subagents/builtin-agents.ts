import { type AgentDefinition, allTools, builtInPromptParts, namedTools } from './agent-definition.ts';
import { codeReviewPrompt, explorePrompt, remAgentPrompt, researchPrompt, rubberDuckPrompt, securityReviewPrompt, taskPrompt } from './builtin-prompts.ts';

export const generalPurposeName = 'general-purpose';

const builtIn = { source: 'built-in', userInvocable: true, disableModelInvocation: false, promptOverridable: true, disableable: false, tools: allTools, promptParts: builtInPromptParts } as const;

const exploreTools = ['grep', 'glob', 'view', 'bash', 'read_bash', 'stop_bash', 'powershell', 'read_powershell', 'stop_powershell', 'lsp', 'github-mcp-server/*', 'bluebird/*'];

export const builtInAgents: readonly AgentDefinition[] = [
  {
    ...builtIn,
    name: generalPurposeName,
    displayName: 'General Purpose',
    description: 'General-purpose agent for complex, multi-step tasks that need the full toolset, such as researching a question across many files or making a set of related changes.',
    prompt: '',
    promptOverridable: false,
  },
  {
    ...builtIn,
    name: 'explore',
    displayName: 'Explore',
    description: 'Fast read-only agent for exploring the codebase and answering questions about it. Safe to run in parallel. It reports findings and never modifies files.',
    model: ['gpt-5.6-luna', 'gpt-5.4-mini'],
    reasoningEffort: 'low',
    tools: namedTools(exploreTools),
    prompt: explorePrompt,
    disableable: true,
  },
  {
    ...builtIn,
    name: 'task',
    displayName: 'Task',
    description: 'Executes commands such as builds, tests and linters and reports a brief result on success and the full output on failure.',
    model: ['gpt-5.6-luna', 'gpt-5.4-mini', 'claude-haiku-4.5'],
    prompt: taskPrompt,
    disableable: true,
  },
  { ...builtIn, name: 'code-review', displayName: 'Code Review', description: 'Reviews code changes and reports only genuine problems such as bugs, security issues and logic errors. It never modifies files.', prompt: codeReviewPrompt },
  { ...builtIn, name: 'security-review', displayName: 'Security Review', description: 'Reviews code changes for security vulnerabilities and reports confirmed findings with a severity and a fix.', prompt: securityReviewPrompt },
  { ...builtIn, name: 'research', displayName: 'Research', description: 'Researches a question across the codebase, documentation and the web and reports a cited answer.', model: 'claude-sonnet-5', prompt: researchPrompt },
  {
    ...builtIn,
    name: 'rubber-duck',
    displayName: 'Rubber Duck',
    description: 'Critiques a plan or implementation from a complementary model perspective. Call it synchronously after planning and before implementing.',
    prompt: rubberDuckPrompt,
    dynamicModel: 'complementary',
    gate: 'rubberDuck',
  },
  {
    ...builtIn,
    name: 'rem-agent',
    displayName: 'Rem Agent',
    description: 'Consolidates the shared context board between sessions. Do not invoke spontaneously.',
    tools: namedTools(['context_board']),
    promptParts: { ...builtInPromptParts, includeEnvironmentContext: false, includeParallelToolCalling: false, includeConsolidationPrompt: true },
    prompt: remAgentPrompt,
    gate: 'subconscious',
  },
];
