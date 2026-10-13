import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { coverage } from '../scripts/lib/envelope.mjs';
import { openStore } from '../scripts/lib/store.mjs';
import { buildView } from '../scripts/lib/views.mjs';

const graphRecord = (overrides = {}) => ({
  evidence_id: `ev_${'1'.repeat(64)}`,
  operation: 'analyze_javascript_application',
  predicate_type: 'rea.javascript-application-analysis',
  subject: { name: 'app', digest: { sha256: '2'.repeat(64) }, format: 'directory', architecture: null, local_path: '/tmp/app' },
  limitations: ['Static analysis only.'],
  locations: [{ kind: 'artifact-path', path: '/tmp/app' }],
  normalized_result: {
    summary: { ipc: { operations: 2 } },
    statistics: { relevant_files: 4 },
    graph: {
      coverage: coverage({ status: 'partial' }),
      nodes: [
        {
          node_id: `jag_node_${'a'.repeat(64)}`,
          kind: 'javascript-asset',
          observations: [
            {
              label: 'main.js',
              properties: { path: 'main.js' },
              evidence: {
                authority: 'artifact-bytes',
                state: 'observed',
                confidence: 'exact',
                artifact: { sha256: 'x' },
                location: { available: true },
                extractor: {},
                coverage: coverage({ status: 'complete' }),
                limitations: ['x'],
                evidence_ids: [],
              },
            },
          ],
        },
        { node_id: `jag_node_${'b'.repeat(64)}`, kind: 'ipc-handler', observations: [{ label: 'notes:search', properties: { side: 'main' }, evidence: {} }] },
        { node_id: `jag_node_${'c'.repeat(64)}`, kind: 'ipc-handler', observations: [{ label: 'notes:search', properties: { side: 'renderer' } }] },
        { node_id: `jag_node_${'d'.repeat(64)}`, kind: 'javascript-module', observations: [{ label: 'main.js', properties: { path: 'main.js' }, evidence: {} }] },
      ],
      edges: [{ source_node_id: `jag_node_${'a'.repeat(64)}`, target_node_id: `jag_node_${'b'.repeat(64)}`, relation: 'contains', properties: {} }],
    },
    ...overrides,
  },
});

test('VIEW-001: summary view reads the retained record', async (t) => {
  const dir = await mkdtemp(join(tmpdir(), 'rea-view-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const store = await openStore({ dir });
  const record = graphRecord();
  await store.retain(record);
  const retained = await store.get(record.evidence_id);
  const view = await buildView(retained, { kind: 'summary' });
  assert.equal(view.operation, 'inspect_analysis_view');
  assert.equal(view.predicate_type, 'rea.analysis-view');
  assert.equal(view.normalized_result.evidence_id, record.evidence_id);
  assert.deepEqual(view.normalized_result.summary.ipc, { operations: 2 });
  assert.equal(view.normalized_result.summary.operation, 'analyze_javascript_application');
  assert.equal(view.normalized_result.coverage.source_complete, false, 'a partial producer stays partial through a view');
  assert.equal(view.normalized_result.coverage.application.status, 'partial', 'the view restates the producer coverage it inherits');
  assert.equal(view.normalized_result.coverage.note.includes('producer'), true);
});

test('VIEW-002: node selection is unambiguous when paths repeat', async () => {
  const record = graphRecord();
  const first = await buildView(record, { kind: 'item', selector: `jag_node_${'a'.repeat(64)}` });
  assert.equal(first.normalized_result.item.nodes.length, 1);
  assert.equal(first.normalized_result.item.edges.length, 1, 'touching edges come with the node');
  const section = await buildView(record, { kind: 'section', selector: 'ipc-handler' });
  assert.equal(section.normalized_result.section.total, 2);
  await assert.rejects(
    () => buildView(record, { kind: 'item', selector: 'main.js' }),
    (error) => error.category === 'invalid_input' && error.details.issues[0].reason === 'ambiguous' && error.details.issues[0].candidates.length === 2,
  );
});

test('VIEW-003: page counters never imply completeness', async () => {
  const record = graphRecord();
  const page = await buildView(record, { kind: 'section', selector: 'ipc-handler', offset: 1, limit: 1 });
  const section = page.normalized_result.section;
  assert.equal(section.offset, 1);
  assert.equal(section.returned, 1);
  assert.equal(section.remaining, 0);
  assert.equal(section.total, 2);
  assert.equal(page.normalized_result.coverage.source_complete, false);
  const exhausted = await buildView(record, { kind: 'section', selector: 'ipc-handler', offset: 5, limit: 1 });
  assert.equal(exhausted.normalized_result.section.returned, 0);
  assert.equal(exhausted.normalized_result.section.remaining, 0);
  assert.equal(exhausted.normalized_result.coverage.source_complete, false, 'exhausting a page is not completeness');
});

test('VIEW-004: unknown view kinds and selectors are refused', async () => {
  const record = graphRecord();
  await assert.rejects(
    () => buildView(record, { kind: 'everything' }),
    (error) => error.code === 'invalid_request',
  );
  await assert.rejects(
    () => buildView(record, { kind: 'section' }),
    (error) => error.details.issues[0].path[0] === 'selector',
  );
  await assert.rejects(
    () => buildView(record, { kind: 'item', selector: 'nope' }),
    (error) => error.code === 'invalid_request',
  );
});
