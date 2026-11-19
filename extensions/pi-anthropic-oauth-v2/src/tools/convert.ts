import type Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { toClaudeCodeName } from './names.ts';

const parametersSchema = z.object({
  properties: z.record(z.string(), z.unknown()).nullish(),
  required: z.array(z.string()).nullish(),
});

function parseParameters(tool: Tool): z.infer<typeof parametersSchema> {
  try {
    const parameters = parametersSchema.parse(tool.parameters);
    return parameters;
  } catch (error) {
    console.error(`Tool ${tool.name} has invalid parameters:`, error);
    throw new Error(`Tool "${tool.name}" has an invalid parameter schema.`, { cause: error });
  }
}

function convertTool(tool: Tool, isOAuth: boolean): Anthropic.Beta.BetaTool {
  const { properties, required } = parseParameters(tool);
  return {
    name: isOAuth ? toClaudeCodeName(tool.name) : tool.name,
    description: tool.description,
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: properties || {}, required: required || [] },
  };
}

export const convertTools = (tools: readonly Tool[], isOAuth: boolean): Anthropic.Beta.BetaTool[] => tools.map((tool) => convertTool(tool, isOAuth));
