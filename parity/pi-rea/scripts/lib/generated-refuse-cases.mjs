import { readFileSync } from 'node:fs';

import { ReaError } from '../../../../extensions/pi-rea/src/contract/errors.ts';
import { PROVIDER_REFUSE_BY_NAME, refuseProviderTool } from '../../../../extensions/pi-rea/src/tools/provider-refuse-tools.ts';
import { createSession } from './invoke-pi-rea.mjs';
import { invokeReaAgentsMcp } from './invoke-rea-agents.mjs';
import { target } from './paths.mjs';

const TOOLS_LIST = JSON.parse(readFileSync(new URL('../../rea-6.8.0-tools-list.json', import.meta.url), 'utf8'));

const pathWithoutAdb = () =>
  (process.env.PATH ?? '')
    .split(':')
    .filter((p) => !/Android\/sdk|platform-tools/i.test(p))
    .join(':');

/** Providers whose oracle refusal needs a deterministic missing-tool environment. */
const ORACLE_ENV_BY_PROVIDER = {
  frida: { NODE_OPTIONS: '--no-addons' },
  adb: { PATH: pathWithoutAdb(), REA_ADB_PATH: '' },
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
  if (ENDPOINT_LIKE.test(name)) return 'http://127.0.0.1:9222';
  if (name.includes('uuid') || name === 'session_id' || name === 'script_id') return '00000000-0000-4000-8000-000000000000';
  if (name === 'package' || name === 'package_name') return 'com.example.app';
  if (name === 'serial') return 'emulator-5554';
  if (name === 'pattern') return '90 90';
  if (PATH_LIKE.test(name)) return target('minimal-elf.bin');
  if (schema.type === 'object') return {};
  return `pi-rea-${name.replaceAll('_', '-')}`;
};

const JADX_OVERRIDES = {
  inspect_android_package: { path: target('apk/v1-only.apk') },
  inspect_android_method: { path: target('apk/v1-only.apk'), class_name: 'a.b.C', method_name: 'foo' },
  search_android_classes: { path: target('apk/v1-only.apk'), query: 'foo' },
  trace_android_references: { path: target('apk/v1-only.apk'), class_name: 'a.b.C' },
  annotate_native_function: { procedure: 'main', comment: 'test' },
  search_bytes: { pattern: '90 90' },
  inspect_native_data_type: { type: 'int' },
  decompile_all: { output_directory: '/tmp/rea-decompile-all-out-dir' },
  extract_firmware: { path: target('minimal-elf.bin'), output_directory: '/tmp/rea-unblob-out-dir' },
  capture_native_ui_scenario: { pid: 1, window_id: 1, steps: [{ kind: 'wait', milliseconds: 10 }] },
  instrument_with_frida: { mode: 'attach', device_id: 'local', pid: 1, source_kind: 'inline', source: 'console.log(1);' },
  list_frida_processes: { device_id: 'local' },
  load_frida_script: { session_id: '00000000-0000-4000-8000-000000000000', source_kind: 'inline', source: 'console.log(1);' },
  unload_frida_script: { session_id: '00000000-0000-4000-8000-000000000000', script_id: '00000000-0000-4000-8000-000000000000' },
  cutter_command: { session_id: '00000000-0000-4000-8000-000000000000', command: 'x', expected_generation: 1 },
  gdb_console: { session_id: '00000000-0000-4000-8000-000000000000', command: 'info registers' },
  rizin_debug_command: { session_id: '00000000-0000-4000-8000-000000000000', command: 'dr' },
};

const exampleArgs = (tool) => {
  if (JADX_OVERRIDES[tool.name] !== undefined) return JADX_OVERRIDES[tool.name];
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
    const result = await refuseProviderTool(createSession(), toolName, { ...args, __contract_probe__: true });
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
