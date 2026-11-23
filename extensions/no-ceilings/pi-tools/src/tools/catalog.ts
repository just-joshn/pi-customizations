import { Type } from 'typebox';
import { prepareWith } from '../core/repair.ts';
import { guarded } from '../core/tool.ts';
import type { ToolFailure, ToolOutcome } from '../types.ts';

export interface CatalogEntry {
  readonly name: string;
  readonly description: string;
  readonly parameters: unknown;
}

export interface SearchToolsOptions {
  /** Every tool the layer owns. */
  readonly entries: () => readonly CatalogEntry[];
  readonly active: () => readonly string[];
  readonly activate: (names: readonly string[]) => void;
}

export const searchToolsParameters = Type.Object({
  query: Type.String({ description: 'Capability or task to search for, for example "patch a file" or "run git"' }),
  limit: Type.Optional(Type.Number({ description: 'Maximum number of tools to load (default: 5)' })),
});

interface SearchToolsParams {
  query: string;
  limit?: number;
}

export interface SearchToolsMatch {
  readonly name: string;
  readonly description: string;
}

export interface SearchToolsDetails {
  readonly matches?: readonly SearchToolsMatch[];
  readonly activated?: readonly string[];
  readonly failure?: ToolFailure;
}

const DEFAULT_LIMIT = 5;

function tokenize(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length > 1);
}

function score(entry: CatalogEntry, tokens: readonly string[]): number {
  const name = entry.name.toLowerCase();
  const description = entry.description.toLowerCase();
  let total = 0;
  for (const token of tokens) {
    if (name.includes(token)) {
      total += 3;
    }
    if (description.includes(token)) {
      total += 2;
    }
  }
  return total;
}

/** Load tools the model could not otherwise reach, and return their schemas. */
export function createSearchToolsTool(options: SearchToolsOptions) {
  return {
    name: 'search_tools',
    label: 'Search tools',
    description: 'Find tool schemas the layer has not declared yet and activate them for this session. Returns the name, description, and argument schema of each match, so a call can be made correctly after one lookup.',
    promptSnippet: 'Find and load additional tools (patch, git, web, resource saving) and read their argument schemas',
    promptGuidelines: ['Use search_tools when a task needs a capability the active tools do not cover, then call the returned tool with the schema it printed.'],
    prepareArguments: prepareWith({ aliases: { q: 'query' }, numbers: ['limit'], strings: ['query'] }),
    parameters: searchToolsParameters,
    executionMode: 'sequential' as const,
    execute: guarded<SearchToolsParams, SearchToolsDetails>(
      (failure) => ({ failure }),
      async ({ params }): Promise<ToolOutcome<SearchToolsDetails>> => {
        const tokens = tokenize(params.query);
        if (tokens.length === 0) {
          return { content: [{ type: 'text', text: 'Provide a query with at least one word.' }], details: { matches: [], activated: [] } };
        }
        const limit = Math.max(1, Math.min(20, Math.floor(params.limit ?? DEFAULT_LIMIT)));
        const active = new Set(options.active());
        const scored = options
          .entries()
          .map((entry) => ({ entry, score: score(entry, tokens) }))
          .filter((candidate) => candidate.score > 0)
          .sort((left, right) => right.score - left.score || left.entry.name.localeCompare(right.entry.name));

        if (scored.length === 0) {
          const names = options
            .entries()
            .map((entry) => entry.name)
            .join(', ');
          return { content: [{ type: 'text', text: `No tool matches "${params.query}". Available: ${names}` }], details: { matches: [], activated: [] } };
        }
        const selected = scored.slice(0, limit).map((candidate) => candidate.entry);
        const toActivate = selected.filter((entry) => !active.has(entry.name)).map((entry) => entry.name);
        if (toActivate.length > 0) {
          options.activate(toActivate);
        }
        const body = selected.map((entry) => `## ${entry.name}\n${entry.description}\n\n${JSON.stringify(entry.parameters)}`).join('\n\n');
        const header = toActivate.length === 0 ? `Matching tools are already active: ${selected.map((entry) => entry.name).join(', ')}` : `Loaded tools: ${toActivate.join(', ')}`;
        return {
          content: [{ type: 'text', text: `${header}\n\n${body}` }],
          details: { matches: selected.map((entry) => ({ name: entry.name, description: entry.description })), activated: toActivate },
          structuredContent: { matches: selected.map((entry) => entry.name), activated: toActivate },
        };
      },
      () => undefined,
    ),
  };
}
