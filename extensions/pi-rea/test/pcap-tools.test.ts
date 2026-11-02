import { chmodSync, mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { afterEach, expect, onTestFinished, test, vi } from 'vitest';
import { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { inspectPcapCapture, inspectPcapClient } from '../src/tools/pcap-tools.ts';

const runtime = { name: 'pi-rea-test', version: '0.0.0', cwd: tmpdir() };

const session = () => new ReaSession(runtime);

const payloadOf = async (run: () => Promise<unknown>): Promise<Record<string, unknown>> => {
  let thrown: unknown;
  try {
    await run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown, 'expected the handler to throw a ReaError').toBeInstanceOf(ReaError);
  return (thrown as ReaError).payload as unknown as Record<string, unknown>;
};

const writeFakeTool = (directory: string, name: string, banner: string): string => {
  const path = join(directory, name);
  writeFileSync(path, `#!/bin/sh\necho '${banner}'\n`);
  chmodSync(path, 0o755);
  return path;
};

const stubEnvs = (values: Record<string, string>) => {
  for (const [key, value] of Object.entries(values)) vi.stubEnv(key, value);
};

afterEach(() => {
  vi.unstubAllEnvs();
});

const withDarwinPlatform = (): void => {
  const original = process.platform;
  Object.defineProperty(process, 'platform', { value: 'darwin' });
  onTestFinished(() => {
    Object.defineProperty(process, 'platform', { value: original });
  });
};

test('inspect_pcap_client probes env-selected tools and reports verified identities', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-rea-pcap-'));
  const tshark = writeFakeTool(directory, 'tshark', 'tshark (Wireshark) 4.2.0 (v4.2.0)');
  const capinfos = writeFakeTool(directory, 'capinfos', 'Capinfos (Wireshark) 4.6.9');
  stubEnvs({ REA_TSHARK_COMMAND: tshark, REA_CAPINFOS_COMMAND: capinfos });

  const target = session();
  const result = await inspectPcapClient(target);
  const evidence = (result.details as { evidence: Record<string, unknown> })['evidence'];
  const client = (evidence['normalized_result'] as { client: Record<string, unknown> })['client'];
  const tsharkBytes = await readFile(tshark);

  expect(evidence['operation']).toBe('inspect_pcap_client');
  expect(evidence['predicate_type']).toBe('rea.analysis');
  expect(client['tshark_command']).toBe(tshark);
  expect(client['tshark_source']).toBe('environment');
  expect(client['tshark_version']).toBe('tshark (Wireshark) 4.2.0 (v4.2.0)');
  expect(client['tshark_resolved_path']).toBe(realpathSync(tshark));
  expect(client['tshark_sha256']).toBe(createHash('sha256').update(tsharkBytes).digest('hex'));
  expect(client['tshark_identity_status']).toBe('verified');
  expect(client['capinfos_source']).toBe('environment');
  expect(client['capinfos_version']).toBe('Capinfos (Wireshark) 4.6.9');
  expect(target.evidence.get(String(evidence['evidence_id']))).toBeDefined();
});

test('inspect_pcap_client refuses when PATH holds no tshark', async () => {
  const empty = mkdtempSync(join(tmpdir(), 'pi-rea-pcap-empty-'));
  stubEnvs({ REA_TSHARK_COMMAND: '', REA_CAPINFOS_COMMAND: '', PATH: empty });

  const payload = await payloadOf(() => inspectPcapClient(session()));

  expect(payload['code']).toBe('capability_unavailable');
  expect(payload['category']).toBe('unsupported_provider');
  expect(payload['retryable']).toBe(false);
  expect(String(payload['message'])).toContain('tshark was not found in an absolute PATH entry');
  expect(String(payload['message'])).toContain('REA_CAPINFOS_COMMAND');
  expect(payload['details']).toMatchObject({ provider_id: 'pcap', operation: 'inspect_pcap_client', reason: 'tshark was not found in an absolute PATH entry; add it to PATH or set REA_TSHARK_COMMAND to its absolute path' });
});

test('inspect_pcap_client refuses a relative REA_TSHARK_COMMAND before consulting PATH', async () => {
  stubEnvs({ REA_TSHARK_COMMAND: 'relative/tshark' });

  const payload = await payloadOf(() => inspectPcapClient(session()));

  expect(String(payload['message'])).toContain('REA_TSHARK_COMMAND must be an absolute path to the tshark binary.');
  expect(payload['details']).toMatchObject({ provider_id: 'pcap', reason: 'REA_TSHARK_COMMAND must be an absolute path to the tshark binary' });
});

const bannerCases = [
  { name: 'an unparseable banner', banner: 'hello world', needle: 'The selected tshark command did not report a version.' },
  { name: 'an unsupported major version', banner: 'tshark (Wireshark) 5.0.0', needle: 'Packet capture inspection currently requires Wireshark 4.x tools' },
];

test.for(bannerCases)('inspect_pcap_client refuses $name', async (caseItem) => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-rea-pcap-'));
    const tshark = writeFakeTool(directory, 'tshark', caseItem.banner);
    const capinfos = writeFakeTool(directory, 'capinfos', 'Capinfos (Wireshark) 4.6.9');
    stubEnvs({ REA_TSHARK_COMMAND: tshark, REA_CAPINFOS_COMMAND: capinfos });

    const payload = await payloadOf(() => inspectPcapClient(session()));

    expect(String(payload['message'])).toContain(caseItem.needle);
    expect(payload['details']).toMatchObject({ provider_id: 'pcap', operation: 'inspect_pcap_client' });
  },
);

test('inspect_pcap_capture refuses the unsupported capture host before reading any file', async () => {
  withDarwinPlatform();
  const directory = mkdtempSync(join(tmpdir(), 'pi-rea-pcap-'));
  stubEnvs({
    REA_TSHARK_COMMAND: writeFakeTool(directory, 'tshark', 'tshark (Wireshark) 4.2.0'),
    REA_CAPINFOS_COMMAND: writeFakeTool(directory, 'capinfos', 'Capinfos (Wireshark) 4.2.0'),
  });

  const payload = await payloadOf(() => inspectPcapCapture(session(), { path: '/nonexistent/capture.pcap' }));
  const message = "Packet summaries require an enforceable native memory bound: Linux with util-linux prlimit, or Windows with owned Job Objects. This host's capture boundary remains unsupported.";

  expect(payload).toStrictEqual({
    code: 'capability_unavailable',
    category: 'unsupported_provider',
    message,
    retryable: false,
    remediation: { action: message },
    details: { provider_id: 'pcap', operation: 'inspect_pcap_capture', reason: message },
  });
});

test('inspect_pcap_capture still refuses the host when the capture file is missing', async () => {
  withDarwinPlatform();
  const directory = mkdtempSync(join(tmpdir(), 'pi-rea-pcap-'));
  stubEnvs({ PATH: directory });
  writeFakeTool(directory, 'tshark', 'tshark (Wireshark) 4.2.0');
  writeFakeTool(directory, 'capinfos', 'Capinfos (Wireshark) 4.2.0');

  const payload = await payloadOf(() => inspectPcapCapture(session(), { path: '/nonexistent/capture.pcapng' }));

  expect(String(payload['message'])).toContain('enforceable native memory bound');
});
