import { homedir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { ReaError } from '../src/contract/errors.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { listCutterSessions } from '../src/tools/cutter-tools.ts';
import { PROVIDER_REFUSE_TOOL_NAMES, refuseProviderTool } from '../src/tools/provider-refuse-tools.ts';
import { openBinary } from '../src/tools/session-tools.ts';
import { fixturePath } from './support/fixtures.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const catchPayload = (fn: () => unknown): ReaError['payload'] => {
  let thrown: unknown;
  try {
    fn();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(ReaError);
  return (thrown as ReaError).payload;
};

test('provider refuse table covers the landed fail-closed families', () => {
  expect(PROVIDER_REFUSE_TOOL_NAMES.length).toBe(166);
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('read_bytes');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('list_frida_devices');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('list_adb_devices');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('list_browser_targets');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('list_jeb_units');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('execute_rizin_command');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('start_gdb_session');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('recover_javascript_sources');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('compare_functions');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('inspect_wasm_artifact');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('inspect_pcap_client');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('decode_signal_recording');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('inspect_evm_interface');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('observe_native_calls');
  expect(PROVIDER_REFUSE_TOOL_NAMES).not.toContain('inspect_native_exports');
  expect(PROVIDER_REFUSE_TOOL_NAMES).not.toContain('inspect_with_objdump');
  expect(PROVIDER_REFUSE_TOOL_NAMES).toContain('capture_process_scenario');
});

test('official_proxy: closed session is target_unavailable; open is provider_unavailable', async () => {
  const closed = catchPayload(() => refuseProviderTool(new ReaSession(runtime), 'read_bytes'));
  expect(closed.code).toBe('target_unavailable');
  expect(closed.message).toContain('No app is open');

  const session = new ReaSession(runtime);
  await openBinary(session, { path: fixturePath('targets/minimal-elf.bin') });
  const open = catchPayload(() => refuseProviderTool(session, 'analyze_function'));
  expect(open.code).toBe('provider_unavailable');
  expect(open.category).toBe('unavailable');
  expect(open.retryable).toBe(true);
  expect(open.details).toMatchObject({
    operation: 'analyze_function',
    selection_reason: 'provider_unavailable',
    requested_provider_id: 'auto',
    candidate_ids: ['ghidra', 'hopper', 'ida', 'kuna'],
  });
  expect(open.details).not.toHaveProperty('port');
  const rejections = (open.details as { rejections: Array<Record<string, unknown>> }).rejections;
  expect(rejections).toHaveLength(4);
  expect(rejections[0]).toMatchObject({
    provider_id: 'ghidra',
    code: 'not_configured',
    reason: 'Set GHIDRA_INSTALL_DIR to an extracted Ghidra 12.1.x release directory.',
  });
  expect(rejections[0]?.diagnostics).toMatchObject({
    install_dir: null,
    platform: process.platform,
    architecture: process.arch,
  });
  expect(rejections[1]).toMatchObject({ provider_id: 'hopper' });
  expect(rejections[1]?.diagnostics).toMatchObject({ platform: process.platform });
  expect(['executable_missing', 'not_configured']).toContain(rejections[1]?.code);
  expect(rejections[2]).toMatchObject({
    provider_id: 'ida',
    code: 'not_configured',
    diagnostics: { configured: false, live_connection_probed: false },
  });
  expect(rejections[3]).toMatchObject({
    provider_id: 'kuna',
    code: 'not_configured',
    diagnostics: { configured: false, version_probed: false },
  });
});

test('adb family: capability_unavailable matches missing-adb envelope', () => {
  const payload = catchPayload(() => refuseProviderTool(new ReaSession(runtime), 'list_adb_devices'));
  expect(payload.code).toBe('capability_unavailable');
  expect(payload.category).toBe('unsupported_provider');
  expect(payload.message).toContain('REA_ADB_PATH');
  expect(payload.details).toMatchObject({
    provider_id: 'adb',
    operation: 'list_adb_devices',
    diagnostics: { selected_binary: 'adb', path_source: 'path' },
  });
});

test('frida/jeb/rizin/gdb/cutter/wakaru/apktool/binwalk/jadx capability envelopes', () => {
  const cases = [
    {
      name: 'list_frida_devices',
      provider_id: 'frida',
      reason: 'Cannot load native addon because loading addons is disabled.',
      message: 'This analysis is unavailable for the current target. Choose another analysis or target.',
    },
    { name: 'list_jeb_units', provider_id: 'jeb', reason: 'fetch failed' },
    { name: 'execute_rizin_command', provider_id: 'rizin' },
    { name: 'start_gdb_session', provider_id: 'gdb' },
    { name: 'cutter_command', provider_id: 'cutter' },
    { name: 'recover_javascript_sources', provider_id: 'wakaru' },
    { name: 'inspect_apktool_client', provider_id: 'apktool' },
    { name: 'inspect_firmware_regions', provider_id: 'binwalk' },
    { name: 'inspect_android_class', provider_id: 'jadx' },
  ] as const;
  for (const item of cases) {
    const payload = catchPayload(() => refuseProviderTool(new ReaSession(runtime), item.name));
    expect(payload.code, item.name).toBe('capability_unavailable');
    expect(payload.details, item.name).toMatchObject({
      provider_id: item.provider_id,
      operation: item.name,
      ...('reason' in item ? { reason: item.reason } : {}),
    });
    if ('message' in item) expect(payload.message, item.name).toBe(item.message);
  }
  const start = catchPayload(() => refuseProviderTool(new ReaSession(runtime), 'start_frida_session', { mode: 'attach', pid: 999_999_999 }));
  expect(start.details).toMatchObject({
    provider_id: 'frida',
    operation: 'start_frida_session',
    reason: 'Unable to find process with pid 999999999',
  });
});

test('cdp/electron page family: provider_unavailable endpoint_unreachable', () => {
  for (const name of ['list_browser_targets', 'inspect_web_page', 'list_electron_targets', 'analyze_web_bundle']) {
    const payload = catchPayload(() => refuseProviderTool(new ReaSession(runtime), name));
    expect(payload.code, name).toBe('provider_unavailable');
    expect(payload.category, name).toBe('unavailable');
    expect(payload.retryable, name).toBe(true);
    expect(payload.message, name).toContain('loopback debugging endpoint');
    expect(payload.details, name).toMatchObject({ operation: name, reason: 'endpoint_unreachable' });
  }
});

test('compare_functions: wrong Evidence operation is invalid_request before the gap refuse', () => {
  const payload = catchPayload(() =>
    refuseProviderTool(new ReaSession(runtime), 'compare_functions', {
      left: { operation: 'inspect_go_binary', predicate_type: 'rea.analysis' },
      right: { operation: 'inspect_go_binary', predicate_type: 'rea.analysis' },
    }),
  );
  expect(payload.code).toBe('invalid_request');
  expect(payload.retryable).toBe(false);
  expect(payload.recovery).toStrictEqual({ kind: 'inspect_input_contract', operation: 'compare_functions' });
  expect(payload.details).toMatchObject({ operation: 'compare_functions' });
});

test('compare fail-closed family refuses without inventing diffs when Evidence shape is absent', () => {
  const payload = catchPayload(() => refuseProviderTool(new ReaSession(runtime), 'compare_functions'));
  expect(payload.code).toBe('capability_unavailable');
  expect(payload.details).toMatchObject({ provider_id: 'compare', operation: 'compare_functions', reason: 'not_implemented' });
});

test('wabt/tshark/pcap/sigrok/evm capability envelopes match REA missing-provider probes', () => {
  const cases = [
    { name: 'inspect_wasm_artifact', provider_id: 'wabt-artifact', needle: 'REA_WABT_BIN_DIRECTORY' },
    { name: 'inspect_packet_capture', provider_id: 'tshark-capture', needle: 'TShark' },
    { name: 'inspect_packet_fields', provider_id: 'tshark-capture', needle: 'prlimit' },
    { name: 'inspect_pcap_capture', provider_id: 'pcap', needle: 'tshark was not found' },
    { name: 'inspect_pcap_client', provider_id: 'pcap', needle: 'REA_CAPINFOS_COMMAND' },
    { name: 'decode_signal_recording', provider_id: 'sigrok-recording', needle: 'REA_SIGROK_COMMAND' },
    { name: 'inspect_signal_decoders', provider_id: 'sigrok-recording', needle: 'sigrok-cli' },
    { name: 'inspect_evm_interface', provider_id: 'evmole-interface', needle: 'Linux x64' },
  ] as const;
  for (const item of cases) {
    const payload = catchPayload(() => refuseProviderTool(new ReaSession(runtime), item.name));
    expect(payload.code, item.name).toBe('capability_unavailable');
    expect(payload.message, item.name).toContain(item.needle);
    expect(payload.details, item.name).toMatchObject({
      provider_id: item.provider_id,
      operation: item.name,
    });
  }
});

test('native observe family: closed is target_unavailable; open is capability_unavailable', async () => {
  const closed = catchPayload(() => refuseProviderTool(new ReaSession(runtime), 'observe_native_calls'));
  expect(closed.code).toBe('target_unavailable');
  expect(closed.message).toContain('No app is open');

  const session = new ReaSession(runtime);
  await openBinary(session, { path: fixturePath('targets/minimal-elf.bin') });
  const open = catchPayload(() => refuseProviderTool(session, 'trace_dylib_resolution'));
  expect(open.code).toBe('capability_unavailable');
  expect(open.details).toMatchObject({
    provider_id: 'native-macos',
    operation: 'trace_dylib_resolution',
  });
});

test('engine-free gap family refuses without inventing findings', () => {
  for (const name of ['capture_process_scenario', 'verify_reconstruction', 'project_android_application_graph']) {
    const payload = catchPayload(() => refuseProviderTool(new ReaSession(runtime), name));
    expect(payload.code, name).toBe('capability_unavailable');
    expect(payload.details, name).toMatchObject({
      provider_id: 'engine-free',
      operation: name,
      reason: 'not_implemented',
    });
  }
});

test('list_cutter_sessions: empty bridge inventory is configuration not refuse', () => {
  const result = listCutterSessions(new ReaSession(runtime), {});
  const body = result.structuredContent as Record<string, unknown>;
  expect(body).toStrictEqual({
    sessions: [],
    bridge_directory: join(homedir(), '.cache', 'rea', 'cutter-bridge'),
    discovery_status: 'no_live_bridge_found',
    bridge_directory_security: 'not_checked',
  });
});
