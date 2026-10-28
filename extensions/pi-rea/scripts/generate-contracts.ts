import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = join(ROOT, '../..');
const ORACLE_PATH = join(REPO, 'parity/pi-rea/rea-6.8.0-tools-list.json');
const GROUPS_PATH = join(REPO, 'parity/pi-rea/tool-availability-groups.json');
const BINARY_SESSION_PATH = join(REPO, 'parity/pi-rea/rea-6.8.0-binary_session.json');
const MANIFEST_PATH = join(ROOT, 'schemas/kernel-manifest.json');
const OUT_PATH = join(ROOT, 'schemas/tool-contracts.json');

const SCHEMA_KEYWORDS = new Set([
  'type',
  'enum',
  'const',
  'format',
  'pattern',
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'minItems',
  'maxItems',
  'uniqueItems',
  'minProperties',
  'maxProperties',
  'required',
  'additionalProperties',
  'properties',
  'items',
  'prefixItems',
  'anyOf',
  'oneOf',
  'allOf',
  'not',
  'propertyNames',
  'dependentRequired',
]);

const EFFECT_KEYS = ['mutatesTarget', 'mutatesSession', 'writesFilesystem', 'launchesProcess', 'accessesNetwork', 'changesUiState', 'mayDiscardData', 'idempotent'] as const;

type EffectKey = (typeof EFFECT_KEYS)[number];

interface OracleTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly annotations?: Partial<Record<'readOnlyHint' | 'destructiveHint' | 'idempotentHint' | 'openWorldHint', boolean>>;
}

interface KernelManifest {
  readonly version: number;
  readonly kernelToolNames: readonly string[];
}

interface AvailabilityGroup {
  readonly names: readonly string[];
  readonly surface: string;
  readonly effects: readonly string[];
}

interface SeedTool {
  readonly name: string;
  readonly description: string;
  readonly parameters?: Record<string, unknown>;
  readonly annotations: Record<string, boolean>;
  readonly effects: Record<string, boolean>;
  readonly surface: string;
  readonly clientRequirements: Record<string, unknown>;
  readonly modes: readonly Record<string, unknown>[];
  readonly defaultModeAvailable?: boolean;
}

const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8')) as T;

const sanitizeSchema = (node: unknown, inProperties: boolean): unknown => {
  if (Array.isArray(node)) return node.map((entry) => sanitizeSchema(entry, false));
  if (node === null || typeof node !== 'object') return node;
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (inProperties) {
      out[key] = sanitizeSchema(value, false);
      continue;
    }
    if (!SCHEMA_KEYWORDS.has(key)) continue;
    out[key] = sanitizeSchema(value, key === 'properties');
  }
  return out;
};

const humanize = (name: string): string => {
  const words = name.split('_').filter((part) => part.length > 0);
  if (words.length === 0) return 'REA tool';
  const [first, ...rest] = words;
  if (first === undefined) return 'REA tool';
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ');
};

const portDescription = (name: string, implementation: 'kernel' | 'unavailable', seed?: SeedTool): string => {
  if (seed !== undefined && seed.description.length > 20) {
    if (implementation === 'unavailable' && !seed.description.includes('Not implemented in pi-rea yet')) {
      return `${seed.description.replace(/\.\s*$/, '')}. Not implemented in pi-rea yet: the tool is advertised for compatibility and fails closed with capability_unavailable.`;
    }
    if (implementation === 'kernel') {
      const stripped = seed.description.replace(/\s*Not implemented in pi-rea yet:[^.]*\./g, '').trim();
      if (stripped.length > 20) return stripped;
      return `${humanize(name)} via pi-rea's in-process analyzer for the active session.`;
    }
    return seed.description;
  }
  if (implementation === 'kernel') {
    return `${humanize(name)} for the active pi-rea session.`;
  }
  return `${humanize(name)}. Not implemented in pi-rea yet: the tool is advertised for compatibility and fails closed with capability_unavailable.`;
};

const effectsFromGroup = (groupEffects: readonly string[]): Record<EffectKey, boolean> => {
  const set = new Set(groupEffects);
  const out = {} as Record<EffectKey, boolean>;
  for (const key of EFFECT_KEYS) out[key] = set.has(key);
  return out;
};

const hostEffects = (raw: readonly string[]): Record<string, boolean> => {
  const set = new Set(raw);
  return {
    mutates_artifact: set.has('mutates_artifact'),
    launches_process: set.has('launches_process'),
    may_show_ui: set.has('may_show_ui'),
    may_access_network: set.has('may_access_network'),
    may_write_filesystem: set.has('may_write_filesystem'),
    changes_permissions: set.has('changes_permissions'),
    requires_root: set.has('requires_root'),
  };
};

const emptyClientRequirements = (): Record<string, unknown> => ({
  required: [],
  optional: [],
  missing_required: [],
  missing_optional: [],
});

const propertyRecord = (value: unknown): Record<string, unknown> => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {});

const placeholderSchema = (value: unknown): boolean => {
  const record = propertyRecord(value);
  return Object.keys(record).length === 1 && Object.hasOwn(record, 'type');
};

const detailed = (candidate: unknown, alternative: unknown): unknown => (JSON.stringify(candidate).length >= JSON.stringify(alternative).length ? candidate : alternative);

const mergeProperties = (seedProperties: Record<string, unknown>, oracleProperties: Record<string, unknown>): Record<string, unknown> => {
  const merged: Record<string, unknown> = { ...seedProperties };
  for (const [name, schema] of Object.entries(oracleProperties)) {
    const seed = merged[name];
    merged[name] = seed === undefined || placeholderSchema(schema) ? (seed ?? schema) : detailed(seed, schema);
  }
  return merged;
};

const chooseParameters = (oracleSchema: Record<string, unknown>, seed?: SeedTool): Record<string, unknown> => {
  const sanitized = sanitizeSchema(oracleSchema, false) as Record<string, unknown>;
  if (sanitized['type'] !== 'object') sanitized['type'] = 'object';
  if (!('additionalProperties' in sanitized)) sanitized['additionalProperties'] = false;
  if (!('properties' in sanitized)) sanitized['properties'] = {};

  const seedParameters = seed?.parameters;
  if (seedParameters === undefined) return sanitized;

  const merged: Record<string, unknown> = { ...sanitized };
  merged['properties'] = mergeProperties(propertyRecord(seedParameters['properties']), propertyRecord(sanitized['properties']));
  if (!Array.isArray(sanitized['required']) && Array.isArray(seedParameters['required'])) merged['required'] = seedParameters['required'];
  return merged;
};

const main = (): void => {
  const oracle = readJson<OracleTool[]>(ORACLE_PATH);
  const manifest = readJson<KernelManifest>(MANIFEST_PATH);
  const groups = readJson<AvailabilityGroup[]>(GROUPS_PATH);
  const binarySession = readJson<{
    result: {
      structuredContent: {
        result: {
          capabilities: readonly {
            groups: readonly { operations: readonly string[]; effects: readonly string[] }[];
          }[];
          analysis_provider_candidates: readonly {
            provider: { id: string; name: string; version: string | null };
          }[];
        };
      };
    };
  }>(BINARY_SESSION_PATH);

  const kernel = new Set(manifest.kernelToolNames);
  for (const name of kernel) {
    if (!oracle.some((tool) => tool.name === name)) {
      throw new Error(`kernel-manifest names ${name}, which is absent from the 6.8.0 oracle`);
    }
  }

  const groupByName = new Map<string, AvailabilityGroup>();
  for (const group of groups) {
    for (const name of group.names) groupByName.set(name, group);
  }

  let seedByName = new Map<string, SeedTool>();
  try {
    const previous = readJson<{ tools: SeedTool[] }>(OUT_PATH);
    seedByName = new Map(previous.tools.map((tool) => [tool.name, tool]));
  } catch {}

  const tools = oracle.map((wire) => {
    const seed = seedByName.get(wire.name);
    const group = groupByName.get(wire.name);
    const implementation = kernel.has(wire.name) ? ('kernel' as const) : ('unavailable' as const);
    const annotations = {
      readOnlyHint: seed?.annotations['readOnlyHint'] ?? wire.annotations?.readOnlyHint ?? false,
      destructiveHint: seed?.annotations['destructiveHint'] ?? wire.annotations?.destructiveHint ?? false,
      idempotentHint: seed?.annotations['idempotentHint'] ?? wire.annotations?.idempotentHint ?? false,
      openWorldHint: seed?.annotations['openWorldHint'] ?? wire.annotations?.openWorldHint ?? false,
    };
    const parameters = chooseParameters(wire.inputSchema ?? { type: 'object', properties: {}, additionalProperties: false }, seed);

    const tool: Record<string, unknown> = {
      name: wire.name,
      description: portDescription(wire.name, implementation, seed),
      parameters,
      annotations,
      effects: seed?.effects ?? effectsFromGroup(group?.effects ?? []),
      surface: seed?.surface ?? group?.surface ?? 'session',
      clientRequirements: seed?.clientRequirements ?? emptyClientRequirements(),
      modes: seed?.modes ?? [],
      implementation,
    };
    if (seed?.defaultModeAvailable !== undefined) tool['defaultModeAvailable'] = seed.defaultModeAvailable;
    return tool;
  });

  const hostCapabilities = binarySession.result.structuredContent.result.capabilities.flatMap((capability) =>
    capability.groups.flatMap((group) =>
      group.operations.map((operation) => ({
        operation,
        effects: hostEffects(group.effects),
      })),
    ),
  );

  const providerCandidates = binarySession.result.structuredContent.result.analysis_provider_candidates.map((candidate) => ({
    provider: {
      id: candidate.provider.id,
      name: candidate.provider.name,
      version: candidate.provider.version,
    },
  }));

  const oracleBytes = readFileSync(ORACLE_PATH);
  const toolsSha256 = createHash('sha256').update(oracleBytes).digest('hex');
  const implemented = tools.filter((tool) => tool['implementation'] === 'kernel').length;

  const catalog = {
    kind: 'pi-rea-tool-contracts',
    provenance: {
      interface: 'rea-agents 6.8.0',
      method: 'black-box observation of the published tool interface (names, parameter names, types, bounds, structure, flags)',
      oracle: 'parity/pi-rea/rea-6.8.0-tools-list.json',
      capture_sha256: toolsSha256,
      note: 'Interface facts only. No REA prose, examples, defaults or output schemas are included.',
    },
    counts: {
      tools: tools.length,
      implemented,
      kernel: implemented,
      unavailable: tools.length - implemented,
    },
    hostCapabilities,
    providerCandidates,
    tools,
  };

  if (catalog.counts.tools !== 229) {
    throw new Error(`expected 229 tools, got ${catalog.counts.tools}`);
  }
  if (catalog.counts.kernel !== kernel.size) {
    throw new Error(`kernel count ${catalog.counts.kernel} !== manifest size ${kernel.size}`);
  }

  writeFileSync(OUT_PATH, `${JSON.stringify(catalog, null, 2)}\n`);
  console.log(`wrote ${OUT_PATH} (${catalog.counts.tools} tools, ${catalog.counts.kernel} kernel)`);
};

main();
