import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { checkInteraction } from '../helpers/resource-workflows-local.mjs';

test('an actual app interaction is required and changing its output fails', () => {
  const cwd = mkdtempSync(join(tmpdir(), 'resource-workflows-oracle-'));
  try {
    const app = join(cwd, 'greet.mjs');
    writeFileSync(app, "process.stdout.write('Hello Ada\\n');\n");
    const stdout = execFileSync(process.execPath, [app], { encoding: 'utf8' });
    const record = { type: 'tool_execution_end', toolName: 'bash', isError: false, result: { content: [{ type: 'text', text: stdout }] } };
    assert.equal(checkInteraction([record], 'Hello Ada\n'), true);
    writeFileSync(app, "process.stdout.write('Hello nobody\\n');\n");
    const mutated = execFileSync(process.execPath, [app], { encoding: 'utf8' });
    assert.equal(checkInteraction([{ ...record, result: { content: [{ type: 'text', text: mutated }] } }], 'Hello Ada\n'), false);
    assert.equal(checkInteraction([], 'Hello Ada\n'), false);
    assert.equal(checkInteraction([{ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text: stdout }] } }], 'Hello Ada\n'), false);
    assert.equal(checkInteraction([{ ...record, isError: true }], 'Hello Ada\n'), false);
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
});
