import { randomUUID } from 'node:crypto';

import { type Api, getCurrentSystemPrompt, getCurrentTools, type Model, type SimpleStreamOptions, type ToolCall, type TranscriptContext, toToolDeclaration } from '@earendil-works/pi-ai';

interface WirePart {
  text?: string;
  thought?: boolean;
  thoughtSignature?: string;
  inlineData?: { mimeType: string; data: string };
  functionCall?: { id?: string; name: string; args: object };
  functionResponse?: { id?: string; name: string; response: { output: string } | { error: string }; parts?: WirePart[] };
}

interface WireContent {
  role: 'user' | 'model';
  parts: WirePart[];
}

type Effort = 'low' | 'medium' | 'high';

export interface CodeAssistRequestBody {
  model: string;
  project: string;
  requestId: string;
  userAgent: 'antigravity';
  requestType: 'agent';
  request: {
    contents: WireContent[];
    systemInstruction?: { role: 'user'; parts: WirePart[] };
    tools?: { functionDeclarations: { name: string; description: string; parametersJsonSchema: unknown }[] }[];
    toolConfig?: { functionCallingConfig: { mode: 'NONE' } };
    generationConfig: { temperature?: number; maxOutputTokens?: number; thinkingConfig: { includeThoughts: true; thinkingLevel: string } };
    sessionId?: string;
  };
}

const DEFAULT_EFFORT: Effort = 'medium';
// Antigravity bakes the effort into the model id (gemini-3.8-flash-medium). Only low, medium, and high are known to be accepted.
const EFFORT_BY_LEVEL: Record<NonNullable<SimpleStreamOptions['reasoning']>, Effort> = { minimal: 'low', low: 'low', medium: 'medium', high: 'high', xhigh: 'high', max: 'high' };
const THOUGHT_SIGNATURE = /^[A-Za-z0-9+/]+={0,2}$/;
const JSON_SCHEMA_NAME_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies']);
const JSON_SCHEMA_SUBSCHEMAS = new Set([
  'additionalProperties',
  'unevaluatedProperties',
  'propertyNames',
  'items',
  'prefixItems',
  'additionalItems',
  'unevaluatedItems',
  'contains',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'contentSchema',
]);

export function buildCodeAssistRequest(input: { model: Model<Api>; context: TranscriptContext; project: string; options: SimpleStreamOptions }): CodeAssistRequestBody {
  const { model, context, project, options } = input;
  const systemPrompt = getCurrentSystemPrompt(context.messages);
  const tools = getCurrentTools(context.messages);
  const effort = options.reasoning ? EFFORT_BY_LEVEL[options.reasoning] : DEFAULT_EFFORT;

  return {
    model: `${model.id}-${effort}`,
    project,
    requestId: randomUUID(),
    userAgent: 'antigravity',
    requestType: 'agent',
    request: {
      contents: convertMessages(model, context),
      ...(systemPrompt ? { systemInstruction: { role: 'user' as const, parts: [{ text: scrub(systemPrompt) }] } } : {}),
      ...(tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: tools.map((tool) => {
                  const declaration = toToolDeclaration(tool);
                  return { name: declaration.name, description: declaration.description, parametersJsonSchema: constToEnum(declaration.parameters) };
                }),
              },
            ],
          }
        : {}),
      ...(tools.length > 0 && options.toolChoice === 'none' ? { toolConfig: { functionCallingConfig: { mode: 'NONE' as const } } } : {}),
      generationConfig: {
        ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
        ...(options.maxTokens === undefined ? {} : { maxOutputTokens: options.maxTokens }),
        thinkingConfig: { includeThoughts: true, thinkingLevel: effort.toUpperCase() },
      },
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    },
  };
}

function scrub(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

function geminiMajorVersion(modelId: string): number | undefined {
  const match = /^gemini-(\d+)/.exec(modelId.toLowerCase());
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], 10);
}

function convertMessages(model: Model<Api>, context: TranscriptContext): WireContent[] {
  const major = geminiMajorVersion(model.id);
  const needsCallIds = major !== undefined && major >= 3;
  // Code Assist matches a functionResponse to its functionCall by this id on Gemini 3+, so both sides must sanitize identically.
  const wireId = (id: string): { id?: string } => (needsCallIds ? { id: id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64) } : {});
  const contents: WireContent[] = [];
  let pending: ToolCall[] = [];
  const answered = new Set<string>();
  // Code Assist wants every functionResponse of a round in one user turn, so Gemini 2.x image turns wait until the round ends.
  const imageTurns: WireContent[] = [];

  const pushToolResponse = (part: NonNullable<WirePart['functionResponse']>, trailingImages: WirePart[] = []): void => {
    const last = contents.at(-1);
    if (last?.role === 'user' && last.parts.some((candidate) => candidate.functionResponse)) last.parts.push({ functionResponse: part });
    else contents.push({ role: 'user', parts: [{ functionResponse: part }] });
    if (trailingImages.length > 0) imageTurns.push({ role: 'user', parts: [{ text: 'Tool result image:' }, ...trailingImages] });
  };
  // A functionCall without a functionResponse makes Code Assist reject the whole request.
  const answerOrphans = (): void => {
    for (const call of pending) {
      if (!answered.has(call.id)) pushToolResponse({ ...wireId(call.id), name: call.name, response: { error: 'No result provided' } });
    }
    pending = [];
    answered.clear();
    contents.push(...imageTurns.splice(0));
  };

  for (const message of context.messages) {
    if (message.role === 'user') {
      answerOrphans();
      const parts: WirePart[] =
        typeof message.content === 'string' ? [{ text: scrub(message.content) }] : message.content.map((block) => (block.type === 'text' ? { text: scrub(block.text) } : { inlineData: { mimeType: block.mimeType, data: block.data } }));
      if (parts.length > 0) contents.push({ role: 'user', parts });
    } else if (message.role === 'assistant') {
      answerOrphans();
      if (message.stopReason === 'error' || message.stopReason === 'aborted') continue;
      const sameModel = message.provider === model.provider && message.api === model.api && message.model === model.id;
      const signed = (signature: string | undefined): { thoughtSignature?: string } => (sameModel && signature && signature.length % 4 === 0 && THOUGHT_SIGNATURE.test(signature) ? { thoughtSignature: signature } : {});
      const parts: WirePart[] = [];
      for (const block of message.content) {
        if (block.type === 'text') {
          const signature = signed(block.textSignature);
          if (block.text.trim() || signature.thoughtSignature) parts.push({ text: scrub(block.text), ...signature });
        } else if (block.type === 'thinking') {
          if (!sameModel) continue;
          const signature = signed(block.thinkingSignature);
          if (block.thinking.trim() || signature.thoughtSignature) parts.push({ thought: true, text: scrub(block.thinking), ...signature });
        } else {
          parts.push({ functionCall: { ...wireId(block.id), name: block.name, args: block.arguments }, ...signed(block.thoughtSignature) });
        }
      }
      pending = message.content.filter((block): block is ToolCall => block.type === 'toolCall');
      if (parts.length > 0) contents.push({ role: 'model', parts });
    } else if (message.role === 'toolResult') {
      answered.add(message.toolCallId);
      const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
      const images: WirePart[] = message.content.flatMap((block) => (block.type === 'image' && model.input.includes('image') ? [{ inlineData: { mimeType: block.mimeType, data: block.data } }] : []));
      const value = text.trim() ? scrub(text) : images.length > 0 ? '(see attached image)' : '';
      const nested = major === undefined || major >= 3;
      pushToolResponse({ ...wireId(message.toolCallId), name: message.toolName, response: message.isError ? { error: value } : { output: value }, ...(images.length > 0 && nested ? { parts: images } : {}) }, nested ? [] : images);
    }
  }
  answerOrphans();
  return contents;
}

/** Gemini ignores `const` inside parametersJsonSchema but honors a single-value `enum`. */
function constToEnum(schema: unknown, isNameMap = false): unknown {
  if (Array.isArray(schema)) return schema.map((item) => constToEnum(item));
  if (typeof schema !== 'object' || schema === null) return schema;
  const rewritten: Record<string, unknown> = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => {
      if (isNameMap || JSON_SCHEMA_SUBSCHEMAS.has(key)) return [key, constToEnum(value)];
      if (JSON_SCHEMA_NAME_MAPS.has(key)) return [key, constToEnum(value, true)];
      return [key, value];
    }),
  );
  const constant = rewritten['const'];
  if (!isNameMap && rewritten['enum'] === undefined && (typeof constant === 'string' || typeof constant === 'number')) {
    const { const: _, ...rest } = rewritten;
    return { ...rest, enum: [constant] };
  }
  return rewritten;
}
