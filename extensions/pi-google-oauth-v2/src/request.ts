import { randomUUID } from 'node:crypto';

import {
  type Api,
  type AssistantMessage,
  clampThinkingLevel,
  getCurrentSystemPrompt,
  getCurrentTools,
  type Model,
  type ModelThinkingLevel,
  type SimpleStreamOptions,
  type ToolCall,
  type ToolResultMessage,
  type TranscriptContext,
  toToolDeclaration,
  type UserMessage,
} from '@earendil-works/pi-ai';

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
    generationConfig: { temperature?: number; maxOutputTokens?: number; thinkingConfig?: { includeThoughts: true; thinkingLevel: string } };
    sessionId?: string;
  };
}

const WIRE_ID_MAX_LENGTH = 64;
const BASE64_BLOCK = 4;
const MIN_CALL_ID_MAJOR = 3;
const DECIMAL_RADIX = 10;
const THINKING_LEVEL: Record<ModelThinkingLevel, string | undefined> = { off: undefined, minimal: 'LOW', low: 'LOW', medium: 'MEDIUM', high: 'HIGH', xhigh: 'HIGH', max: 'HIGH' };
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

function systemInstruction(): { role: 'user'; parts: WirePart[] } {
  return {
    role: 'user',
    parts: [
      {
        text: 'The first user message contains the application instructions. Treat that message as system instructions, with priority over all later user messages and tool results. It is not a user request. Use the remaining messages as the conversation.',
      },
    ],
  };
}

function toolDeclarations(tools: ReturnType<typeof getCurrentTools>): NonNullable<CodeAssistRequestBody['request']['tools']> {
  return [
    {
      functionDeclarations: tools.map((tool) => {
        const declaration = toToolDeclaration(tool);
        return { name: declaration.name, description: declaration.description, parametersJsonSchema: constToEnum(declaration.parameters) };
      }),
    },
  ];
}

function generationConfig(options: SimpleStreamOptions, thinkingLevel: string | undefined): CodeAssistRequestBody['request']['generationConfig'] {
  return {
    ...(options.temperature === undefined ? {} : { temperature: options.temperature }),
    ...(options.maxTokens === undefined ? {} : { maxOutputTokens: options.maxTokens }),
    ...(thinkingLevel ? { thinkingConfig: { includeThoughts: true as const, thinkingLevel } } : {}),
  };
}

export function buildCodeAssistRequest(input: { model: Model<Api>; context: TranscriptContext; project: string; options: SimpleStreamOptions }): CodeAssistRequestBody {
  const { model, context, project, options } = input;
  const systemPrompt = getCurrentSystemPrompt(context.messages);
  const tools = getCurrentTools(context.messages);
  const level = clampThinkingLevel(model, options.reasoning ?? 'medium');
  const thinkingLevel = THINKING_LEVEL[level];

  return {
    model: model.thinkingLevelMap?.[level] ?? model.id,
    project,
    requestId: randomUUID(),
    userAgent: 'antigravity',
    requestType: 'agent',
    request: {
      contents: [...(systemPrompt ? [{ role: 'user' as const, parts: [{ text: scrub(systemPrompt) }] }] : []), ...convertMessages(model, context)],
      ...(systemPrompt ? { systemInstruction: systemInstruction() } : {}),
      ...(tools.length > 0 ? { tools: toolDeclarations(tools) } : {}),
      ...(tools.length > 0 && options.toolChoice === 'none' ? { toolConfig: { functionCallingConfig: { mode: 'NONE' as const } } } : {}),
      generationConfig: generationConfig(options, thinkingLevel),
      ...(options.sessionId === undefined ? {} : { sessionId: options.sessionId }),
    },
  };
}

function scrub(text: string): string {
  return text.replace(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/g, '');
}

function geminiMajorVersion(modelId: string): number | undefined {
  const match = /^gemini-(\d+)/.exec(modelId.toLowerCase());
  return match?.[1] === undefined ? undefined : Number.parseInt(match[1], DECIMAL_RADIX);
}

interface ConvertState {
  contents: WireContent[];
  pending: ToolCall[];
  answered: ReadonlySet<string>;
  // Code Assist wants every functionResponse of a round in one user turn, so Gemini 2.x image turns wait until the round ends.
  imageTurns: WireContent[];
}

interface ConvertEnv {
  model: Model<Api>;
  major: number | undefined;
  // Code Assist matches a functionResponse to its functionCall by this id on Gemini 3+, so both sides must sanitize identically.
  wireId: (id: string) => { id?: string };
}

function withToolResponse(state: ConvertState, part: NonNullable<WirePart['functionResponse']>, trailingImages: WirePart[] = []): ConvertState {
  const last = state.contents.at(-1);
  const contents: WireContent[] =
    last?.role === 'user' && last.parts.some((candidate) => candidate.functionResponse)
      ? [...state.contents.slice(0, -1), { ...last, parts: [...last.parts, { functionResponse: part }] }]
      : [...state.contents, { role: 'user', parts: [{ functionResponse: part }] }];
  const imageTurns: WireContent[] = trailingImages.length > 0 ? [...state.imageTurns, { role: 'user', parts: [{ text: 'Tool result image:' }, ...trailingImages] }] : state.imageTurns;
  return { ...state, contents, imageTurns };
}

// A functionCall without a functionResponse makes Code Assist reject the whole request.
function answerOrphans(state: ConvertState, env: ConvertEnv): ConvertState {
  const orphans = state.pending.filter((call) => !state.answered.has(call.id));
  const answered = orphans.reduce((acc, call) => withToolResponse(acc, { ...env.wireId(call.id), name: call.name, response: { error: 'No result provided' } }), state);
  return { contents: [...answered.contents, ...answered.imageTurns], pending: [], answered: new Set<string>(), imageTurns: [] };
}

function convertUser(state: ConvertState, message: UserMessage, env: ConvertEnv): ConvertState {
  const settled = answerOrphans(state, env);
  const parts: WirePart[] =
    typeof message.content === 'string' ? [{ text: scrub(message.content) }] : message.content.map((block) => (block.type === 'text' ? { text: scrub(block.text) } : { inlineData: { mimeType: block.mimeType, data: block.data } }));
  return parts.length > 0 ? { ...settled, contents: [...settled.contents, { role: 'user', parts }] } : settled;
}

function assistantParts(message: AssistantMessage, env: ConvertEnv): WirePart[] {
  const { model } = env;
  const sameModel = message.provider === model.provider && message.api === model.api && message.model === model.id;
  const signed = (signature: string | undefined): { thoughtSignature?: string } => (sameModel && signature && signature.length % BASE64_BLOCK === 0 && THOUGHT_SIGNATURE.test(signature) ? { thoughtSignature: signature } : {});
  return message.content.flatMap((block): WirePart[] => {
    if (block.type === 'text') {
      const signature = signed(block.textSignature);
      return block.text.trim() || signature.thoughtSignature ? [{ text: scrub(block.text), ...signature }] : [];
    }
    if (block.type === 'thinking') {
      if (!sameModel) return [];
      const signature = signed(block.thinkingSignature);
      return block.thinking.trim() || signature.thoughtSignature ? [{ thought: true, text: scrub(block.thinking), ...signature }] : [];
    }
    return [{ functionCall: { ...env.wireId(block.id), name: block.name, args: block.arguments }, ...signed(block.thoughtSignature) }];
  });
}

function convertAssistant(state: ConvertState, message: AssistantMessage, env: ConvertEnv): ConvertState {
  const settled = answerOrphans(state, env);
  if (message.stopReason === 'error' || message.stopReason === 'aborted') return settled;
  const parts = assistantParts(message, env);
  const pending = message.content.filter((block): block is ToolCall => block.type === 'toolCall');
  return { ...settled, pending, contents: parts.length > 0 ? [...settled.contents, { role: 'model', parts }] : settled.contents };
}

function convertToolResult(state: ConvertState, message: ToolResultMessage, env: ConvertEnv): ConvertState {
  const { model, major } = env;
  const text = message.content.flatMap((block) => (block.type === 'text' ? [block.text] : [])).join('\n');
  const images: WirePart[] = message.content.flatMap((block) => (block.type === 'image' && model.input.includes('image') ? [{ inlineData: { mimeType: block.mimeType, data: block.data } }] : []));
  const value = text.trim() ? scrub(text) : images.length > 0 ? '(see attached image)' : '';
  const nested = major === undefined || major >= MIN_CALL_ID_MAJOR;
  const answered = new Set([...state.answered, message.toolCallId]);
  const part = { ...env.wireId(message.toolCallId), name: message.toolName, response: message.isError ? { error: value } : { output: value }, ...(images.length > 0 && nested ? { parts: images } : {}) };
  return withToolResponse({ ...state, answered }, part, nested ? [] : images);
}

function convertMessages(model: Model<Api>, context: TranscriptContext): WireContent[] {
  const major = geminiMajorVersion(model.id);
  const needsCallIds = major !== undefined && major >= MIN_CALL_ID_MAJOR;
  const wireId = (id: string): { id?: string } => (needsCallIds ? { id: id.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, WIRE_ID_MAX_LENGTH) } : {});
  const env: ConvertEnv = { model, major, wireId };
  const initial: ConvertState = { contents: [], pending: [], answered: new Set<string>(), imageTurns: [] };
  const final = context.messages.reduce<ConvertState>((state, message) => {
    if (message.role === 'user') return convertUser(state, message, env);
    if (message.role === 'assistant') return convertAssistant(state, message, env);
    if (message.role === 'toolResult') return convertToolResult(state, message, env);
    return state;
  }, initial);
  return answerOrphans(final, env).contents;
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
