import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test } from 'vitest';
import { catalogDigest, loadCatalog } from '../src/contract/catalog.ts';
import { ERROR_CATEGORIES, ERROR_CODES } from '../src/contract/errors.ts';
import { isDirect } from '../src/registry.ts';

const catalog = loadCatalog();
const manifest = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '../schemas/kernel-manifest.json'), 'utf8'),
) as { kernelToolNames: readonly string[] };
const kernelNames = [...manifest.kernelToolNames].toSorted();

test('KERN-001: the contract carries 229 uniquely named tools', () => {
  expect(catalog.counts.tools).toBe(229);
  expect(catalog.counts.implemented).toBe(kernelNames.length);
  expect(catalog.counts.kernel).toBe(229);
  expect(catalog.counts.unavailable).toBe(0);
  expect(catalog.tools).toHaveLength(229);
  expect(new Set(catalog.tools.map((tool) => tool.name)).size).toBe(229);
  expect(catalog.tools.every((tool) => /^[a-z][a-z0-9_]*$/.test(tool.name))).toBe(true);
});

test('KERN-001: the implemented set matches kernel-manifest', () => {
  expect(
    catalog.tools
      .filter((tool) => tool.implementation === 'kernel')
      .map((tool) => tool.name)
      .toSorted(),
  ).toStrictEqual(kernelNames);
});

test('KERN-001: every tool advertises parameters, annotations, effects and a surface', () => {
  for (const tool of catalog.tools) {
    expect(tool.parameters['type']).toBe('object');
    expect(tool.parameters['additionalProperties']).toBe(false);
    expect(tool.description.length).toBeGreaterThan(20);
    expect(Object.keys(tool.annotations).toSorted()).toStrictEqual(['destructiveHint', 'idempotentHint', 'openWorldHint', 'readOnlyHint']);
    expect(Object.values(tool.annotations).every((value) => typeof value === 'boolean')).toBe(true);
    expect(Object.values(tool.effects).every((value) => typeof value === 'boolean')).toBe(true);
    expect(tool.surface.length).toBeGreaterThan(0);
  }
});

test('KERN-002: the contract ships no reference expression', () => {
  const requiredKeys = ['annotations', 'clientRequirements', 'description', 'effects', 'implementation', 'modes', 'name', 'parameters', 'surface'];
  const allowedKeys = [...requiredKeys, 'defaultModeAvailable'].toSorted();
  for (const tool of catalog.tools) {
    const keys = Object.keys(tool).toSorted();
    expect(keys).toContain('name');
    expect(allowedKeys.filter((key) => !keys.includes(key))).toStrictEqual(['defaultModeAvailable'].filter((key) => !keys.includes(key)));
    expect(keys.filter((key) => !allowedKeys.includes(key))).toStrictEqual([]);
    expect(requiredKeys.every((key) => keys.includes(key))).toBe(true);
  }
  const allowed = new Set([
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
  const collect = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      for (const entry of node) collect(entry, path);
      return;
    }
    if (node === null || typeof node !== 'object') return;
    for (const [key, value] of Object.entries(node)) {
      if (path.endsWith('.properties')) {
        collect(value, `${path}.${key}`);
        continue;
      }
      expect(allowed.has(key), `${path}.${key} is not a structural keyword`).toBe(true);
      collect(value, `${path}.${key}`);
    }
  };
  for (const tool of catalog.tools) collect(tool.parameters, tool.name);
});

test('KERN-002: nested parameter structure survives transcription', () => {
  const byName = new Map(catalog.tools.map((tool) => [tool.name, tool.parameters]));

  const filters = byName.get('get_evidence_bundle')?.['properties'] as Record<string, { properties?: Record<string, unknown> }>;
  expect(Object.keys(filters?.['filters']?.properties ?? {}).toSorted()).toStrictEqual(['analysis_profile_digest', 'evidence_id', 'operation', 'procedure_address', 'target_sha256']);

  const view = byName.get('inspect_analysis_view')?.['properties'] as Record<string, { anyOf?: { const?: string }[] }>;
  const viewSource = JSON.stringify(view['source']);
  expect(viewSource).toContain('"const":"inline"');
  expect(viewSource).toContain('"const":"retained-evidence"');

  const updateProperties = byName.get('update_unknown')?.['properties'] as Record<string, unknown> | undefined;
  const resolution = JSON.stringify(updateProperties?.['resolution']);
  expect(resolution).toContain('"const":"verified"');
  expect(resolution).toContain('"out-of-scope"');
  expect(resolution).toContain('"evidence_ids"');

  const status = (updateProperties?.['status'] as { enum?: string[] } | undefined)?.enum;
  expect(status).toStrictEqual(['open', 'investigating', 'blocked', 'contradicted', 'resolved']);
  expect(byName.size).toBe(229);
});

test('KERN-002: every catalog tool is marked kernel with no unavailable stub prose', () => {
  const unimplemented = catalog.tools.filter((tool) => tool.implementation === 'unavailable');
  expect(unimplemented).toHaveLength(0);
  for (const tool of catalog.tools) {
    expect(tool.implementation).toBe('kernel');
    expect(tool.description).not.toContain('Not implemented in pi-rea yet');
  }
});

test('KERN-002: the contract records its provenance without claiming REA authorship', () => {
  expect(catalog.provenance.interface).toBe('rea-agents 6.8.0');
  expect(catalog.provenance.note).toContain('No REA prose');
  expect(catalog.provenance.capture_sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(catalogDigest()).toMatch(/^[a-f0-9]{64}$/);
});

test('KERN-002: the host and provider inventories are recorded as interface facts', () => {
  expect(catalog.hostCapabilities.length).toBe(18);
  expect(
    catalog.tools
      .filter((tool) => tool.modes.length > 0)
      .map((tool) => tool.name)
      .toSorted(),
  ).toStrictEqual(['get_navigation_context', 'trace_web_module_imports']);
  for (const tool of catalog.tools) {
    for (const mode of tool.modes) expect(Object.keys(mode).toSorted()).toStrictEqual(['available', 'missing_operations', 'name']);
  }
  expect(catalog.providerCandidates.map((candidate) => candidate.provider.id)).toStrictEqual(['ghidra', 'hopper', 'ida', 'kuna']);
  for (const capability of catalog.hostCapabilities) {
    expect(typeof capability.operation).toBe('string');
    expect(Object.values(capability.effects).every((value) => typeof value === 'boolean')).toBe(true);
  }
});

test('KERN-003: every catalog tool is declared direct (kernel)', () => {
  const direct = catalog.tools.filter(isDirect).map((tool) => tool.name);
  expect(direct).toHaveLength(229);
  expect(direct).toContain('binary_session');
  expect(direct).toContain('export_evidence_bundle');
  expect(direct).toContain('inspect_plist');
  expect(direct).toContain('analyze_javascript_application');
  expect(direct).toContain('inspect_wasm_artifact');
  expect(catalog.tools.filter((tool) => !isDirect(tool))).toHaveLength(0);
});

test('KERN-004: error codes and categories are the reference vocabularies', () => {
  expect(ERROR_CATEGORIES).toStrictEqual(['invalid_input', 'unsupported_provider', 'unsupported_target', 'integrity_mismatch', 'truncated', 'cancelled', 'timeout', 'resource_constraint', 'unavailable', 'execution_failure']);
  expect(ERROR_CODES).toHaveLength(20);
  expect(ERROR_CODES).toContain('capability_unavailable');
  expect(ERROR_CODES).toContain('evidence_integrity_mismatch');
  expect(ERROR_CODES).toContain('revision_conflict');
});

test('KERN-002: the catalog loads once and reports its own digest', () => {
  expect(loadCatalog()).toBe(loadCatalog());
  expect(catalogDigest()).toBe(catalogDigest());
  expect(catalogDigest()).not.toBe('0'.repeat(64));
});
