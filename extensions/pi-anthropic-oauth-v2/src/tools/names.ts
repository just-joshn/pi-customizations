import type { Tool } from '@earendil-works/pi-ai';
import { REQUEST_CONFIG } from '../request/config.ts';

const claudeCodeNames: ReadonlyMap<string, string> = new Map(REQUEST_CONFIG.claudeCodeTools.map((name) => [name.toLowerCase(), name]));

export const toClaudeCodeName = (name: string): string => claudeCodeNames.get(name.toLowerCase()) ?? name;

export function fromClaudeCodeName(name: string, tools: readonly Tool[]): string {
  const lowerName = name.toLowerCase();
  return tools.find((tool) => tool.name.toLowerCase() === lowerName)?.name ?? name;
}
