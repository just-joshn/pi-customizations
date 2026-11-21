import type Anthropic from '@anthropic-ai/sdk';
import type { Tool } from '@earendil-works/pi-ai';
import { z } from 'zod';
import { parseOrThrow } from '../validation.ts';
import type { NameCodec } from './names.ts';

const parametersSchema = z.object({
  properties: z.record(z.string(), z.unknown()).nullish(),
  required: z.array(z.string()).nullish(),
});

function convertTool(tool: Tool, names: NameCodec): Anthropic.Beta.BetaTool {
  const { properties, required } = parseOrThrow(parametersSchema, tool.parameters, `Tool "${tool.name}" has an invalid parameter schema.`);
  return {
    name: names.toWire(tool.name),
    description: tool.description,
    eager_input_streaming: true,
    input_schema: { type: 'object', properties: properties || {}, required: required || [] },
  };
}

export const convertTools = (tools: readonly Tool[], names: NameCodec): Anthropic.Beta.BetaTool[] => tools.map((tool) => convertTool(tool, names));
