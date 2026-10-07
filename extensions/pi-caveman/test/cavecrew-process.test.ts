import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { collect, piInvocation } from '../src/cavecrew.ts';

const line = (text: string, output: number) => JSON.stringify({ type: 'message_end', message: { role: 'assistant', content: [{ type: 'text', text }], usage: { output } } });

let cwd = '';
beforeEach(() => {
  cwd = mkdtempSync(join(tmpdir(), 'cavecrew-proc-'));
});
afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function node(script: string) {
  return { command: process.execPath, argv: ['-e', script], cwd };
}

describe('collect', () => {
  test('parses JSON lines split across chunks', async () => {
    const payload = `${line('Defs:\n- 文言.ts:1', 4)}\n`;
    const half = Math.floor(payload.length / 2);
    const script = `process.stdout.write(${JSON.stringify(payload.slice(0, half))}); setTimeout(() => process.stdout.write(${JSON.stringify(payload.slice(half))}), 20);`;
    const result = await collect({ ...node(script), signal: undefined });
    expect([result.exitCode, result.run.output, result.run.turns, result.run.usage.output]).toStrictEqual([0, 'Defs:\n- 文言.ts:1', 1, 4]);
  });

  test('keeps a trailing line without a newline', async () => {
    const result = await collect({ ...node(`process.stdout.write(${JSON.stringify(line('tail', 1))})`), signal: undefined });
    expect(result.run.output).toBe('tail');
  });

  test('captures stderr', async () => {
    const result = await collect({ ...node("process.stderr.write('boom'); process.exit(3)"), signal: undefined });
    expect(result.stderr).toBe('boom');
  });

  test('reports a nonzero exit code', async () => {
    const result = await collect({ ...node('process.exit(3)'), signal: undefined });
    expect(result.exitCode).toBe(3);
  });

  test('an abort kills a long-running child', async () => {
    const controller = new AbortController();
    const pending = collect({ ...node('setInterval(() => {}, 1000)'), signal: controller.signal });
    controller.abort();
    expect((await pending).exitCode).toBe(1);
  });

  test('a missing binary rejects', async () => {
    await expect(collect({ command: '/nonexistent/pi-binary', argv: [], cwd, signal: undefined })).rejects.toThrow('ENOENT');
  });
});

describe('piInvocation', () => {
  test('reuses the running script when it exists', () => {
    const script = process.argv[1] ?? '';
    expect(piInvocation(['--help'])).toStrictEqual({ command: process.execPath, args: [script, '--help'] });
  });
});
