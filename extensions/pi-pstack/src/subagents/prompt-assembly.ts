import type { AgentDefinition } from './agent-definition.ts';
import { childSubagentUsageBlock } from './delegation-guidance.ts';

export const promptSections = [
  'tools',
  'prohibited_actions',
  'tool_calling',
  'subagent_usage',
  'context_board',
  'session_search',
  'cloud_session_search',
  'consolidation',
  'output_channel',
  'custom_instructions',
  'custom_agent_instructions',
  'environment_context',
] as const;
export type PromptSection = (typeof promptSections)[number];
export type SectionEdit = Readonly<{ action: 'replace' | 'append' | 'prepend' | 'remove'; content?: string }>;
export type SystemMessageOption = Readonly<Partial<Record<PromptSection, SectionEdit>>>;
export type SectionTransform = (name: PromptSection, text: string) => string | undefined;
export type ToolNames = Readonly<{ grep: string; glob: string; shell: string; view: string }>;
export type EnvironmentFacts = Readonly<{ cwd: string; gitRoot?: string; os: string; listing?: string; tools: readonly string[] }>;
export type AssemblyInput = Readonly<{
  definition: AgentDefinition;
  toolNames: ToolNames;
  environment: EnvironmentFacts;
  headless: boolean;
  transform?: SectionTransform;
  customInstructions?: string;
}>;
export type AssembledPrompt = Readonly<{ text: string; mode: 'override' | 'append'; sections: readonly PromptSection[] }>;

const templateKeys = ['grep', 'glob', 'shell', 'view'] as const;

export function substituteTemplates(text: string, names: ToolNames): string {
  return templateKeys.reduce((current, key) => current.replaceAll(`{{${key}ToolName}}`, names[key]), text);
}

export function transformFrom(option: SystemMessageOption | undefined): SectionTransform | undefined {
  if (option === undefined) return undefined;
  return (name, text) => {
    const edit = option[name];
    if (edit === undefined) return text;
    switch (edit.action) {
      case 'remove':
        return undefined;
      case 'replace':
        return edit.content ?? '';
      case 'append':
        return `${text}\n${edit.content ?? ''}`;
      case 'prepend':
        return `${edit.content ?? ''}\n${text}`;
      default: {
        const exhaustive: never = edit.action;
        return exhaustive;
      }
    }
  };
}

const toolsBlock = (names: ToolNames) =>
  `<tools>\n- ${names.grep}: search file contents with regular expressions. Prefer it over shell grep.\n- ${names.view}: read files. Use offsets for large files.\n- ${names.shell}: run commands.\n  <shell_security>Never run commands that exfiltrate data, escalate privileges, or modify files outside the task. Quote every path.</shell_security>\nExamples:\n- To find where a symbol is defined, call ${names.grep} with the symbol, then ${names.view} the match.\n- To check repository state, call ${names.shell} with git status.\n</tools>`;

const prohibitedActions =
  '<prohibited_actions>\nDo not produce harmful, hateful or sexual content. Do not reveal secrets, credentials or private data. Do not delete data or run destructive commands unless the task asks for it. Do not act outside the scope of the task.\n</prohibited_actions>';

const toolCalling = (parallel: boolean) =>
  `<tool_calling>\nCall the tool that fits the step and check its result before you rely on it.${parallel ? '\nCall independent tools in parallel in one turn instead of one after another.' : ''}\n</tool_calling>`;

const environmentBlock = (facts: EnvironmentFacts, listing: string) => {
  const lines = [`Working directory: ${facts.cwd}`, ...(facts.gitRoot ? [`Git repository root: ${facts.gitRoot}`] : []), `Operating System: ${facts.os}`];
  const snapshot = listing !== 'none' && facts.listing ? [`Directory snapshot:\n${facts.listing}`] : [];
  return `<environment_context>\n${[...lines, ...snapshot, `Available tools: ${facts.tools.join(', ')}`].join('\n')}\n</environment_context>`;
};

const boardBlock = '<context_board>\nA shared context board holds durable facts about this project. Read it with the context_board tool before you assume something it may already state.\n</context_board>';
const searchBlock = '<session_search>\nPrevious sessions of this project can be searched for earlier decisions. Search before you ask the user to repeat context.\n</session_search>';
const cloudSearchBlock = '<cloud_session_search>\nSessions from other machines can be searched for earlier decisions. Search before you ask the user to repeat context.\n</cloud_session_search>';
const consolidationBlock = '<consolidation>\nYou are consolidating memory. Keep durable facts, merge duplicates and remove stale entries.\n</consolidation>';
const outputChannelBlock = '<output_channel>\nResults for the parent arrive through its inbox. Send one concise message per finding with send_inbox.\n</output_channel>';
const nonInteractive = '<non_interactive>\nNo user is available to answer questions. Do not ask for clarification: make reasonable assumptions, state them in your final message, and finish the task.\n</non_interactive>';

function sectionTexts(input: AssemblyInput): ReadonlyArray<readonly [PromptSection, string | undefined]> {
  const { definition, toolNames, environment } = input;
  const parts = definition.promptParts;
  const custom = definition.source !== 'built-in' && parts.includeCustomAgentInstructions && definition.prompt ? `<custom_agent_instructions>\n${definition.prompt}\n</custom_agent_instructions>` : undefined;
  return [
    ['custom_agent_instructions', custom],
    ['tools', parts.includeToolInstructions ? toolsBlock(toolNames) : undefined],
    ['prohibited_actions', parts.includeAISafety ? prohibitedActions : undefined],
    ['tool_calling', toolCalling(parts.includeParallelToolCalling)],
    ['subagent_usage', childSubagentUsageBlock()],
    ['context_board', parts.includeDynamicContextBoard ? boardBlock : undefined],
    ['session_search', parts.includeSessionSearchContext ? searchBlock : undefined],
    ['cloud_session_search', parts.includeCloudSessionSearchContext ? cloudSearchBlock : undefined],
    ['consolidation', parts.includeConsolidationPrompt ? consolidationBlock : undefined],
    ['output_channel', parts.includeOutputChannelInstructions ? outputChannelBlock : undefined],
    ['custom_instructions', parts.includeCustomInstructions && input.customInstructions ? `<custom_instructions>\n${input.customInstructions}\n</custom_instructions>` : undefined],
    ['environment_context', parts.includeEnvironmentContext ? environmentBlock(environment, parts.cwdListing) : undefined],
  ];
}

export function assembleSystemPrompt(input: AssemblyInput): AssembledPrompt {
  const { definition, toolNames } = input;
  const kept = sectionTexts(input).flatMap(([name, text]) => {
    const edited = text === undefined || input.transform === undefined ? text : input.transform(name, text);
    return edited === undefined || edited === '' ? [] : [[name, edited] as const];
  });
  const base = definition.source === 'built-in' && definition.prompt ? [substituteTemplates(definition.prompt, toolNames)] : [];
  const preamble = input.headless ? [nonInteractive] : [];
  return { text: [...base, ...preamble, ...kept.map(([, text]) => text)].join('\n\n'), mode: definition.promptOverridable ? 'override' : 'append', sections: kept.map(([name]) => name) };
}
