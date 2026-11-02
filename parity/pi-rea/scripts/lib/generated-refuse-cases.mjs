import { readFileSync } from 'node:fs';

import { ReaError } from '../../../../extensions/pi-rea/src/contract/errors.ts';
import { PROVIDER_REFUSE_BY_NAME, refuseProviderTool } from '../../../../extensions/pi-rea/src/tools/provider-refuse-tools.ts';
import { createSession } from './invoke-pi-rea.mjs';
import { invokeReaAgentsMcp } from './invoke-rea-agents.mjs';
import { target } from './paths.mjs';

const TOOLS_LIST = JSON.parse(readFileSync(new URL('../../rea-6.8.0-tools-list.json', import.meta.url), 'utf8'));

/** Providers whose oracle refusal needs a deterministic missing-tool environment. */
const ORACLE_ENV_BY_PROVIDER = {
  frida: { NODE_OPTIONS: '--no-addons' },
};

const PATH_LIKE = /(^|_)(path|file|dir|directory|output|target|source|artifact|bundle|capture|recording|binary|apk|ipa|archive|input|exe|image)$/i;
const ENDPOINT_LIKE = /(endpoint|port|url|host)/i;

const exampleValue = (name, schema) => {
  if (schema.enum !== undefined && Array.isArray(schema.enum) && schema.enum.length > 0) return schema.enum[0];
  if (schema.default !== undefined) return schema.default;
  if (schema.type === 'integer' || schema.type === 'number') {
    if (typeof schema.minimum === 'number') return schema.exclusiveMinimum === true ? schema.minimum + 1 : schema.minimum;
    return 1;
  }
  if (schema.type === 'boolean') return false;
  if (schema.type === 'array') return [];
  if (ENDPOINT_LIKE.test(name)) return '127.0.0.1:9222';
  if (PATH_LIKE.test(name)) return target('minimal-elf.bin');
  if (schema.type === 'object') return {};
  return `pi-rea-${name.replaceAll('_', '-')}`;
};

const exampleArgs = (tool) => {
  const schema = tool.inputSchema ?? {};
  const properties = schema.properties ?? {};
  const required = Array.isArray(schema.required) ? schema.required : [];
  const args = {};
  for (const name of required) {
    const property = properties[name];
    if (property === undefined || property === null) continue;
    args[name] = exampleValue(name, property);
  }
  return args;
};

const runPiReaRefuse = async (toolName, args) => {
  try {
    const result = await refuseProviderTool(createSession(), toolName, args);
    const text = result.content?.[0]?.text;
    let body;
    try {
      body = JSON.parse(text).error ?? JSON.parse(text);
    } catch {
      body = { code: 'execution_failure', category: 'execution_failure', message: text ?? 'error', retryable: false, remediation: { action: 'inspect' } };
    }
    return { kind: 'error', body };
  } catch (error) {
    if (error instanceof ReaError) return { kind: 'error', body: error.payload };
    throw error;
  }
};

const runOracleMcp = async (toolName, args, env) => {
  const result = await invokeReaAgentsMcp(toolName, args, env === undefined ? {} : { env });
  return { kind: result.kind, body: result.body };
};

export const generatedRefuseCases = (coveredTools) => {
  const covered = new Set(coveredTools);
  const cases = [];
  for (const tool of TOOLS_LIST) {
    if (covered.has(tool.name)) continue;
    const strategy = PROVIDER_REFUSE_BY_NAME.get(tool.name);
    if (strategy === undefined) continue;
    const args = exampleArgs(tool);
    cases.push({
      id: `${tool.name}--generated-refuse`,
      tool: tool.name,
      runPiRea: async () => runPiReaRefuse(tool.name, args),
      runOracle: async () => runOracleMcp(tool.name, args, ORACLE_ENV_BY_PROVIDER[strategy.providerId]),
    });
  }
  return cases;
};
