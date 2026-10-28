import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { expect, test } from 'vitest';
import { identifyArtifact } from '../src/targets/artifact-identity.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectArtifact } from '../src/tools/artifact-tools.ts';
import { inspectBinaryLayout } from '../src/tools/binary-layout-tools.ts';
import { inspectGoBinary } from '../src/tools/go-binary-tools.ts';
import { inspectWebNetworkCapture } from '../src/tools/har-tools.ts';
import { analyzeJavascriptApplication } from '../src/tools/javascript-tools.ts';
import { fixturePath } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const NOTEPAD = fileURLToPath(new URL('../../../parity/reverse-engineer-anything/fixtures/targets/notepad-app', import.meta.url));

const evidenceIdOf = (result: { structuredContent?: unknown }): string => {
  const record = result.structuredContent as { evidence_id: string; operation: string };
  expect(record.evidence_id).toMatch(/^ev_[a-f0-9]{64}$/);
  return record.evidence_id;
};

test('ABSORB-001: analyze_javascript_application returns Evidence for a directory tree', async () => {
  const session = new ReaSession(runtime);
  const result = await analyzeJavascriptApplication(session, { input_path: NOTEPAD, format: 'directory' });
  const record = result.structuredContent as Record<string, unknown>;
  expect(record['operation']).toBe('analyze_javascript_application');
  expect(record['confidence']).toBe('derived');
  expect(record['authority']).toBe('shipped-artifact');
  evidenceIdOf(result);
  const normalized = record['normalized_result'] as { format: string; graph: { nodes: unknown[] } };
  expect(normalized.format).toBe('directory');
  expect(normalized.graph.nodes.length).toBeGreaterThan(0);
  expect(session.evidence.size).toBe(1);
});

test('ABSORB-002: inspect_artifact returns Evidence for an open ZIP target', async () => {
  const session = new ReaSession(runtime);
  const path = fixturePath('targets/fixture.zip');
  session.openTarget(await identifyArtifact(path));
  const result = await inspectArtifact(session, { integrity_policy: 'fail' });
  const record = result.structuredContent as Record<string, unknown>;
  expect(record['operation']).toBe('inspect_artifact');
  evidenceIdOf(result);
  const normalized = record['normalized_result'] as {
    subject: { root_format: string };
    observations: unknown[];
    substeps: { operation: string }[];
  };
  expect(normalized.subject.root_format).toBe('zip');
  expect(normalized.observations.length).toBeGreaterThan(0);
  expect(normalized.substeps.some((step) => step.operation === 'inventory_artifact')).toBe(true);
});

test('ABSORB-003: inspect_binary_layout matches REA pwntools Linux-x64 host gate', async () => {
  const session = new ReaSession(runtime);
  const path = fixturePath('targets/minimal-elf.bin');
  if (process.platform === 'linux' && process.arch === 'x64') {
    const result = await inspectBinaryLayout(session, { path });
    const record = result.structuredContent as Record<string, unknown>;
    expect(record['operation']).toBe('inspect_binary_layout');
    evidenceIdOf(result);
    const normalized = record['normalized_result'] as { format: string; architecture: string | null };
    expect(normalized.format).toBe('elf');
    expect(normalized.architecture).toBe('x86_64');
    return;
  }
  let thrown: unknown;
  try {
    await inspectBinaryLayout(session, { path });
  } catch (error) {
    thrown = error;
  }
  const payload = (thrown as { payload: { code: string; details?: { provider_id?: string } } }).payload;
  expect(payload.code).toBe('capability_unavailable');
  expect(payload.details?.provider_id).toBe('pwntools-elf');
});

test('ABSORB-004: inspect_go_binary returns Evidence for an embedded buildinfo blob', async ({ onTestFinished }) => {
  const marker = Buffer.from('\xff Go buildinf:', 'latin1');
  const header = Buffer.alloc(32);
  marker.copy(header, 0);
  header[14] = 8;
  header[15] = 0;
  const text = Buffer.from('go1.17.5\nexample.com/probe (devel)\n\nGOOS=darwin\nGOARCH=arm64\n', 'latin1');
  const blob = Buffer.concat([Buffer.from([0xde, 0xad]), Buffer.concat([header, text]), Buffer.from([0xff])]);
  const dir = mkdtempSync(join(tmpdir(), 'pi-rea-go-'));
  const path = join(dir, 'probe.bin');
  writeFileSync(path, blob);
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  const session = new ReaSession(runtime);
  const result = await inspectGoBinary(session, { path });
  const record = result.structuredContent as Record<string, unknown>;
  expect(record['operation']).toBe('inspect_go_binary');
  evidenceIdOf(result);
  const normalized = record['normalized_result'] as { build_info: { go_version: string }; format: string };
  expect(normalized.build_info.go_version).toBe('go1.17.5');
  expect(normalized.format).toBeDefined();
});

test('ABSORB-005: inspect_web_network_capture returns Evidence for a HAR document', async ({ onTestFinished }) => {
  const dir = mkdtempSync(join(tmpdir(), 'pi-rea-har-'));
  const path = join(dir, 'capture.har');
  writeFileSync(
    path,
    JSON.stringify({
      log: {
        version: '1.2',
        creator: { name: 'pi-rea-test', version: '1' },
        entries: [
          {
            startedDateTime: '2026-10-13T05:00:00.000Z',
            time: 12,
            request: { method: 'GET', url: 'https://api.example.test/api/notes/42', headers: [] },
            response: { status: 200, headers: [], content: { mimeType: 'application/json', text: '{}' } },
          },
        ],
      },
    }),
  );
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));

  const session = new ReaSession(runtime);
  const result = await inspectWebNetworkCapture(session, { capture_path: path, format: 'har' });
  const record = result.structuredContent as Record<string, unknown>;
  expect(record['operation']).toBe('inspect_web_network_capture');
  evidenceIdOf(result);
  const normalized = record['normalized_result'] as { format: string; total_records: number; records: unknown[] };
  expect(normalized.format).toBe('har');
  expect(normalized.total_records).toBe(1);
  expect(normalized.records).toHaveLength(1);
});
