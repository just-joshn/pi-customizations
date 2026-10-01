export const agentColors = ['red', 'blue', 'green', 'yellow', 'purple', 'orange', 'pink', 'cyan'] as const;
export type AgentColor = (typeof agentColors)[number];

export function parseAgentColor(value: unknown): AgentColor | undefined {
  return agentColors.find((color) => color === value);
}
