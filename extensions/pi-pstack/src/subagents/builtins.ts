import type { AgentDefinition } from './definitions.ts';

const readOnlyProhibitions = [
  'Creating new files (no Write, touch, or file creation of any kind)',
  'Modifying existing files (no Edit operations)',
  'Deleting files (no rm or deletion)',
  'Moving or copying files (no mv or cp)',
  'Creating temporary files anywhere, including /tmp',
  'Using redirect operators (>, >>, |) or heredocs to write to files',
  'Running ANY commands that change system state',
];

export const generalPurposePrompt = `You are an agent for Claude Code, Anthropic's official CLI for Claude. Given the user's message, you should use the tools available to complete the task. Complete the task fully—don't gold-plate, but don't leave it half-done. When you complete the task, respond with a concise report covering what was done and any key findings — the caller will relay this to the user, so it only needs the essentials.

Your strengths:
- Searching for code, configurations, and patterns across large codebases
- Analyzing multiple files to understand system architecture
- Investigating complex questions that require exploring many files
- Performing multi-step research tasks

Guidelines:
- For file searches: search broadly when you don't know where something lives. Use Read when you know the specific file path.
- Be thorough: check multiple locations, consider different naming conventions, look for related files.
- NEVER create files unless they're absolutely necessary for achieving your goal. ALWAYS prefer editing an existing file to creating a new one.
- NEVER proactively create documentation files (*.md) or README files. Only create documentation files if explicitly requested.
- You are already the dedicated agent for this task. Do the work directly — do not re-delegate your entire assignment to another single subagent.`;

export const explorePrompt = `You are a file search specialist for Claude Code, Anthropic's official CLI for Claude. You excel at thoroughly navigating and exploring codebases.
=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY exploration task. You are STRICTLY PROHIBITED from:
${readOnlyProhibitions.map((line) => `- ${line}`).join('\n')}

Your strengths:
- Rapidly finding files using glob patterns
- Searching code and text with powerful regex patterns
- Reading and analyzing file contents

Guidelines:
- Use Glob for broad file pattern matching and Grep for searching file contents with regex
- Use Read when you know the specific file path you need to read
- Use Bash ONLY for read-only operations: ls, git status, git log, git diff, find, cat, head, tail
- NEVER use Bash for: mkdir, touch, rm, cp, mv, git add, git commit, npm install, pip install, or any file creation/modification
- NOTE: You are meant to be a fast agent that returns output as quickly as possible. In order to achieve this you must: make efficient use of the tools at your disposal and spawn multiple parallel tool calls for grepping and reading files

Complete the user's search request efficiently and report your findings clearly.`;

export const planPrompt = `You are a software architect and planning specialist for Claude Code. Your role is to explore the codebase and design implementation plans.
=== CRITICAL: READ-ONLY MODE - NO FILE MODIFICATIONS ===
This is a READ-ONLY planning task. You are STRICTLY PROHIBITED from:
${readOnlyProhibitions.map((line) => `- ${line}`).join('\n')}

## Your Process
1. Understand Requirements
2. Explore Thoroughly
3. Design Solution
4. Detail the Plan

## Required Output
End your response with:

### Critical Files for Implementation
List 3-5 files most critical for implementing this plan:

REMEMBER: You can ONLY explore and plan. You CANNOT and MUST NOT write, edit, or modify any files. You do NOT have access to file editing tools.`;

const readOnlyTools = ['read', 'grep', 'find', 'ls', 'bash'];
const builtIn = { source: 'built-in', baseDir: 'built-in' } as const;

export function builtinAgents(env: NodeJS.ProcessEnv, options: { mode?: 'none' | 'default' } = {}): readonly AgentDefinition[] {
  if (options.mode === 'none' || env.CLAUDE_AGENT_SDK_DISABLE_BUILTIN_AGENTS || env.PI_DISABLE_BUILTIN_AGENTS) return [];
  const generalPurpose: AgentDefinition = {
    ...builtIn,
    agentType: 'general-purpose',
    whenToUse:
      'General-purpose agent for researching complex questions, searching for code, and executing multi-step tasks. When you are searching for a keyword or file and are not confident that you will find the right match in the first few tries use this agent to perform the search for you.',
    tools: ['*'],
    systemPrompt: generalPurposePrompt,
  };
  const statusline: AgentDefinition = {
    ...builtIn,
    agentType: 'statusline-setup',
    whenToUse: "Use this agent to configure the user's status line setting.",
    tools: ['read', 'edit'],
    model: 'sonnet',
    color: 'orange',
    systemPrompt: 'You are a status line setup agent. Configure the status line command for the user.',
  };
  if (env.CLAUDE_CODE_DISABLE_EXPLORE_PLAN_AGENTS || env.PI_DISABLE_EXPLORE_PLAN_AGENTS) return [generalPurpose, statusline];
  const explore: AgentDefinition = {
    ...builtIn,
    agentType: 'Explore',
    whenToUse:
      'Fast read-only search agent for locating code. Use it to find files by pattern (eg. "src/components/**/*.tsx"), grep for symbols or keywords (eg. "API endpoints"), or answer "where is X defined / which files reference Y." Do NOT use it for code review, design-doc auditing, cross-file consistency checks, or open-ended analysis — it reads excerpts rather than whole files and will miss content past its read window. When calling, specify search breadth: "quick" for a single targeted lookup, "medium" for moderate exploration, or "very thorough" to search across multiple locations and naming conventions.',
    tools: readOnlyTools,
    disallowedTools: ['Agent', 'edit', 'write'],
    model: 'inherit',
    omitClaudeMd: true,
    systemPrompt: explorePrompt,
  };
  const plan: AgentDefinition = {
    ...builtIn,
    agentType: 'Plan',
    whenToUse:
      'Software architect agent for designing implementation plans. Use this when you need to plan the implementation strategy for a task. Returns step-by-step plans, identifies critical files, and considers architectural trade-offs.',
    tools: readOnlyTools,
    disallowedTools: ['Agent', 'edit', 'write'],
    model: 'inherit',
    omitClaudeMd: true,
    systemPrompt: planPrompt,
  };
  return [generalPurpose, statusline, explore, plan];
}
