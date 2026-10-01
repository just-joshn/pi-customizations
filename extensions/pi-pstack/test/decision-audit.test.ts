import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { packageRoot } from './session-fixture.ts';

const script = join(packageRoot, 'scripts/audit-decision-log.mjs');

test('trail audit distinguishes resolving pointers from unmatched evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-decision-audit-'));
  try {
    const trail = join(root, 'trail.tsv');
    const transcript = join(root, 'session.jsonl');
    const evidence = join(root, 'evidence.json');
    const missing = join(root, 'missing.json');
    const output = join(root, 'audit');
    await writeFile(evidence, '{}');
    await writeFile(trail, `${['ts', 'phase', 'decision', 'why', 'evidence', 'result'].join('\t')}\n2026-01-01T00:00:00Z\tcheck\tobserved\tverify\t${evidence}\topen\n2026-01-01T00:00:00Z\tcheck\tunresolved\tverify\t${missing}\topen\n`);
    await writeFile(
      transcript,
      `${JSON.stringify({ type: 'session', id: 'fixture-run', cwd: root })}\n${JSON.stringify({ type: 'message', id: 'fixture-tool', message: { role: 'assistant', content: [{ type: 'toolCall', name: 'bash', arguments: { command: `inspect ${evidence}` } }] } })}\n`,
    );
    expect(spawnSync(process.execPath, [script, trail, transcript, output], { cwd: root, encoding: 'utf8' }).status).toBe(0);
    const receipt = await readFile(join(output, 'results.json'), 'utf8');
    const result = JSON.parse(receipt);
    expect(result.verdict).toBe('PARTIAL MECHANISTIC AUDIT');
    expect(result.unresolved).toEqual([3]);
    expect(result.unmatched).toEqual([3]);
    expect(result.rows[0].mentions).toEqual([{ entry: 'fixture-tool', tool: 'bash' }]);
    expect(spawnSync(process.execPath, [script, trail, transcript, output], { cwd: root, encoding: 'utf8' }).status).toBe(1);
    expect(await readFile(join(output, 'results.json'), 'utf8')).toBe(receipt);
    await writeFile(transcript, `${JSON.stringify({ type: 'session', id: 'other', cwd: join(root, 'other') })}\n`);
    const wrong = spawnSync(process.execPath, [script, trail, transcript, join(root, 'wrong')], { cwd: root, encoding: 'utf8' });
    expect(wrong.status).toBe(1);
    expect(wrong.stderr).toContain('Transcript does not belong to the current workspace');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
