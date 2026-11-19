import type { Tool as AnthropicTool } from '@anthropic-ai/sdk/resources/messages.js';
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

function convertTool(tool: Tool, isOAuth: boolean): AnthropicTool {
  const { properties, required } = parseParameters(tool);
  return {
    name: isOAuth ? toClaudeCodeName(tool.name) : tool.name,
    description: tool.description,
    input_schema: { type: 'object', properties: properties || {}, required: required || [] },
  };
}

export const convertTools = (tools: readonly Tool[], isOAuth: boolean): AnthropicTool[] => tools.map((tool) => convertTool(tool, isOAuth));
