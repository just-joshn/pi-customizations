import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { ReaSession } from '../src/session/binary-session.ts';
import {
  compareApplicationVersionsTool,
  compareJavascriptExportShapesTool,
  compareSourceToBundleTool,
} from '../src/tools/compare-tools.ts';
import { analyzeJavascriptApplication } from '../src/tools/javascript-tools.ts';
import { projectAppleApplicationGraphTool } from '../src/tools/apple-graph-tools.ts';
import { exportWebScriptsTool } from '../src/tools/web-script-tools.ts';
import { createEvidence } from '../src/session/evidence.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const normalized = async (run: () => { structuredContent?: unknown } | Promise<{ structuredContent?: unknown }>): Promise<Record<string, unknown>> => {
  const result = await run();
  return (result.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;
};

const asError = async (run: () => unknown): Promise<{ code: string; message: string }> => {
  try {
    await run();
    throw new Error('expected failure');
  } catch (error) {
    const payload = (error as { payload?: { code: string; message: string } }).payload;
    if (payload === undefined) throw error;
    return payload;
  }
};

const writeJsApp = async (root: string, mainBody: string): Promise<void> => {
  await mkdir(join(root, 'src'), { recursive: true });
  await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'fixture', main: 'src/main.js' }));
  await writeFile(join(root, 'src/main.js'), mainBody);
};

test('compare_javascript_export_shapes: reports added return property across distinct graphs', async () => {
  const session = new ReaSession(runtime);
  const leftDir = await mkdtemp(join(tmpdir(), 'pi-rea-jesc-l-'));
  const rightDir = await mkdtemp(join(tmpdir(), 'pi-rea-jesc-r-'));
  await writeJsApp(
    leftDir,
    `export function shape(kind) {
  if (kind === 'a') return { x: 1, y: 2 };
  return { x: 1, z: 3 };
}
`,
  );
  await writeJsApp(
    rightDir,
    `export function shape(kind) {
  if (kind === 'a') return { x: 1, y: 2 };
  return { x: 1, z: 3, w: 4 };
}
`,
  );
  const left = await analyzeJavascriptApplication(session, { input_path: leftDir }, { cwd: leftDir });
  const right = await analyzeJavascriptApplication(session, { input_path: rightDir }, { cwd: rightDir });
  const record = await normalized(() =>
    compareJavascriptExportShapesTool(session, {
      left: left.structuredContent,
      right: right.structuredContent,
      left_module_path: 'src/main.js',
      left_export_name: 'shape',
      right_module_path: 'src/main.js',
      right_export_name: 'shape',
    }),
  );
  expect((record['left'] as { status: string }).status).toBe('selected');
  expect((record['right'] as { status: string }).status).toBe('selected');
  expect((record['summary'] as { added: number }).added).toBe(1);
  expect((record['changes'] as { path: string; status: string }[]).some((change) => change.path === '/w' && change.status === 'added')).toBe(true);

  const same = await asError(() =>
    compareJavascriptExportShapesTool(session, {
      left: left.structuredContent,
      right: left.structuredContent,
      left_module_path: 'src/main.js',
      left_export_name: 'shape',
      right_module_path: 'src/main.js',
      right_export_name: 'shape',
    }),
  );
  expect(same.code).toBe('invalid_request');
  await rm(leftDir, { recursive: true, force: true });
  await rm(rightDir, { recursive: true, force: true });
});

test('compare_application_versions: distinct graphs produce added/removed or changed items', async () => {
  const session = new ReaSession(runtime);
  const leftDir = await mkdtemp(join(tmpdir(), 'pi-rea-javc-l-'));
  const rightDir = await mkdtemp(join(tmpdir(), 'pi-rea-javc-r-'));
  await writeJsApp(leftDir, 'export const plain = { a: 1 };\n');
  await writeJsApp(rightDir, 'export const plain = { a: 2 };\nexport const extra = 1;\n');
  const left = await analyzeJavascriptApplication(session, { input_path: leftDir }, { cwd: leftDir });
  const right = await analyzeJavascriptApplication(session, { input_path: rightDir }, { cwd: rightDir });
  const record = await normalized(() =>
    compareApplicationVersionsTool(session, {
      left: left.structuredContent,
      right: right.structuredContent,
    }),
  );
  const summary = record['summary'] as { added: number; removed: number; changed: number; unchanged: number };
  expect(summary.added + summary.removed + summary.changed + summary.unchanged).toBeGreaterThan(0);
  expect((record['items'] as unknown[]).length).toBeGreaterThan(0);
  await rm(leftDir, { recursive: true, force: true });
  await rm(rightDir, { recursive: true, force: true });
});

test('compare_source_to_bundle: exact digest maps unchanged; missing source is removed', async () => {
  const session = new ReaSession(runtime);
  const appDir = await mkdtemp(join(tmpdir(), 'pi-rea-stbc-'));
  await writeJsApp(appDir, 'export const plain = { a: 1 };\n');
  const app = await analyzeJavascriptApplication(session, { input_path: appDir }, { cwd: appDir });
  const appNr = (app.structuredContent as { normalized_result: Record<string, unknown> }).normalized_result;
  const graph = appNr['graph'] as { nodes: { kind: string; observations: { properties: { path?: string }; evidence: { artifact: { sha256: string } } }[] }[] };
  const asset = graph.nodes.find((node) => node.kind === 'javascript-asset' && node.observations[0]?.properties.path === 'src/main.js');
  expect(asset).toBeDefined();
  const sha = asset!.observations[0]!.evidence.artifact.sha256;
  const reference = {
    schema: 'HistoricalSourceGraph',
    authority: 'historical-reference',
    root_alias: '$REFERENCE_ROOT',
    root_sha256: 'a'.repeat(64),
    inventory_state: 'complete',
    entries: [
      { path: 'src/main.js', kind: 'file', classifications: ['source'], language: 'JavaScript', sha256: sha, limitations: [] },
      { path: 'src/missing.js', kind: 'file', classifications: ['source'], language: 'JavaScript', sha256: 'b'.repeat(64), limitations: [] },
    ],
    relationships: [],
    parse_failures: [],
    limitations: [],
  };
  const record = await normalized(() =>
    compareSourceToBundleTool(session, {
      reference,
      application: app.structuredContent,
    }),
  );
  expect((record['summary'] as { unchanged: number }).unchanged).toBe(1);
  expect((record['summary'] as { removed: number }).removed).toBe(1);
  expect((record['items'] as unknown[]).length).toBe(2);
  expect((record['scoring'] as { weights: { signal: string }[] }).weights[0]?.signal).toBe('exact-source-digest');
  await rm(appDir, { recursive: true, force: true });
});

test('export_web_scripts: writes retained script bytes when capture is full Evidence-shaped', async () => {
  const session = new ReaSession(runtime);
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-ews-'));
  const capturePath = join(dir, 'capture.json');
  const output = join(dir, 'out');
  await writeFile(
    capturePath,
    JSON.stringify({
      evidence_id: `ev_${'c'.repeat(64)}`,
      subject: {
        name: 'page',
        digest: { sha256: 'a'.repeat(64) },
        format: 'web-page',
        architecture: null,
        local_path: null,
      },
      provider: { id: 'test', name: 'test', version: '1' },
      analysis_profile: { id: 'default' },
      predicate_type: 'rea.web-page-inspection',
      operation: 'inspect_web_page',
      parameters: {},
      raw_result: {},
      confidence: 'observed',
      authority: 'shipped-artifact',
      environment: {},
      limitations: [],
      relationship_coverage: {},
      locations: [],
      evidence_links: [],
      normalized_result: {
        script_sources: [{ url: 'https://example.com/app.js', text: 'export const x = 1;\n' }],
      },
    }),
  );
  const record = await normalized(() => exportWebScriptsTool(session, { capture_path: capturePath, output_directory: output }));
  expect(record['capture_kind']).toBe('page-inspection');
  expect((record['scripts'] as { relative_path: string }[]).length).toBe(1);
  const body = await readFile(join(output, (record['scripts'] as { relative_path: string }[])[0]!.relative_path), 'utf8');
  expect(body).toBe('export const x = 1;\n');
  const closed = await asError(() => exportWebScriptsTool(session, { capture_path: capturePath, output_directory: output }));
  expect(closed.code).toBe('invalid_request');
  await rm(dir, { recursive: true, force: true });
});

test('export_web_scripts: incomplete offline capture refuses like REA schema admission', async () => {
  const session = new ReaSession(runtime);
  const dir = await mkdtemp(join(tmpdir(), 'pi-rea-ews-bad-'));
  const capturePath = join(dir, 'capture.json');
  const output = join(dir, 'out');
  await writeFile(
    capturePath,
    JSON.stringify({
      evidence_id: `ev_${'c'.repeat(64)}`,
      operation: 'inspect_web_page',
      normalized_result: {
        script_sources: [{ url: 'https://example.com/app.js', text: 'export const x = 1;\n' }],
      },
    }),
  );
  const closed = await asError(() => exportWebScriptsTool(session, { capture_path: capturePath, output_directory: output }));
  expect(closed.code).toBe('invalid_request');
  expect(closed.retryable).toBe(false);
  expect(closed.recovery).toStrictEqual({ kind: 'inspect_input_contract', operation: 'export_web_scripts' });
  await rm(dir, { recursive: true, force: true });
});

test('project_apple_application_graph: projects path-convention roles from inventory Evidence', async () => {
  const session = new ReaSession(runtime);
  const inventory = createEvidence({
    subject: {
      name: 'Fixture.app',
      digest: { sha256: 'd'.repeat(64) },
      format: 'directory',
      architecture: null,
      local_path: '/tmp/Fixture.app',
    },
    provider: { id: 'pi-rea-test', name: 'pi-rea test', version: '1' },
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_artifact',
    parameters: {},
    raw_result: null,
    normalized_result: {
      root_artifact_sha256: 'd'.repeat(64),
      root_format: 'directory',
      collections: {
        occurrences: [
          { logical_path: 'Fixture.app', is_directory: true, calculated_sha256: null },
          { logical_path: 'Fixture.app/Contents/Info.plist', is_directory: false, calculated_sha256: 'e'.repeat(64) },
          { logical_path: 'Fixture.app/Contents/MacOS/Fixture', is_directory: false, calculated_sha256: 'f'.repeat(64) },
          { logical_path: 'Fixture.app/Contents/XPCServices/Helper.xpc', is_directory: true, calculated_sha256: null },
          { logical_path: 'Fixture.app/Contents/XPCServices/Helper.xpc/Contents/Info.plist', is_directory: false, calculated_sha256: 'a'.repeat(64) },
        ],
      },
    },
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [],
    locations: [],
    evidence_links: [],
  });
  session.evidence.record(inventory);
  const record = await normalized(() =>
    projectAppleApplicationGraphTool(session, {
      inventory_evidence: [inventory],
    }),
  );
  const bundles = record['bundles'] as { path: string; role: string; layout: string }[];
  expect(bundles.some((bundle) => bundle.path === 'Fixture.app' && bundle.role === 'application' && bundle.layout === 'macos-deep')).toBe(true);
  expect(bundles.some((bundle) => bundle.path.endsWith('Helper.xpc') && bundle.role === 'xpc-service')).toBe(true);
  expect((record['platforms'] as string[]).includes('macos')).toBe(true);
  const empty = await asError(() => projectAppleApplicationGraphTool(session, { inventory_evidence: [] }));
  expect(empty.code).toBe('invalid_request');
});
