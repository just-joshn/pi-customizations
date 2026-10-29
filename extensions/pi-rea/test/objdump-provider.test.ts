import { expect, test } from 'vitest';
import { inspectWithObjdumpFromPath } from '../src/analysis/objdump.ts';
import type { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectWithObjdump } from '../src/tools/objdump-tools.ts';
import { tempTargets } from './support/temp-targets.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const payloadOf = async (run: () => Promise<unknown>): Promise<ReaError['payload']> => {
  try {
    await run();
  } catch (error) {
    return (error as ReaError).payload;
  }
  throw new Error('the analyzer returned instead of throwing');
};

const script = async (body: string): Promise<string> => {
  const targets = await tempTargets('pi-rea-objdump-');
  return targets.write('fake-objdump', `#!/bin/sh\n${body}\n`, 0o755);
};

test('records stdout, a zero exit, and an unchanged digest', async () => {
  const targets = await tempTargets();
  const path = await targets.write('target.bin', 'binary bytes');
  const executable = await script('echo "file format elf64-x86-64"');
  const { record, resolvedPath } = await inspectWithObjdumpFromPath(path, { provider_executable: executable });

  expect(resolvedPath).toBe(path);
  expect(record.parameters).toMatchObject({
    path,
    operation: 'file_headers',
    follow_debug_links: false,
    provider_executable: executable,
    command_arguments: ['-f', path],
  });
  expect(record.command).toMatchObject({
    stdout: 'file format elf64-x86-64\n',
    stderr: '',
    exit_code: 0,
    signal: null,
    output_truncated: false,
    completion_status: 'complete',
    artifact_changed: false,
  });
  expect(record.command.artifact_sha256_after).toBe(record.subject.digest.sha256);
  expect(record.subject).toMatchObject({ name: 'target.bin', local_path: path, format: 'unknown', architecture: null });
  expect(record.limitations).toHaveLength(3);
});

test('preserves a non-zero exit with its captured output', async () => {
  const targets = await tempTargets();
  const path = await targets.write('empty.bin', '');
  const executable = await script('echo "partial output"; echo "objdump: no symbols" >&2; exit 3');
  const { record } = await inspectWithObjdumpFromPath(path, { provider_executable: executable, operation: 'disassemble' });

  expect(record.command).toMatchObject({
    stdout: 'partial output\n',
    stderr: 'objdump: no symbols\n',
    exit_code: 3,
    signal: null,
    completion_status: 'complete',
  });
  expect(record.parameters.command_arguments).toStrictEqual(['-d', path]);
});

test('adds the follow-links flag when debug link following is requested', async () => {
  const targets = await tempTargets();
  const path = await targets.write('link.bin', 'x');
  const executable = await script('exit 0');
  const { record } = await inspectWithObjdumpFromPath(path, { provider_executable: executable, follow_debug_links: true, operation: 'headers' });

  expect(record.parameters.command_arguments).toStrictEqual(['-h', '--dwarf=follow-links', path]);
  expect(record.parameters.follow_debug_links).toBe(true);
});

test.for([
  { operation: 'private_headers', flag: '-p' },
  { operation: 'section_contents', flag: '-s' },
])('maps the $operation operation to $flag', async ({ operation, flag }) => {
  const targets = await tempTargets();
  const path = await targets.write('sections.bin', 'x');
  const executable = await script('exit 0');
  const { record } = await inspectWithObjdumpFromPath(path, { provider_executable: executable, operation });

  expect(record.parameters.command_arguments).toStrictEqual([flag, path]);
});

test('rejects a provider executable that does not exist', async () => {
  const targets = await tempTargets();
  const path = await targets.write('missing-provider.bin', 'x');
  const payload = await payloadOf(() => inspectWithObjdumpFromPath(path, { provider_executable: '/nonexistent/objdump-4004' }));

  expect(payload).toMatchObject({
    code: 'invalid_request',
    message: 'Selected objdump executable could not be found: /nonexistent/objdump-4004',
    details: { operation: 'inspect_with_objdump', parameter: 'provider_executable' },
  });
});

test('rejects an unsupported operation before running anything', async () => {
  const targets = await tempTargets();
  const path = await targets.write('target.bin', 'x');
  const payload = await payloadOf(() => inspectWithObjdumpFromPath(path, { operation: 'hexdump' }));

  expect(payload.message).toBe('inspect_with_objdump operation "hexdump" is not supported.');
  expect(payload.details).toMatchObject({ parameter: 'operation' });
});

test('rejects an empty path', async () => {
  const payload = await payloadOf(() => inspectWithObjdumpFromPath(''));
  expect(payload).toMatchObject({ code: 'invalid_request', details: { parameter: 'path' } });
});

test('resolves a relative path against the supplied cwd', async () => {
  const targets = await tempTargets();
  await targets.write('relative.bin', 'x');
  const executable = await script('exit 0');
  const { resolvedPath, record } = await inspectWithObjdumpFromPath('relative.bin', { cwd: targets.dir, provider_executable: executable });

  expect(resolvedPath).toBe(`${targets.dir}/relative.bin`);
  expect(record.subject.name).toBe('relative.bin');
});

test('records Evidence through the inspect_with_objdump tool', async () => {
  const targets = await tempTargets();
  const path = await targets.write('tool-target.bin', 'x');
  const executable = await script('echo ok');
  const session = new ReaSession(runtime);
  const result = await inspectWithObjdump(session, { path, provider_executable: executable });

  const record = result.structuredContent as { operation: string; normalized_result: { stdout: string } };
  expect(record.operation).toBe('inspect_with_objdump');
  expect(record.normalized_result.stdout).toBe('ok\n');
  expect(session.evidence.size).toBe(1);
});
