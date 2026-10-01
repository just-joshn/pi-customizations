import { type Static, Type } from 'typebox';
import { Check, Errors } from 'typebox/value';
import { type AgentDefinition, permissionModes } from './definitions.ts';
import { parseMcpServers } from './mcp-specs.ts';

const strings = Type.Array(Type.String());
const definitionSchema = Type.Object({
  description: Type.String({ minLength: 1 }),
  prompt: Type.String(),
  tools: Type.Optional(strings),
  disallowedTools: Type.Optional(strings),
  skills: Type.Optional(strings),
  model: Type.Optional(Type.String()),
  effort: Type.Optional(Type.Union([Type.Literal('low'), Type.Literal('medium'), Type.Literal('high'), Type.Literal('xhigh'), Type.Literal('max'), Type.Integer()])),
  maxTurns: Type.Optional(Type.Integer({ minimum: 1 })),
  background: Type.Optional(Type.Boolean()),
  omitContextFiles: Type.Optional(Type.Boolean()),
  initialPrompt: Type.Optional(Type.String()),
  criticalSystemReminder_EXPERIMENTAL: Type.Optional(Type.String()),
  memory: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('project'), Type.Literal('local')])),
  isolation: Type.Optional(Type.Union([Type.Literal('worktree'), Type.Literal('remote')])),
  permissionMode: Type.Optional(Type.Union(permissionModes.map((mode) => Type.Literal(mode)))),
  mcpServers: Type.Optional(Type.Array(Type.Union([Type.String(), Type.Record(Type.String(), Type.Unknown())]))),
  requiredMcpServers: Type.Optional(strings),
});

export function parseJsonAgentSpec(name: string, input: unknown, baseDir: string, warn?: (message: string) => void): AgentDefinition {
  if (!Check(definitionSchema, input)) {
    const issues = [...Errors(definitionSchema, input)].map((issue) => `${issue.instancePath}: ${issue.message}`).join('; ');
    throw new Error(`${name}: ${issues}${typeof input === 'object' && input !== null && 'description' in input && input.description === '' ? '; Description cannot be empty' : ''}`);
  }
  const unsupportedFields = ['hooks', 'observer', 'observerMessage', 'observeSubagents', 'cacheTtl'].filter((key) => Object.hasOwn(input, key));
  if (unsupportedFields.length > 0) throw new Error(`${name}: Unsupported native JSON agent fields: ${unsupportedFields.join(', ')}`);
  const data: Static<typeof definitionSchema> = input;
  const model = data.model?.trim();
  if (model === '') throw new Error(`${name}: model: Model cannot be empty`);
  const { description, prompt, background } = data;
  const options = Object.fromEntries(Object.entries(data).filter(([key]) => Object.hasOwn(definitionSchema.properties, key) && !['description', 'prompt', 'model', 'background', 'mcpServers'].includes(key)));
  const mcpServers = parseMcpServers(data.mcpServers, name, (message) => warn?.(message));
  const hadSkill = data.tools?.includes('Skill') === true;
  if (hadSkill) warn?.(`Agent '${name}': 'Skill' in tools is deprecated; use the skills field instead.`);
  return {
    ...options,
    ...(hadSkill ? { tools: data.tools?.filter((tool) => tool !== 'Skill'), skills: data.skills ?? [] } : {}),
    agentType: name,
    whenToUse: description,
    systemPrompt: prompt,
    source: 'flagSettings',
    baseDir,
    ...(model !== undefined ? { model: model.toLowerCase() === 'inherit' ? 'inherit' : model } : {}),
    ...(background ? { background: true } : {}),
    ...(mcpServers?.length ? { mcpServers } : {}),
  };
}

export function parseJsonAgents(text: string, baseDir: string, warn?: (message: string) => void): readonly AgentDefinition[] {
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch (error) {
    throw new Error(`invalid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof input !== 'object' || input === null || Array.isArray(input)) throw new Error('Agent definitions must be a JSON object.');
  return Object.entries(input).map(([name, value]) => {
    if (!name || name.startsWith('-')) throw new Error(`${name}: agent names must not start with '-' or be empty`);
    return parseJsonAgentSpec(name, value, baseDir, warn);
  });
}
