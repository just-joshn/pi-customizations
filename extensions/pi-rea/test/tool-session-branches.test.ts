import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { ReaError } from '../src/contract/errors.ts';
import { DEFAULT_RESPONSE_BUDGET_BYTES } from '../src/contract/results.ts';
import { ANALYSIS_SETTING_IDS, type AnalysisSettingId, AnalysisSettingsStore, runtimeConstraints, type SettingChange } from '../src/session/analysis-settings.ts';
import { ReaSession } from '../src/session/binary-session.ts';
import { canonicalJson, createEvidence, type EvidenceDraft, type EvidenceRecord, evidenceIdentity, evidenceSummaryEntry, isEvidenceRecord, sha256Hex, verifyEvidenceIdentity } from '../src/session/evidence.ts';
import { isUnknownRecord, type UnknownDraft, UnknownLedger, type UnknownRecord, unknownIdentity, unknownRevisionDigest, validateUnknownDraft } from '../src/session/unknown-ledger.ts';
import { type ArtifactIdentity, identifyArtifact } from '../src/targets/artifact-identity.ts';
import { inspectBinaryLayout } from '../src/tools/binary-layout-tools.ts';
import { inspectGoBinary } from '../src/tools/go-binary-tools.ts';
import { inspectWebNetworkCapture } from '../src/tools/har-tools.ts';
import { inspectMacho } from '../src/tools/macho-tools.ts';
import { inspectPlist } from '../src/tools/plist-tools.ts';
import { isProviderRefuseTool, PROVIDER_REFUSE_BY_NAME, PROVIDER_REFUSE_TOOL_NAMES, providerRefuseAvailability, type RefuseStrategy, refuseProviderTool } from '../src/tools/provider-refuse-tools.ts';
import { openBinary } from '../src/tools/session-tools.ts';
import { fixturePath } from './support/fixtures.ts';
import { tempTargets } from './support/temp-targets.ts';

const runtime = { name: 'pi-rea', version: '0.1.0', cwd: '/tmp' };

const session = (): ReaSession => new ReaSession(runtime);

const catchPayload = (call: () => unknown): ReaError['payload'] => {
  try {
    call();
  } catch (error) {
    expect(error).toBeInstanceOf(ReaError);
    return (error as ReaError).payload;
  }
  throw new Error('the call returned instead of throwing');
};

const catchRejection = async (call: () => Promise<unknown>): Promise<ReaError['payload']> => {
  try {
    await call();
  } catch (error) {
    expect(error).toBeInstanceOf(ReaError);
    return (error as ReaError).payload;
  }
  throw new Error('the call resolved instead of rejecting');
};

const recordOf = (result: AgentToolResult<unknown>): EvidenceRecord => result.structuredContent as unknown as EvidenceRecord;

const evidenceId = `ev_${'a'.repeat(64)}`;

const at = <T>(value: T | undefined): T => {
  if (value === undefined) throw new Error('expected a retained value');
  return value;
};

const draft = (overrides: Partial<UnknownDraft> = {}): UnknownDraft => ({
  question: 'Does the fixture embed build settings?',
  severity: 'medium',
  domain: 'fixture',
  required_authority: 'shipped-artifact',
  required_confidence: 'observed',
  required_environment: { id: null, platform: null, architecture: null, isolation: null },
  recommended_probes: [{ operation: 'inspect_macho', rationale: 'Read the shipped artifact.' }],
  relationships: [],
  supporting_evidence_ids: [],
  contradicting_evidence_ids: [],
  ...overrides,
});

const ledgerRecord = (): UnknownRecord => new UnknownLedger().record(draft(), evidenceId);

afterEach(() => {
  vi.unstubAllEnvs();
});

const NO_APP_OPEN = 'No app is open. Ask the user which app to investigate, then call open_binary with its local path.';
const OPEN_BINARY_REMEDIATION = 'Call open_binary with a supported local target.';
const OFFICIAL_PROXY_MESSAGE = 'The selected analysis provider is unavailable. Review the reported local diagnostics or run `rea doctor`, then retry.';
const NATIVE_MACOS_MESSAGE = 'pi-rea has no LLDB/native-macos observe bridge. Configure debugging for the upstream REA host, or track the gap in parity/pi-rea/.';
const NATIVE_MACOS_UNAVAILABLE_MESSAGE = 'This analysis is unavailable for the current target. Choose another analysis or target.';
const NATIVE_MACOS_NON_MACHO_REASON = 'Native call observation launches a Mach-O executable; the active target is not one';
const FRIDA_ADDON_DISABLED_REASON = 'Cannot load native addon because loading addons is disabled.';
const RIZIN_REMEDIATION = 'Set REA_RIZIN_COMMAND to an installed executable Rizin command, or make that command available on PATH. Check execute permission on the command and search permission on its parent directories before retrying.';
const WABT_REMEDIATION =
  'Set absolute REA_WABT_BIN_DIRECTORY to a directory that contains wasm-validate, wasm-objdump and wasm2wat from WABT 1.0.42; each --version must report 1.0.42 on stdout with empty stderr. Correct the reported tool path, access or release before retrying, not the WASM input. Set this in the shell for the next CLI call, or in the MCP server launch environment and restart that server; a shell export does not update a running MCP server. Do not repeat the unchanged call or install tools implicitly.';
const PWNTTOOLS_LINUX_X64_ONLY = 'The initial real-verified pwntools artifact profile supports Linux x64 only.';

type CapabilityStrategy = Extract<RefuseStrategy, { kind: 'capability' }>;

const capabilityRemediation = (strategy: CapabilityStrategy): string => (strategy.providerId === 'rizin' ? RIZIN_REMEDIATION : strategy.providerId === 'wabt-artifact' ? WABT_REMEDIATION : strategy.message);

const cdpMessage = (name: string): string => `${name} could not reach the selected loopback debugging endpoint. Verify that the target process is running with debugging enabled and that the endpoint's port matches it, then retry.`;

describe('provider refuse tools', () => {
  test('refuses every capability tool with its provider id', () => {
    let checked = 0;
    for (const [name, strategy] of PROVIDER_REFUSE_BY_NAME) {
      if (strategy.kind !== 'capability') continue;
      checked += 1;
      expect(
        catchPayload(() => refuseProviderTool(session(), name)),
        name,
      ).toStrictEqual({
        code: 'capability_unavailable',
        category: 'unsupported_provider',
        message: strategy.message,
        retryable: false,
        remediation: { action: capabilityRemediation(strategy) },
        details: {
          provider_id: strategy.providerId,
          operation: name,
          reason: strategy.reason,
          ...(strategy.diagnostics === undefined ? {} : { diagnostics: strategy.diagnostics }),
        },
      });
    }
    expect(checked).toBe(87);
  });

  test('refuses every CDP tool with an unreachable endpoint', () => {
    let checked = 0;
    for (const [name, strategy] of PROVIDER_REFUSE_BY_NAME) {
      if (strategy.kind !== 'cdp_endpoint') continue;
      checked += 1;
      expect(
        catchPayload(() => refuseProviderTool(session(), name)),
        name,
      ).toStrictEqual({
        code: 'provider_unavailable',
        category: 'unavailable',
        message: cdpMessage(name),
        retryable: true,
        remediation: { action: cdpMessage(name) },
        details: { operation: name, reason: 'endpoint_unreachable' },
      });
    }
    expect(checked).toBe(17);
  });

  test('refuses every official-proxy tool without an open target', () => {
    let checked = 0;
    for (const [name, strategy] of PROVIDER_REFUSE_BY_NAME) {
      if (strategy.kind !== 'official_proxy') continue;
      checked += 1;
      expect(
        catchPayload(() => refuseProviderTool(session(), name)),
        name,
      ).toStrictEqual({
        code: 'target_unavailable',
        category: 'unavailable',
        message: NO_APP_OPEN,
        retryable: false,
        remediation: { action: NO_APP_OPEN },
      });
    }
    expect(checked).toBe(58);
  });

  test('refuses every official-proxy tool when the provider is absent', async () => {
    vi.stubEnv('GHIDRA_INSTALL_DIR', undefined);
    vi.stubEnv('HOPPER_LAUNCHER_PATH', '/nonexistent/hopper-4004');
    vi.stubEnv('REA_IDA_MCP_CONFIG', undefined);
    vi.stubEnv('REA_KUNA_COMMAND', undefined);
    vi.stubEnv('JAVA_HOME', undefined);
    vi.stubEnv('PATH', '');
    const open = session();
    await openBinary(open, { path: fixturePath('targets/minimal-elf.bin') });

    const ghidraJavaDetail = 'java; application.properties is unavailable';
    const rejections = [
      {
        provider_id: 'ghidra',
        code: 'not_configured',
        reason: 'Set GHIDRA_INSTALL_DIR to an extracted Ghidra 12.1.x release directory.',
        diagnostics: {
          install_dir: null,
          analyze_headless_path: null,
          native_decompiler_path: null,
          application_properties_path: null,
          provider_version: null,
          java_command: 'java',
          java_home: null,
          java_version: null,
          java_vm_name: null,
          java_os_arch: null,
          java_os_name: null,
          platform: process.platform,
          architecture: process.arch,
          checks: [
            { name: 'configuration', ok: false, code: 'not_configured', detail: 'GHIDRA_INSTALL_DIR is not set' },
            { name: 'platform', ok: true, code: null, detail: process.platform },
            { name: 'architecture', ok: true, code: null, detail: process.arch },
            { name: 'installation', ok: false, code: 'executable_missing', detail: 'Ghidra application properties unavailable' },
            { name: 'version', ok: false, code: 'version_unresolved', detail: 'unknown' },
            { name: 'headless', ok: false, code: 'executable_missing', detail: 'analyzeHeadless unavailable' },
            {
              name: 'native_decompiler',
              ok: false,
              code: 'executable_missing',
              detail: `Matching native decompiler for ${process.platform}/${process.arch} was not found`,
            },
            { name: 'java', ok: false, code: 'version_unresolved', detail: ghidraJavaDetail },
          ],
        },
      },
      {
        provider_id: 'hopper',
        code: 'executable_missing',
        reason: 'Hopper launcher is missing or not executable: /nonexistent/hopper-4004',
        diagnostics: { launcher_path: '/nonexistent/hopper-4004', platform: process.platform },
      },
      {
        provider_id: 'ida',
        code: 'not_configured',
        reason: 'REA configuration is invalid: Set REA_IDA_MCP_CONFIG to an upstream IDA MCP JSON registration; see docs/ida-provider.md.',
        diagnostics: {
          configured: false,
          registration_path: null,
          live_connection_probed: false,
          configuration_details: {
            settings: [
              {
                setting: 'REA_IDA_MCP_CONFIG',
                constraint: 'Set REA_IDA_MCP_CONFIG to an upstream IDA MCP JSON registration; see docs/ida-provider.md.',
              },
            ],
          },
          configuration_remediation: "Correct REA_IDA_MCP_CONFIG in the environment that starts REA (your shell or the MCP client's registration), then rerun.",
        },
      },
      {
        provider_id: 'kuna',
        code: 'not_configured',
        reason: 'Set REA_KUNA_COMMAND to the absolute path of a caller-supplied kuna executable (verified with 1.833). REA does not download, install or update Kuna.',
        diagnostics: { configured: false, version_probed: false },
      },
    ];

    let checked = 0;
    for (const [name, strategy] of PROVIDER_REFUSE_BY_NAME) {
      if (strategy.kind !== 'official_proxy') continue;
      checked += 1;
      expect(
        catchPayload(() => refuseProviderTool(open, name)),
        name,
      ).toStrictEqual({
        code: 'provider_unavailable',
        category: 'unavailable',
        message: OFFICIAL_PROXY_MESSAGE,
        retryable: true,
        remediation: { action: OFFICIAL_PROXY_MESSAGE },
        details: {
          operation: name,
          selection_reason: 'provider_unavailable',
          requested_provider_id: 'auto',
          candidate_ids: ['ghidra', 'hopper', 'ida', 'kuna'],
          rejections,
        },
      });
    }
    expect(checked).toBe(58);
  });

  test('reports a configured provider registration in the rejection list', async () => {
    vi.stubEnv('GHIDRA_INSTALL_DIR', '/opt/ghidra');
    vi.stubEnv('REA_IDA_MCP_CONFIG', '/tmp/ida.json');
    vi.stubEnv('REA_KUNA_COMMAND', '/usr/local/bin/kuna');
    const targets = await tempTargets();
    const launcher = await targets.write('hopper', '#!/bin/sh\nexit 0\n', 0o755);
    vi.stubEnv('HOPPER_LAUNCHER_PATH', launcher);
    const open = session();
    await openBinary(open, { path: fixturePath('targets/minimal-elf.bin') });

    const payload = catchPayload(() => refuseProviderTool(open, 'list_procedures'));
    const rejections = (payload.details as { rejections: Record<string, unknown>[] }).rejections;
    expect(rejections).toStrictEqual([
      {
        provider_id: 'ghidra',
        code: 'not_configured',
        reason: 'pi-rea has no Ghidra provider bridge; parity/pi-rea/ records the gap.',
        diagnostics: { install_dir: '/opt/ghidra' },
      },
      {
        provider_id: 'hopper',
        code: 'not_configured',
        reason: 'pi-rea has no Hopper provider bridge; parity/pi-rea/ records the gap.',
        diagnostics: { launcher_path: launcher, platform: process.platform },
      },
      {
        provider_id: 'ida',
        code: 'not_configured',
        reason: 'pi-rea has no IDA provider bridge; parity/pi-rea/ records the gap.',
        diagnostics: { configured: true, registration_path: '/tmp/ida.json', live_connection_probed: false },
      },
      {
        provider_id: 'kuna',
        code: 'not_configured',
        reason: 'pi-rea has no Kuna provider bridge; parity/pi-rea/ records the gap.',
        diagnostics: { configured: true, version_probed: false },
      },
    ]);
  });

  test('reports Ghidra java diagnostics from the launch environment', async () => {
    vi.stubEnv('GHIDRA_INSTALL_DIR', '');
    vi.stubEnv('HOPPER_LAUNCHER_PATH', '/nonexistent/hopper-4004');
    vi.stubEnv('JAVA_HOME', '/jdk');
    vi.stubEnv('PATH', '');
    const open = session();
    await openBinary(open, { path: fixturePath('targets/minimal-elf.bin') });

    const withHome = catchPayload(() => refuseProviderTool(open, 'read_bytes'));
    const homeRejections = (withHome.details as { rejections: Record<string, unknown>[] }).rejections;
    expect(homeRejections[0]).toMatchObject({
      provider_id: 'ghidra',
      diagnostics: { install_dir: null, java_command: '/jdk/bin/java', java_home: '/jdk' },
    });
    const homeChecks = (at(homeRejections[0])['diagnostics'] as { checks: { name: string; ok: boolean }[] }).checks;
    expect(homeChecks.map((check) => check.name)).toStrictEqual(['configuration', 'platform', 'architecture', 'installation', 'version', 'headless', 'native_decompiler', 'java']);
    expect(homeChecks[0]).toStrictEqual({ name: 'configuration', ok: false, code: 'not_configured', detail: 'GHIDRA_INSTALL_DIR is not set' });

    const targets = await tempTargets();
    await targets.write('java', '#!/bin/sh\nexit 0\n', 0o755);
    vi.stubEnv('JAVA_HOME', '');
    vi.stubEnv('PATH', targets.dir);
    const foundOnPath = catchPayload(() => refuseProviderTool(open, 'read_bytes'));
    const pathRejections = (foundOnPath.details as { rejections: Record<string, unknown>[] }).rejections;
    expect(pathRejections[0]).toMatchObject({
      provider_id: 'ghidra',
      diagnostics: { java_command: 'java', java_home: null },
    });
  });

  test('reports a missing Hopper launcher by path', async () => {
    vi.stubEnv('HOPPER_LAUNCHER_PATH', '/nonexistent/hopper-only');
    const open = session();
    await openBinary(open, { path: fixturePath('targets/minimal-elf.bin') });
    const payload = catchPayload(() => refuseProviderTool(open, 'list_documents'));
    const rejections = (payload.details as { rejections: Record<string, unknown>[] }).rejections;
    expect(rejections[1]).toStrictEqual({
      provider_id: 'hopper',
      code: 'executable_missing',
      reason: 'Hopper launcher is missing or not executable: /nonexistent/hopper-only',
      diagnostics: { launcher_path: '/nonexistent/hopper-only', platform: process.platform },
    });
  });

  test('selects a Hopper launcher from the user Applications folder', async () => {
    vi.stubEnv('HOPPER_LAUNCHER_PATH', undefined);
    const targets = await tempTargets();
    const launcher = join(targets.dir, 'Applications', 'Hopper Disassembler.app', 'Contents', 'MacOS', 'hopper');
    mkdirSync(dirname(launcher), { recursive: true });
    writeFileSync(launcher, '#!/bin/sh\nexit 0\n', { mode: 0o755 });
    vi.stubEnv('HOME', targets.dir);
    const open = session();
    await openBinary(open, { path: fixturePath('targets/minimal-elf.bin') });
    const payload = catchPayload(() => refuseProviderTool(open, 'list_bookmarks'));
    const hopper = (payload.details as { rejections: Record<string, unknown>[] }).rejections[1];
    if (process.platform !== 'darwin') {
      expect(hopper).toMatchObject({ provider_id: 'hopper', code: 'executable_missing', diagnostics: { platform: process.platform } });
      return;
    }
    expect(hopper).toMatchObject({
      provider_id: 'hopper',
      code: 'not_configured',
      reason: 'pi-rea has no Hopper provider bridge; parity/pi-rea/ records the gap.',
      diagnostics: { platform: 'darwin' },
    });
    expect([launcher, '/Applications/Hopper Disassembler.app/Contents/MacOS/hopper']).toContain((at(hopper)['diagnostics'] as { launcher_path: string }).launcher_path);
  });

  test('refuses every native observe tool without an open target', () => {
    const closed = session();
    for (const [name, strategy] of PROVIDER_REFUSE_BY_NAME) {
      if (strategy.kind !== 'target_then_capability') continue;
      expect(
        catchPayload(() => refuseProviderTool(closed, name)),
        name,
      ).toStrictEqual({
        code: 'target_unavailable',
        category: 'unavailable',
        message: NO_APP_OPEN,
        retryable: false,
        remediation: { action: NO_APP_OPEN },
      });
    }
    expect(PROVIDER_REFUSE_BY_NAME.size).toBe(166);
  });

  test('refuses every native observe tool for a non-Mach-O target', async () => {
    const open = session();
    await openBinary(open, { path: fixturePath('targets/minimal-elf.bin') });
    let checked = 0;
    for (const [name, strategy] of PROVIDER_REFUSE_BY_NAME) {
      if (strategy.kind !== 'target_then_capability') continue;
      checked += 1;
      expect(
        catchPayload(() => refuseProviderTool(open, name)),
        name,
      ).toStrictEqual({
        code: 'capability_unavailable',
        category: 'unsupported_provider',
        message: NATIVE_MACOS_UNAVAILABLE_MESSAGE,
        retryable: false,
        remediation: { action: NATIVE_MACOS_UNAVAILABLE_MESSAGE },
        details: { provider_id: 'native-macos', operation: name, reason: NATIVE_MACOS_NON_MACHO_REASON },
      });
    }
    expect(checked).toBe(4);
  });

  test('refuses every native observe tool for a Mach-O target', async () => {
    const open = session();
    await openBinary(open, { path: fixturePath('targets/minimal-macho.bin') });
    let checked = 0;
    for (const [name, strategy] of PROVIDER_REFUSE_BY_NAME) {
      if (strategy.kind !== 'target_then_capability') continue;
      checked += 1;
      expect(
        catchPayload(() => refuseProviderTool(open, name)),
        name,
      ).toStrictEqual({
        code: 'capability_unavailable',
        category: 'unsupported_provider',
        message: NATIVE_MACOS_MESSAGE,
        retryable: false,
        remediation: { action: NATIVE_MACOS_MESSAGE },
        details: { provider_id: 'native-macos', operation: name, reason: 'pi-rea has no LLDB/native-macos observe bridge' },
      });
    }
    expect(checked).toBe(4);
  });

  test('reports availability for every refuse tool', async () => {
    const open = session();
    await openBinary(open, { path: fixturePath('targets/minimal-elf.bin') });
    for (const [name, strategy] of PROVIDER_REFUSE_BY_NAME) {
      const expectedClosed =
        strategy.kind === 'official_proxy' || strategy.kind === 'target_then_capability'
          ? { reason: 'target_required', remediation: OPEN_BINARY_REMEDIATION }
          : { reason: 'provider_unavailable', remediation: strategy.kind === 'cdp_endpoint' ? cdpMessage(name) : capabilityRemediation(strategy) };
      expect(providerRefuseAvailability(session(), name), name).toStrictEqual(expectedClosed);
      const expectedOpen = strategy.kind === 'official_proxy' ? OFFICIAL_PROXY_MESSAGE : strategy.kind === 'target_then_capability' ? strategy.message : strategy.kind === 'cdp_endpoint' ? cdpMessage(name) : capabilityRemediation(strategy);
      expect(providerRefuseAvailability(open, name), name).toStrictEqual({ reason: 'provider_unavailable', remediation: expectedOpen });
    }
  });

  test('reports unregistered tools as programmer errors', () => {
    expect(() => providerRefuseAvailability(session(), 'not_a_tool')).toThrowError('providerRefuseAvailability called for unregistered tool not_a_tool');
    expect(() => refuseProviderTool(session(), 'not_a_tool')).toThrowError('refuseProviderTool called for unregistered tool not_a_tool');
  });

  test.for<{ label: string; pid: unknown; reason: string }>([
    { label: 'a numeric pid', pid: 4242, reason: 'Unable to find process with pid 4242' },
    { label: 'a numeric string pid', pid: '4242', reason: 'Unable to find process with pid 4242' },
    { label: 'an empty pid', pid: '', reason: FRIDA_ADDON_DISABLED_REASON },
    { label: 'an infinite pid', pid: Number.POSITIVE_INFINITY, reason: FRIDA_ADDON_DISABLED_REASON },
    { label: 'no pid', pid: undefined, reason: FRIDA_ADDON_DISABLED_REASON },
  ])('start_frida_session reports $label', ({ pid, reason }) => {
    const payload = catchPayload(() => refuseProviderTool(session(), 'start_frida_session', pid === undefined ? {} : { pid }));
    expect(payload).toStrictEqual({
      code: 'capability_unavailable',
      category: 'unsupported_provider',
      message: NATIVE_MACOS_UNAVAILABLE_MESSAGE,
      retryable: false,
      remediation: { action: NATIVE_MACOS_UNAVAILABLE_MESSAGE },
      details: { provider_id: 'frida', operation: 'start_frida_session', reason },
    });
  });

  test('compare_functions rejects left Evidence outside the contract', () => {
    const message = 'Function analysis requires analyze_function Evidence with the rea.analysis predicate; the left Evidence has operation inspect_go_binary and predicate rea.analysis.';
    const payload = catchPayload(() =>
      refuseProviderTool(session(), 'compare_functions', {
        left: { operation: 'inspect_go_binary', predicate_type: 'rea.analysis' },
        right: { operation: 'inspect_go_binary', predicate_type: 'rea.analysis' },
      }),
    );
    expect(payload).toStrictEqual({
      code: 'invalid_request',
      category: 'invalid_input',
      message,
      retryable: false,
      remediation: {
        action: 'Read the declared input schema or CLI usage for compare_functions; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
      },
      recovery: { kind: 'inspect_input_contract', operation: 'compare_functions' },
      details: {
        operation: 'compare_functions',
        issues: [{ path: ['left'], reason: 'invalid_value', message, expected: { operation: 'analyze_function', predicate_type: 'rea.analysis' } }],
      },
    });
  });

  test('compare_functions falls through without usable Evidence', () => {
    for (const params of [{}, { left: 'not-a-record' }, { left: { operation: 'analyze_function', predicate_type: 'rea.analysis' } }]) {
      const payload = catchPayload(() => refuseProviderTool(session(), 'compare_functions', params));
      expect(payload.code).toBe('capability_unavailable');
      expect(payload.details).toStrictEqual({ provider_id: 'compare', operation: 'compare_functions', reason: 'not_implemented' });
    }
  });

  test('export_environment_bundle rejects non-capture Evidence', async () => {
    const targets = await tempTargets();
    const capturePath = await targets.write('capture.json', JSON.stringify({ operation: 'inspect_web_network_capture' }));
    const wrongPath = await targets.write('wrong.json', JSON.stringify({ operation: 'inspect_go_binary' }));
    const browserPath = await targets.write('browser.json', JSON.stringify({ operation: 'capture_browser_scenario' }));
    const brokenPath = await targets.write('broken.json', 'not json');

    const message = 'The capture file is inspect_go_binary Evidence, not capture Evidence.';
    const payload = catchPayload(() => refuseProviderTool(session(), 'export_environment_bundle', { source: { kind: 'evidence-file', path: wrongPath } }));
    expect(payload).toStrictEqual({
      code: 'invalid_request',
      category: 'invalid_input',
      message,
      retryable: false,
      remediation: {
        action: 'Read the declared input schema or CLI usage for environment-build; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
      },
      recovery: { kind: 'inspect_input_contract', operation: 'environment-build' },
      details: {
        operation: 'environment-build',
        issues: [
          {
            path: ['capture', 'operation'],
            reason: 'invalid_value',
            message: 'Pass a HAR file, or capture Evidence JSON from inspect-web-network-capture (HAR) or capture-browser-scenario.',
            expected: 'inspect_web_network_capture or capture_browser_scenario',
          },
        ],
      },
    });

    const accepted = [
      {},
      { source: { kind: 'har', path: capturePath } },
      { source: [] },
      { source: { kind: 'evidence-file', path: capturePath } },
      { source: { kind: 'evidence-file', path: browserPath } },
      { source: { kind: 'evidence-file', path: brokenPath } },
      { source: { kind: 'evidence-file', path: join(targets.dir, 'absent.json') } },
    ];
    for (const params of accepted) {
      const engineFree = catchPayload(() => refuseProviderTool(session(), 'export_environment_bundle', params));
      expect(engineFree.code).toBe('capability_unavailable');
      expect(engineFree.details).toStrictEqual({ provider_id: 'engine-free', operation: 'export_environment_bundle', reason: 'not_implemented' });
    }
  });

  test('isProviderRefuseTool covers the fail-closed catalog', () => {
    expect(PROVIDER_REFUSE_TOOL_NAMES).toStrictEqual([...PROVIDER_REFUSE_BY_NAME.keys()].toSorted());
    expect(PROVIDER_REFUSE_TOOL_NAMES).toHaveLength(166);
    expect(isProviderRefuseTool('read_bytes')).toBe(true);
    expect(isProviderRefuseTool('inspect_frida_devices')).toBe(false);
    expect(isProviderRefuseTool('inspect_macho')).toBe(false);
  });
});

describe('analysis settings', () => {
  const store = (environment: NodeJS.ProcessEnv = {}): AnalysisSettingsStore => new AnalysisSettingsStore(environment);

  test('inspect reports published settings with constraints', () => {
    const report = store().inspect();
    expect(report.revision).toBe(0);
    expect(report.scope).toBe('rea-runtime');
    expect(report.active_values).toStrictEqual({ status: 'not_observed' });
    expect(report.settings.map((descriptor) => descriptor.setting)).toStrictEqual([...ANALYSIS_SETTING_IDS]);
    expect(report.settings[0]).toStrictEqual({
      setting: 'asar.max_header_bytes',
      value: 16_777_216,
      launch_value: 16_777_216,
      default_value: 16_777_216,
      source: 'default',
      unit: 'bytes',
      minimum: 1,
      maximum: 268_435_456,
      applies_at: 'next_operation',
      provider: 'rea-artifact-graph',
      operations: ['open_binary', 'inspect_artifact', 'inventory_artifact', 'extract_artifact', 'analyze_javascript_application', 'inspect_electron_page', 'observe_javascript_runtime'],
      environment: 'REA_ASAR_MAX_HEADER_BYTES',
      agent_editable: true,
    });
    const javascript = report.settings.find((descriptor) => descriptor.setting === 'javascript.max_heap_mb');
    expect(javascript).toMatchObject({ parameter: 'max_heap_mb', value: 1024, source: 'default' });
    expect(javascript === undefined ? 'missing' : Object.hasOwn(javascript, 'environment')).toBe(false);
    expect(report.constraints?.map((constraint) => constraint.control)).toStrictEqual(['REA_MCP_MAX_RESPONSE_BYTES', 'mcp.client_deadline', 'mcp.client_receive_buffer', 'node.parent_heap', 'json.maximum_depth']);
    expect(report.constraints?.[0]).toStrictEqual({
      control: 'REA_MCP_MAX_RESPONSE_BYTES',
      authority: 'operator',
      value: DEFAULT_RESPONSE_BUDGET_BYTES,
      unit: 'bytes',
      observation: 'known',
      recovery: 'Change the launch environment and restart REA with a matching client receive buffer. Prefer retained Evidence, paging or export for completed results.',
    });
  });

  test('inspect intersects setting, provider, operation filters', () => {
    const settings = store();
    expect(settings.inspect({ provider: 'ghidra' }).settings.map((descriptor) => descriptor.setting)).toStrictEqual(['ghidra.startup_timeout_ms', 'ghidra.decompile_timeout_seconds']);
    expect(settings.inspect({ provider: 'ida' }).settings.map((descriptor) => descriptor.setting)).toStrictEqual(['regex.matching_deadline_ms', 'regex.worker_heap_request_mib']);
    expect(settings.inspect({ operation: 'search_strings' }).settings.map((descriptor) => descriptor.setting)).toStrictEqual([
      'ghidra.startup_timeout_ms',
      'hopper.startup_timeout_ms',
      'regex.matching_deadline_ms',
      'regex.worker_heap_request_mib',
    ]);
    expect(settings.inspect({ provider: 'ghidra', operation: 'search_strings' }).settings.map((descriptor) => descriptor.setting)).toStrictEqual(['ghidra.startup_timeout_ms']);
    expect(settings.inspect({ settings: ['wasm.command_timeout_ms'], provider: 'rea-javascript-application' }).settings).toStrictEqual([]);
    expect(settings.inspect({ settings: ['wasm.command_timeout_ms'] }).settings.map((descriptor) => descriptor.setting)).toStrictEqual(['wasm.command_timeout_ms']);
  });

  interface EnvCase {
    readonly label: string;
    readonly environment?: string;
    readonly env: NodeJS.ProcessEnv;
    readonly setting: AnalysisSettingId;
    readonly value?: number | null;
    readonly source?: string;
    readonly constraint?: string;
  }

  const envCases: EnvCase[] = [
    { label: 'an unset variable', env: {}, setting: 'asar.max_header_bytes', value: 16_777_216, source: 'default' },
    {
      label: 'a valid integer',
      environment: 'REA_ASAR_MAX_HEADER_BYTES',
      env: { REA_ASAR_MAX_HEADER_BYTES: '2048' },
      setting: 'asar.max_header_bytes',
      value: 2048,
      source: 'setting',
    },
    {
      label: 'an empty nullable value',
      environment: 'REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS',
      env: { REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS: '' },
      setting: 'ghidra.decompile_timeout_seconds',
      value: null,
      source: 'setting',
    },
    {
      label: 'a null nullable value',
      environment: 'REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS',
      env: { REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS: 'null' },
      setting: 'ghidra.decompile_timeout_seconds',
      value: null,
      source: 'setting',
    },
    {
      label: 'a non-integer value',
      environment: 'REA_ASAR_MAX_HEADER_BYTES',
      env: { REA_ASAR_MAX_HEADER_BYTES: '2k' },
      setting: 'asar.max_header_bytes',
      constraint: 'Expected an integer from 1 to 268435456 bytes',
    },
    {
      label: 'a null marker on a non-nullable setting',
      environment: 'REA_ASAR_MAX_HEADER_BYTES',
      env: { REA_ASAR_MAX_HEADER_BYTES: 'null' },
      setting: 'asar.max_header_bytes',
      constraint: 'Expected an integer from 1 to 268435456 bytes',
    },
    {
      label: 'a negative value',
      environment: 'REA_REGEX_MATCHING_DEADLINE_MS',
      env: { REA_REGEX_MATCHING_DEADLINE_MS: '-1' },
      setting: 'regex.matching_deadline_ms',
      constraint: 'Expected an integer from 1 to 2147483647 ms',
    },
    {
      label: 'an unsafe integer',
      environment: 'REA_REGEX_MATCHING_DEADLINE_MS',
      env: { REA_REGEX_MATCHING_DEADLINE_MS: '9007199254740993' },
      setting: 'regex.matching_deadline_ms',
      constraint: 'Expected an integer from 1 to 2147483647 ms',
    },
    {
      label: 'a value above the maximum',
      environment: 'REA_ASAR_MAX_HEADER_BYTES',
      env: { REA_ASAR_MAX_HEADER_BYTES: '268435457' },
      setting: 'asar.max_header_bytes',
      constraint: 'Expected an integer from 1 to 268435456 bytes',
    },
  ];

  test.for(envCases)('parses $label from the launch environment', ({ environment, env, setting, value, source, constraint }) => {
    const descriptor = store(env).inspect({ settings: [setting] }).settings[0];
    expect(descriptor?.setting).toBe(setting);
    if (constraint === undefined) {
      expect(descriptor).toMatchObject({ value, launch_value: value, source });
      expect(Object.hasOwn(descriptor ?? {}, 'configuration_error')).toBe(false);
      return;
    }
    expect(descriptor).toMatchObject({ source: 'invalid', default_value: expect.any(Number) });
    expect(Object.hasOwn(descriptor ?? {}, 'value')).toBe(false);
    expect(descriptor?.configuration_error).toStrictEqual({
      code: 'configuration_invalid',
      category: 'invalid_input',
      message: `Invalid ${environment}`,
      retryable: false,
      remediation: { action: constraint },
      details: { settings: [{ setting: environment, constraint }] },
    });
  });

  test('update applies a set with a change row', () => {
    const settings = store();
    const report = settings.update({ changes: [{ setting: 'asar.max_header_bytes', action: 'set', value: 33_554_432 }] });
    expect(report.revision).toBe(1);
    expect(report.changed).toBe(true);
    expect(report.active_work_changed).toBe(false);
    expect(report.rea_restart_required).toBe(false);
    expect(report.changes).toStrictEqual([{ setting: 'asar.max_header_bytes', old_value: 16_777_216, new_value: 33_554_432 }]);
    expect(report.settings).toHaveLength(1);
    expect(report.settings[0]).toMatchObject({ value: 33_554_432, launch_value: 16_777_216, source: 'runtime' });
    expect(Object.hasOwn(report, 'constraints')).toBe(false);
  });

  test('update resetting an unset setting reports no change', () => {
    const settings = store();
    const report = settings.update({ changes: [{ setting: 'asar.max_header_bytes', action: 'reset' }] });
    expect(report.revision).toBe(0);
    expect(report.changed).toBe(false);
    expect(report.changes).toStrictEqual([{ setting: 'asar.max_header_bytes', old_value: 16_777_216, new_value: 16_777_216 }]);
    expect(report.settings[0]).toMatchObject({ value: 16_777_216, source: 'default' });
  });

  test('update applies several changes in one revision', () => {
    const settings = store();
    const report = settings.update({
      changes: [
        { setting: 'asar.max_header_bytes', action: 'set', value: 4096 },
        { setting: 'wasm.command_timeout_ms', action: 'set', value: 9000 },
      ],
    });
    expect(report.revision).toBe(1);
    expect(report.changed).toBe(true);
    expect(report.changes).toStrictEqual([
      { setting: 'asar.max_header_bytes', old_value: 16_777_216, new_value: 4096 },
      { setting: 'wasm.command_timeout_ms', old_value: 30_000, new_value: 9000 },
    ]);
    expect(report.settings.map((descriptor) => descriptor.value)).toStrictEqual([4096, 9000]);
  });

  interface UpdateRejectCase {
    readonly label: string;
    readonly changes: unknown;
    readonly expectedRevision?: number;
    readonly message: string;
    readonly details: Record<string, unknown>;
  }

  const twelveResets = [...ANALYSIS_SETTING_IDS.map((setting) => ({ setting, action: 'reset' as const })), { setting: 'asar.max_header_bytes', action: 'reset' as const }];

  const updateRejectCases: UpdateRejectCase[] = [
    {
      label: 'an empty changes array',
      changes: [],
      message: 'update_analysis_settings requires a non-empty changes array.',
      details: { parameter: 'changes' },
    },
    {
      label: 'a non-array changes value',
      changes: 'nope',
      message: 'update_analysis_settings requires a non-empty changes array.',
      details: { parameter: 'changes' },
    },
    {
      label: 'twelve changes',
      changes: twelveResets,
      message: 'update_analysis_settings accepts at most 11 changes.',
      details: { parameter: 'changes' },
    },
    {
      label: 'a stale expected revision',
      changes: [{ setting: 'regex.matching_deadline_ms', action: 'set', value: 1000 }],
      expectedRevision: 3,
      message: 'Settings revision conflict: expected 3, current 0. Inspect settings before retrying.',
      details: { operation: 'update_analysis_settings', issues: [{ path: ['expected_revision'], reason: 'invalid_value', expected: 0 }] },
    },
    {
      label: 'an unknown setting',
      changes: [{ setting: 'nope', action: 'set', value: 1 }],
      message: 'Unknown analysis setting "nope".',
      details: { parameter: 'changes' },
    },
    {
      label: 'a duplicate setting',
      changes: [
        { setting: 'asar.max_header_bytes', action: 'set', value: 2 },
        { setting: 'asar.max_header_bytes', action: 'set', value: 3 },
      ],
      message: 'Each setting may occur only once in an atomic update.',
      details: { operation: 'update_analysis_settings', issues: [{ path: ['changes'], reason: 'invalid_value' }] },
    },
    {
      label: 'null for a non-nullable setting',
      changes: [{ setting: 'asar.max_header_bytes', action: 'set', value: null }],
      message: 'Setting asar.max_header_bytes does not accept null.',
      details: { parameter: 'changes', setting: 'asar.max_header_bytes' },
    },
    {
      label: 'a value below the minimum',
      changes: [{ setting: 'asar.max_header_bytes', action: 'set', value: 0 }],
      message: 'Setting asar.max_header_bytes must be an integer from 1 to 268435456.',
      details: { parameter: 'changes', setting: 'asar.max_header_bytes', minimum: 1, maximum: 268_435_456 },
    },
    {
      label: 'a value above the maximum',
      changes: [{ setting: 'asar.max_header_bytes', action: 'set', value: 268_435_457 }],
      message: 'Setting asar.max_header_bytes must be an integer from 1 to 268435456.',
      details: { parameter: 'changes', setting: 'asar.max_header_bytes', minimum: 1, maximum: 268_435_456 },
    },
    {
      label: 'a fractional value',
      changes: [{ setting: 'asar.max_header_bytes', action: 'set', value: 1.5 }],
      message: 'Setting asar.max_header_bytes must be an integer from 1 to 268435456.',
      details: { parameter: 'changes', setting: 'asar.max_header_bytes', minimum: 1, maximum: 268_435_456 },
    },
    {
      label: 'a string value',
      changes: [{ setting: 'asar.max_header_bytes', action: 'set', value: '2048' }],
      message: 'Setting asar.max_header_bytes must be an integer from 1 to 268435456.',
      details: { parameter: 'changes', setting: 'asar.max_header_bytes', minimum: 1, maximum: 268_435_456 },
    },
    {
      label: 'an undefined value',
      changes: [{ setting: 'asar.max_header_bytes', action: 'set', value: undefined }],
      message: 'Setting asar.max_header_bytes must be an integer from 1 to 268435456.',
      details: { parameter: 'changes', setting: 'asar.max_header_bytes', minimum: 1, maximum: 268_435_456 },
    },
  ];

  test.for(updateRejectCases)('update rejects $label', ({ changes, expectedRevision, message, details }) => {
    const settings = store();
    const payload = catchPayload(() =>
      settings.update({
        changes: changes as readonly SettingChange[],
        ...(expectedRevision === undefined ? {} : { expected_revision: expectedRevision }),
      }),
    );
    expect(payload).toStrictEqual({
      code: 'invalid_request',
      category: 'invalid_input',
      message,
      retryable: true,
      remediation: { action: message },
      details,
    });
  });

  test('update nulls a nullable setting then resets it', () => {
    const settings = store({ REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS: '30' });
    expect(settings.inspect({ settings: ['ghidra.decompile_timeout_seconds'] }).settings[0]).toMatchObject({ value: 30, source: 'setting' });
    const nulled = settings.update({ changes: [{ setting: 'ghidra.decompile_timeout_seconds', action: 'set', value: null }] });
    expect(nulled.revision).toBe(1);
    expect(nulled.changes).toStrictEqual([{ setting: 'ghidra.decompile_timeout_seconds', old_value: 30, new_value: null }]);
    expect(nulled.settings[0]).toMatchObject({ value: null, launch_value: 30, source: 'runtime' });
    const reset = settings.update({ changes: [{ setting: 'ghidra.decompile_timeout_seconds', action: 'reset' }], expected_revision: 1 });
    expect(reset.revision).toBe(2);
    expect(reset.settings[0]).toMatchObject({ value: 30, launch_value: 30, source: 'setting' });
  });

  test('update accepts minimum, maximum boundaries', () => {
    const settings = store();
    expect(settings.update({ changes: [{ setting: 'asar.max_header_bytes', action: 'set', value: 1 }] }).settings[0]?.value).toBe(1);
    expect(settings.update({ changes: [{ setting: 'asar.max_header_bytes', action: 'set', value: 268_435_456 }] }).settings[0]?.value).toBe(268_435_456);
  });

  test('runtimeConstraints falls back from an invalid budget', () => {
    const valid = runtimeConstraints({ REA_MCP_MAX_RESPONSE_BYTES: '20000000' });
    expect(valid[0]).toStrictEqual({
      control: 'REA_MCP_MAX_RESPONSE_BYTES',
      authority: 'operator',
      value: 20_000_000,
      unit: 'bytes',
      observation: 'known',
      recovery: 'Change the launch environment and restart REA with a matching client receive buffer. Prefer retained Evidence, paging or export for completed results.',
    });
    const invalid = runtimeConstraints({ REA_MCP_MAX_RESPONSE_BYTES: 'bogus' });
    expect(invalid[0]?.value).toBe(DEFAULT_RESPONSE_BUDGET_BYTES);
    expect(invalid).toHaveLength(5);
    expect(typeof invalid[3]?.value).toBe('number');
    expect(invalid[3]?.observation).toBe('known');
  });
});

describe('unknown ledger', () => {
  test('validateUnknownDraft accepts a minimal draft', () => {
    const minimal: UnknownDraft = {
      question: 'Question?',
      severity: 'low',
      domain: 'domain',
      required_authority: null,
      required_confidence: 'observed',
      required_environment: null,
      recommended_probes: [],
      relationships: [],
      supporting_evidence_ids: [],
      contradicting_evidence_ids: [],
    };
    expect(validateUnknownDraft(minimal)).toStrictEqual(minimal);
  });

  interface DraftRejectCase {
    readonly label: string;
    readonly value: unknown;
    readonly message: string;
    readonly details: Record<string, unknown>;
  }

  const draftRejects: DraftRejectCase[] = [
    { label: 'a null value', value: null, message: 'An unknown must be an object.', details: { domain: 'unknown' } },
    { label: 'an array value', value: [], message: 'An unknown must be an object.', details: { domain: 'unknown' } },
    {
      label: 'missing keys',
      value: {},
      message: 'Invalid arguments for tool record_unknown: question, severity, domain, required_authority, required_confidence, required_environment, recommended_probes, relationships: Required.',
      details: { missing: ['question', 'severity', 'domain', 'required_authority', 'required_confidence', 'required_environment', 'recommended_probes', 'relationships'] },
    },
    {
      label: 'an empty question',
      value: draft({ question: '' }),
      message: 'Invalid arguments for tool record_unknown: question: Invalid input: expected a non-empty string',
      details: { parameter: 'question' },
    },
    {
      label: 'an empty domain',
      value: draft({ domain: '' }),
      message: 'Invalid arguments for tool record_unknown: domain: Invalid input: expected a non-empty string',
      details: { parameter: 'domain' },
    },
    {
      label: 'an unknown severity',
      value: draft({ severity: 'urgent' as UnknownDraft['severity'] }),
      message: 'Invalid arguments for tool record_unknown: severity: Invalid option: expected one of "low"|"medium"|"high"|"critical"',
      details: { parameter: 'severity' },
    },
    {
      label: 'an unknown authority',
      value: draft({ required_authority: 'made-up' as UnknownDraft['required_authority'] }),
      message: 'required_authority must be a known authority or null.',
      details: { parameter: 'required_authority' },
    },
    {
      label: 'an unknown confidence',
      value: draft({ required_confidence: 'guessed' as UnknownDraft['required_confidence'] }),
      message: 'Invalid arguments for tool record_unknown: required_confidence: Invalid option: expected one of "observed"|"derived"|"inferred"',
      details: { parameter: 'required_confidence' },
    },
    {
      label: 'a non-object probe',
      value: draft({ recommended_probes: ['x'] as unknown as UnknownDraft['recommended_probes'] }),
      message: 'recommended_probes must be an array of { operation, rationale } objects.',
      details: { parameter: 'recommended_probes' },
    },
    {
      label: 'a non-object relationship',
      value: draft({ relationships: ['x'] as unknown as UnknownDraft['relationships'] }),
      message: 'relationships entries must be { type, unknown_id } with a known relationship type and unk_ identifier.',
      details: { parameter: 'relationships' },
    },
    {
      label: 'a non-object environment',
      value: draft({ required_environment: 'none' as unknown as UnknownDraft['required_environment'] }),
      message: 'required_environment must be an object with id, platform, architecture and isolation, or null.',
      details: { parameter: 'required_environment' },
    },
    {
      label: 'an unknown isolation',
      value: draft({ required_environment: { id: null, platform: null, architecture: null, isolation: 'orbit' as never } }),
      message: 'required_environment must be an object with id, platform, architecture and isolation, or null.',
      details: { parameter: 'required_environment' },
    },
    {
      label: 'a partial environment',
      value: draft({ required_environment: { id: null } as unknown as UnknownDraft['required_environment'] }),
      message: 'required_environment must be an object with id, platform, architecture and isolation, or null.',
      details: { parameter: 'required_environment' },
    },
    {
      label: 'non-array probes',
      value: draft({ recommended_probes: 'none' as unknown as UnknownDraft['recommended_probes'] }),
      message: 'recommended_probes must be an array of { operation, rationale } objects.',
      details: { parameter: 'recommended_probes' },
    },
    {
      label: 'a probe without a rationale',
      value: draft({ recommended_probes: [{ operation: 'inspect_macho' }] as unknown as UnknownDraft['recommended_probes'] }),
      message: 'recommended_probes must be an array of { operation, rationale } objects.',
      details: { parameter: 'recommended_probes' },
    },
    {
      label: 'non-array relationships',
      value: draft({ relationships: 'none' as unknown as UnknownDraft['relationships'] }),
      message: 'relationships must be an array.',
      details: { parameter: 'relationships' },
    },
    {
      label: 'an unknown relationship type',
      value: draft({ relationships: [{ type: 'supports', unknown_id: `unk_${'a'.repeat(64)}` } as unknown as UnknownDraft['relationships'][number]] }),
      message: 'relationships entries must be { type, unknown_id } with a known relationship type and unk_ identifier.',
      details: { parameter: 'relationships' },
    },
    {
      label: 'a malformed relationship identifier',
      value: draft({ relationships: [{ type: 'depends-on', unknown_id: 'not-an-id' }] }),
      message: 'relationships entries must be { type, unknown_id } with a known relationship type and unk_ identifier.',
      details: { parameter: 'relationships' },
    },
    {
      label: 'a non-string supporting reference',
      value: draft({ supporting_evidence_ids: 'ev_x' as unknown as readonly string[] }),
      message: 'supporting_evidence_ids must be an array of Evidence identifiers.',
      details: { parameter: 'supporting_evidence_ids' },
    },
    {
      label: 'a non-string contradicting reference',
      value: draft({ contradicting_evidence_ids: [1] as unknown as readonly string[] }),
      message: 'contradicting_evidence_ids must be an array of Evidence identifiers.',
      details: { parameter: 'contradicting_evidence_ids' },
    },
  ];

  test.for(draftRejects)('rejects a draft with $label', ({ value, message, details }) => {
    const payload = catchPayload(() => validateUnknownDraft(value));
    expect(payload).toStrictEqual({ code: 'invalid_request', category: 'invalid_input', message, retryable: true, remediation: { action: message }, details });
  });

  interface RecordRejectCase {
    readonly label: string;
    readonly build: (record: UnknownRecord) => unknown;
  }

  const recordRejects: RecordRejectCase[] = [
    { label: 'a malformed identifier', build: (record) => ({ ...record, unknown_id: 'nope' }) },
    { label: 'a zero revision', build: (record) => ({ ...record, revision: 0 }) },
    { label: 'a fractional revision', build: (record) => ({ ...record, revision: 1.5 }) },
    { label: 'a string revision', build: (record) => ({ ...record, revision: '1' }) },
    { label: 'a malformed digest', build: (record) => ({ ...record, revision_digest: 'zz' }) },
    { label: 'an empty question', build: (record) => ({ ...record, question: '' }) },
    { label: 'a numeric question', build: (record) => ({ ...record, question: 42 }) },
    { label: 'an unknown severity', build: (record) => ({ ...record, severity: 'urgent' }) },
    { label: 'an unknown status', build: (record) => ({ ...record, status: 'made-up' }) },
    { label: 'an unknown authority', build: (record) => ({ ...record, required_authority: 'made-up' }) },
    { label: 'an unknown confidence', build: (record) => ({ ...record, required_confidence: 'guessed' }) },
    { label: 'a non-object environment', build: (record) => ({ ...record, required_environment: 'none' }) },
    { label: 'a numeric environment id', build: (record) => ({ ...record, required_environment: { id: 1, platform: null, architecture: null, isolation: null } }) },
    { label: 'a numeric environment architecture', build: (record) => ({ ...record, required_environment: { id: null, platform: null, architecture: 2, isolation: null } }) },
    { label: 'non-array probes', build: (record) => ({ ...record, recommended_probes: {} }) },
    { label: 'non-array relationships', build: (record) => ({ ...record, relationships: 'x' }) },
    { label: 'non-string mutation evidence', build: (record) => ({ ...record, mutation_evidence_ids: [1] }) },
    { label: 'an empty resolution', build: (record) => ({ ...record, resolution: {} }) },
    { label: 'a verified resolution without evidence', build: (record) => ({ ...record, resolution: { disposition: 'verified', rationale: 'r', evidence_ids: [] } }) },
    { label: 'an unknown disposition', build: (record) => ({ ...record, resolution: { disposition: 'resolved', rationale: 'r', evidence_ids: [] } }) },
    { label: 'a non-object resolution', build: (record) => ({ ...record, resolution: 'x' }) },
    { label: 'a resolution without a rationale', build: (record) => ({ ...record, resolution: { disposition: 'withdrawn', rationale: '', evidence_ids: [] } }) },
    { label: 'a resolution with non-array evidence', build: (record) => ({ ...record, resolution: { disposition: 'withdrawn', rationale: 'r', evidence_ids: 'x' } }) },
  ];

  test.for(recordRejects)('isUnknownRecord rejects a record with $label', ({ build }) => {
    expect(isUnknownRecord(build(ledgerRecord()))).toBe(false);
  });

  test('isUnknownRecord accepts canonical records with resolutions', () => {
    const record = ledgerRecord();
    expect(isUnknownRecord(record)).toBe(true);
    expect(isUnknownRecord({ ...record, subject: null })).toBe(true);
    expect(isUnknownRecord({ ...record, resolution: { disposition: 'out-of-scope', rationale: 'Done.', evidence_ids: [] } })).toBe(true);
    expect(isUnknownRecord({ ...record, resolution: { disposition: 'verified', rationale: 'Done.', evidence_ids: [evidenceId] } })).toBe(true);
    expect(isUnknownRecord(null)).toBe(false);
    expect(isUnknownRecord([])).toBe(false);
  });

  test('the ledger records one revision per draft identity', () => {
    const ledger = new UnknownLedger();
    const first = ledger.record(draft(), evidenceId);
    const reordered: UnknownDraft = {
      contradicting_evidence_ids: [],
      supporting_evidence_ids: [],
      relationships: [],
      recommended_probes: [{ operation: 'inspect_macho', rationale: 'Read the shipped artifact.' }],
      required_environment: { id: null, platform: null, architecture: null, isolation: null },
      required_confidence: 'observed',
      required_authority: 'shipped-artifact',
      domain: 'fixture',
      severity: 'medium',
      question: 'Does the fixture embed build settings?',
    };
    expect(unknownIdentity(reordered)).toBe(first.unknown_id);
    expect(first.unknown_id).toMatch(/^unk_[a-f0-9]{64}$/);
    expect(first.revision).toBe(1);
    expect(first.revision_digest).toMatch(/^[a-f0-9]{64}$/);
    expect(first.status).toBe('open');
    expect(first.resolution).toBeNull();
    expect(first.previous_revision_digest).toBeNull();
    expect(first.mutation_evidence_ids).toStrictEqual([evidenceId]);
    expect(ledger.record(draft(), `ev_${'b'.repeat(64)}`)).toBe(first);
    expect(ledger.size).toBe(1);
    expect(ledger.revisionCount).toBe(1);
    expect(ledger.get(first.unknown_id)).toBe(first);
    expect(ledger.list()).toStrictEqual([first]);
  });

  test('insertImported keeps canonical records only', () => {
    const ledger = new UnknownLedger();
    const record = ledgerRecord();
    const imported = record as unknown as Record<string, unknown>;
    expect(ledger.insertImported([imported])).toBe(1);
    expect(ledger.insertImported([imported])).toBe(0);
    expect(ledger.insertImported([{ ...imported, unknown_id: 'bad' }, { ...imported, revision: 'nope' }, imported])).toBe(0);
    expect(ledger.size).toBe(1);
    expect(ledger.get(record.unknown_id)).toBe(record);
  });

  test('assertUpdatable names missing or stale revisions', () => {
    const ledger = new UnknownLedger();
    const record = ledger.record(draft(), evidenceId);
    const missing = catchPayload(() => ledger.assertUpdatable(`unk_${'0'.repeat(64)}`, 1));
    expect(missing).toStrictEqual({
      code: 'invalid_request',
      category: 'invalid_input',
      message: `Unknown unk_${'0'.repeat(64)} is not retained in this session.`,
      retryable: true,
      remediation: { action: `Unknown unk_${'0'.repeat(64)} is not retained in this session.` },
      details: { unknown_id: `unk_${'0'.repeat(64)}`, reason: 'missing' },
    });
    const stale = catchPayload(() => ledger.assertUpdatable(record.unknown_id, 2));
    expect(stale).toStrictEqual({
      code: 'revision_conflict',
      category: 'integrity_mismatch',
      message: `Unknown ${record.unknown_id} is at revision 1, not the expected revision 2. Read list_unknowns and retry with the current revision.`,
      retryable: true,
      remediation: { action: `Unknown ${record.unknown_id} is at revision 1, not the expected revision 2. Read list_unknowns and retry with the current revision.` },
      details: { unknown_id: record.unknown_id, expected_revision: 2, actual_revision: 1 },
    });
    expect(ledger.assertUpdatable(record.unknown_id, 1)).toBe(record);
  });

  test('update advances the revision with mutation evidence', () => {
    const ledger = new UnknownLedger();
    const first = ledger.record(draft(), evidenceId);
    const second = ledger.update(first.unknown_id, 1, { status: 'resolved', resolution: { disposition: 'verified', rationale: 'Verified.', evidence_ids: [evidenceId] }, severity: 'high' }, `ev_${'b'.repeat(64)}`);
    expect(second.revision).toBe(2);
    expect(second.previous_revision_digest).toBe(first.revision_digest);
    expect(second.status).toBe('resolved');
    expect(second.severity).toBe('high');
    expect(second.resolution).toStrictEqual({ disposition: 'verified', rationale: 'Verified.', evidence_ids: [evidenceId] });
    expect(second.mutation_evidence_ids).toStrictEqual([evidenceId, `ev_${'b'.repeat(64)}`]);
    expect(ledger.get(first.unknown_id)).toBe(second);
    expect(ledger.revisionCount).toBe(2);

    const conflict = catchPayload(() => ledger.update(first.unknown_id, 1, { status: 'open' }, `ev_${'c'.repeat(64)}`));
    expect(conflict.code).toBe('revision_conflict');
    expect(conflict.details).toStrictEqual({ unknown_id: first.unknown_id, expected_revision: 1, actual_revision: 2 });
    const absent = catchPayload(() => ledger.update(`unk_${'0'.repeat(64)}`, 1, { status: 'open' }, `ev_${'c'.repeat(64)}`));
    expect(absent).toStrictEqual({
      code: 'invalid_request',
      category: 'invalid_input',
      message: `Unknown unk_${'0'.repeat(64)} is not retained in this session.`,
      retryable: true,
      remediation: { action: `Unknown unk_${'0'.repeat(64)} is not retained in this session.` },
      details: { unknown_id: `unk_${'0'.repeat(64)}`, reason: 'missing' },
    });
  });

  test('clear empties the ledger', () => {
    const ledger = new UnknownLedger();
    ledger.record(draft(), evidenceId);
    expect(ledger.size).toBe(1);
    ledger.clear();
    expect(ledger.size).toBe(0);
    expect(ledger.list()).toStrictEqual([]);
    expect(ledger.revisionCount).toBe(0);
  });

  test('unknownRevisionDigest changes with status', () => {
    const record = ledgerRecord();
    const blocked = unknownRevisionDigest({ ...record, status: 'blocked' });
    expect(blocked).toMatch(/^[a-f0-9]{64}$/);
    expect(blocked).not.toBe(record.revision_digest);
  });
});

describe('evidence records', () => {
  const evidenceDraft = (overrides: Partial<EvidenceDraft> = {}): EvidenceDraft => ({
    subject: {
      name: 'fixture',
      digest: { sha256: 'a'.repeat(64) },
      format: 'elf',
      architecture: 'x86_64',
      local_path: null,
    },
    provider: { id: 'pi-rea-in-process', name: 'pi-rea in-process analysis', version: '0.1.0' },
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_macho',
    parameters: { input_path: '/tmp/fixture' },
    raw_result: null,
    normalized_result: { format: 'elf' },
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: ['a', 'b'],
    locations: [{ kind: 'file-offset', offset: 4 }],
    evidence_links: [],
    ...overrides,
  });

  test('canonicalJson sorts keys while serializing leaves', () => {
    expect(canonicalJson(undefined)).toBe('null');
    expect(canonicalJson(null)).toBe('null');
    expect(canonicalJson('x')).toBe('"x"');
    expect(canonicalJson(3)).toBe('3');
    expect(canonicalJson(true)).toBe('true');
    expect(canonicalJson([1, undefined, { b: 2, a: 1 }])).toBe('[1,null,{"a":1,"b":2}]');
    expect(canonicalJson({})).toBe('{}');
    expect(canonicalJson(() => 1)).toBe('null');
  });

  test('canonicalJson omits undefined object values', () => {
    expect(canonicalJson({ b: undefined, a: [], c: null })).toBe('{"a":[],"c":null}');
  });

  test('sha256Hex returns the known digest', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  test('createEvidence derives a stable semantic identifier', () => {
    const draftValue = evidenceDraft();
    const record = createEvidence(draftValue);
    expect(record.evidence_id).toBe(evidenceIdentity(draftValue));
    expect(record.evidence_id).toMatch(/^ev_[a-f0-9]{64}$/);
    expect(record.operation).toBe('inspect_macho');
    expect(record.subject).toStrictEqual(draftValue.subject);
    expect(record.provider).toStrictEqual(draftValue.provider);
    expect(verifyEvidenceIdentity(record)).toBe(true);
  });

  test('verifyEvidenceIdentity detects a changed record', () => {
    const record = createEvidence(evidenceDraft());
    expect(verifyEvidenceIdentity({ ...record, normalized_result: { format: 'pe' } })).toBe(false);
    expect(verifyEvidenceIdentity({ ...record, confidence: 'derived' })).toBe(false);
  });

  interface EvidenceRejectCase {
    readonly label: string;
    readonly build: (record: EvidenceRecord) => unknown;
  }

  const evidenceRejects: EvidenceRejectCase[] = [
    { label: 'a malformed identifier', build: (record) => ({ ...record, evidence_id: 'ev_x' }) },
    { label: 'an unknown predicate', build: (record) => ({ ...record, predicate_type: 'nope' }) },
    { label: 'an empty operation', build: (record) => ({ ...record, operation: '' }) },
    { label: 'non-object parameters', build: (record) => ({ ...record, parameters: [] }) },
    { label: 'an unknown confidence', build: (record) => ({ ...record, confidence: 'guessed' }) },
    { label: 'an unknown authority', build: (record) => ({ ...record, authority: 'guessed' }) },
    { label: 'a subject without a digest', build: (record) => ({ ...record, subject: { ...(record.subject ?? {}), digest: {} } }) },
    { label: 'a non-object subject', build: (record) => ({ ...record, subject: 'x' }) },
    { label: 'a non-object subject digest', build: (record) => ({ ...record, subject: { ...(record.subject ?? {}), digest: 'x' } }) },
    { label: 'a non-object provider', build: (record) => ({ ...record, provider: 'x' }) },
    { label: 'a numeric subject architecture', build: (record) => ({ ...record, subject: { ...(record.subject ?? {}), architecture: 2 } }) },
    { label: 'a numeric subject path', build: (record) => ({ ...record, subject: { ...(record.subject ?? {}), local_path: 2 } }) },
    { label: 'a numeric subject format', build: (record) => ({ ...record, subject: { ...(record.subject ?? {}), format: 2 } }) },
    { label: 'a numeric provider version', build: (record) => ({ ...record, provider: { id: 'p', name: 'P', version: 2 } }) },
    { label: 'a provider without a name', build: (record) => ({ ...record, provider: { id: 'p' } }) },
    { label: 'a non-string limitation', build: (record) => ({ ...record, limitations: [1] }) },
    { label: 'an array location', build: (record) => ({ ...record, locations: [[]] }) },
    { label: 'a non-string evidence link', build: (record) => ({ ...record, evidence_links: [1] }) },
  ];

  test.for(evidenceRejects)('isEvidenceRecord rejects a record with $label', ({ build }) => {
    expect(isEvidenceRecord(build(createEvidence(evidenceDraft())))).toBe(false);
  });

  test('isEvidenceRecord accepts a canonical record', () => {
    const record = createEvidence(evidenceDraft());
    expect(isEvidenceRecord(record)).toBe(true);
    expect(isEvidenceRecord({ ...record, subject: null })).toBe(true);
    expect(isEvidenceRecord(null)).toBe(false);
    expect(isEvidenceRecord([])).toBe(false);
  });

  test('evidenceSummaryEntry reports profile digest with limits', () => {
    const record = createEvidence(evidenceDraft());
    expect(evidenceSummaryEntry(record)).toStrictEqual({
      evidence_id: record.evidence_id,
      subject: record.subject,
      provider: record.provider,
      operation: 'inspect_macho',
      confidence: 'observed',
      authority: 'shipped-artifact',
      analysis_profile_digest: null,
      retention: 'complete-record',
      limitation_count: 2,
      native_dossier: { available: false, reason: 'different-operation' },
    });
    const profiled = evidenceSummaryEntry(createEvidence(evidenceDraft({ analysis_profile: { detector: 'macho' } })));
    expect(profiled.analysis_profile_digest).toBe(sha256Hex(canonicalJson({ detector: 'macho' })));
  });
});

describe('artifact identity', () => {
  interface IdentityCase extends Pick<ArtifactIdentity, 'format' | 'kind' | 'architecture'> {
    readonly fixture: string;
    readonly sha256?: string;
  }

  const identityCases: IdentityCase[] = [
    { fixture: 'minimal-macho.bin', format: 'mach-o', kind: 'executable', architecture: 'arm64', sha256: '712cd980281c2c1f109e90f710ad537745a64a4e6cd413c6fa60d072a50d0d86' },
    { fixture: 'minimal-elf.bin', format: 'elf', kind: 'executable', architecture: 'x86_64', sha256: '2bdfef8afade4eb81137a0dc23bcbca5f72d1cd4d5dafbbe1ebe95d9fe69d662' },
    { fixture: 'fixture.zip', format: 'zip', kind: 'archive', architecture: null, sha256: 'f70f0a427115616e2e85303698bc8e1fa3fdcb5e405b186c585128d33464455e' },
    { fixture: 'pe/fixture-go-pe.exe', format: 'pe', kind: 'executable', architecture: null, sha256: 'a0c15a15db4af6ff996224c2b7dd37bb646811d1b00d097fc2f363e7037675a6' },
    {
      fixture: 'fixture-go-macho-fat',
      format: 'mach-o',
      kind: 'executable',
      architecture: 'arm64',
      sha256: '1e291a4d2e67e0ed63683fd0325cdba65ec669fe15325c0914b32b936ca679ec',
    },
  ];

  test.for(identityCases)('identifies $fixture', async ({ fixture, format, kind, architecture, sha256 }) => {
    const identity = await identifyArtifact(fixturePath(`targets/${fixture}`));
    expect(identity.path.endsWith(fixture)).toBe(true);
    expect(identity).toStrictEqual({
      path: expect.stringMatching(/^\/.+/),
      format,
      kind,
      architecture,
      sha256: sha256 ?? expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  const header = (size: number, write: (bytes: Buffer) => void): Buffer => {
    const bytes = Buffer.alloc(size);
    write(bytes);
    return bytes;
  };

  interface HeaderCase extends Pick<ArtifactIdentity, 'format' | 'kind' | 'architecture'> {
    readonly label: string;
    readonly bytes: Buffer;
  }

  const headerCases: HeaderCase[] = [
    {
      label: 'thin 32-bit big-endian ppc',
      bytes: header(32, (bytes) => {
        bytes.writeUInt32BE(0xfeedface, 0);
        bytes.writeUInt32BE(0x12, 4);
      }),
      format: 'mach-o',
      kind: 'executable',
      architecture: 'ppc',
    },
    {
      label: 'thin 64-bit big-endian x86_64',
      bytes: header(32, (bytes) => {
        bytes.writeUInt32BE(0xfeedfacf, 0);
        bytes.writeUInt32BE(0x01000007, 4);
      }),
      format: 'mach-o',
      kind: 'executable',
      architecture: 'x86_64',
    },
    {
      label: 'thin 64-bit little-endian arm64',
      bytes: header(32, (bytes) => {
        bytes.writeUInt32LE(0xfeedfacf, 0);
        bytes.writeUInt32LE(0x0100000c, 4);
      }),
      format: 'mach-o',
      kind: 'executable',
      architecture: 'arm64',
    },
    {
      label: 'thin 32-bit little-endian x86',
      bytes: header(32, (bytes) => {
        bytes.writeUInt32LE(0xfeedface, 0);
        bytes.writeUInt32LE(0x7, 4);
      }),
      format: 'mach-o',
      kind: 'executable',
      architecture: 'x86',
    },
    {
      label: 'an unknown Mach-O cpu',
      bytes: header(32, (bytes) => {
        bytes.writeUInt32BE(0xfeedfacf, 0);
        bytes.writeUInt32BE(0x999, 4);
      }),
      format: 'mach-o',
      kind: 'executable',
      architecture: null,
    },
    {
      label: 'a universal single slice',
      bytes: header(64, (bytes) => {
        bytes.writeUInt32BE(0xcafebabe, 0);
        bytes.writeUInt32BE(1, 4);
        bytes.writeUInt32BE(0x12, 8);
      }),
      format: 'mach-o',
      kind: 'executable',
      architecture: 'ppc',
    },
    {
      label: 'a universal binary without a host slice',
      bytes: header(64, (bytes) => {
        bytes.writeUInt32BE(0xcafebabe, 0);
        bytes.writeUInt32BE(2, 4);
        bytes.writeUInt32BE(0x12, 8);
        bytes.writeUInt32BE(0x7, 28);
      }),
      format: 'mach-o',
      kind: 'executable',
      architecture: null,
    },
    {
      label: 'a little-endian universal binary',
      bytes: header(64, (bytes) => {
        bytes.writeUInt32LE(0xcafebabe, 0);
        bytes.writeUInt32LE(1, 4);
        bytes.writeUInt32LE(0x0100000c, 8);
      }),
      format: 'mach-o',
      kind: 'executable',
      architecture: 'arm64',
    },
    {
      label: 'a truncated universal arch table',
      bytes: header(12, (bytes) => {
        bytes.writeUInt32BE(0xcafebabe, 0);
        bytes.writeUInt32BE(2, 4);
        bytes.writeUInt32BE(0x0100000c, 8);
      }),
      format: 'mach-o',
      kind: 'executable',
      architecture: 'arm64',
    },
    {
      label: 'an ELF relocatable object',
      bytes: header(64, (bytes) => {
        bytes.write('\u007fELF', 0, 'latin1');
        bytes.writeUInt16LE(1, 16);
        bytes.writeUInt16LE(0x28, 18);
      }),
      format: 'elf',
      kind: 'object',
      architecture: 'arm',
    },
    {
      label: 'an ELF shared library',
      bytes: header(64, (bytes) => {
        bytes.write('\u007fELF', 0, 'latin1');
        bytes.writeUInt16LE(3, 16);
        bytes.writeUInt16LE(0xb7, 18);
      }),
      format: 'elf',
      kind: 'shared-library',
      architecture: 'arm64',
    },
    {
      label: 'an ELF with an unknown machine',
      bytes: header(64, (bytes) => {
        bytes.write('\u007fELF', 0, 'latin1');
        bytes.writeUInt16LE(2, 16);
        bytes.writeUInt16LE(0x1234, 18);
      }),
      format: 'elf',
      kind: 'executable',
      architecture: null,
    },
    {
      label: 'a ZIP end of central directory',
      bytes: header(32, (bytes) => bytes.writeUInt32LE(0x06054b50, 0)),
      format: 'zip',
      kind: 'archive',
      architecture: null,
    },
    {
      label: 'a ZIP data descriptor',
      bytes: header(32, (bytes) => bytes.writeUInt32LE(0x08074b50, 0)),
      format: 'zip',
      kind: 'archive',
      architecture: null,
    },
    {
      label: 'a PE image',
      bytes: header(32, (bytes) => bytes.write('MZ', 0, 'latin1')),
      format: 'pe',
      kind: 'executable',
      architecture: null,
    },
  ];

  test.for(headerCases)('detects $label from the header', async ({ label, bytes, format, kind, architecture }) => {
    const targets = await tempTargets();
    const path = await targets.write(`${label.replace(/[^a-z0-9]+/gi, '-')}.bin`, bytes);
    const identity = await identifyArtifact(path);
    expect(identity).toStrictEqual({
      path: expect.stringMatching(/^\/.+/),
      format,
      kind,
      architecture,
      sha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
  });

  interface HeaderRejectCase {
    readonly label: string;
    readonly bytes: Buffer;
  }

  const headerRejects: HeaderRejectCase[] = [
    {
      label: 'a universal magic without a table',
      bytes: header(4, (bytes) => bytes.writeUInt32BE(0xcafebabe, 0)),
    },
    {
      label: 'a universal binary with no slices',
      bytes: header(32, (bytes) => {
        bytes.writeUInt32BE(0xcafebabe, 0);
        bytes.writeUInt32BE(0, 4);
      }),
    },
    {
      label: 'a universal binary with too many slices',
      bytes: header(700, (bytes) => {
        bytes.writeUInt32BE(0xcafebabe, 0);
        bytes.writeUInt32BE(33, 4);
        bytes.writeUInt32BE(0x0100000c, 8);
      }),
    },
    {
      label: 'an ELF magic without a header',
      bytes: header(8, (bytes) => bytes.write('\u007fELF', 0, 'latin1')),
    },
    { label: 'a three-byte file', bytes: Buffer.from([0x7f, 0x45, 0x4c]) },
    { label: 'unrecognized bytes', bytes: Buffer.alloc(64, 0x41) },
  ];

  test.for(headerRejects)('refuses $label as unsupported', async ({ label, bytes }) => {
    const targets = await tempTargets();
    const path = await targets.write(`${label.replace(/[^a-z0-9]+/gi, '-')}.bin`, bytes);
    const payload = await catchRejection(() => identifyArtifact(path));
    expect(payload).toStrictEqual({
      code: 'target_unavailable',
      category: 'unsupported_target',
      message: 'Cannot open artifact: unsupported binary format.',
      retryable: false,
      remediation: { action: 'Review the reported file-format reason and select a supported, well-formed target.' },
      details: { path: expect.stringMatching(/^\/.+/), reason: 'unsupported binary format', constraint: 'file_format_rejected' },
    });
  });

  test('rejects a directory target with the file constraint', async () => {
    const payload = await catchRejection(() => identifyArtifact(fixturePath('targets')));
    expect(payload.code).toBe('target_unavailable');
    expect(payload.details).toStrictEqual({
      path: fixturePath('targets'),
      reason: 'this opening route requires a file or app bundle',
      constraint: 'directory_requires_file',
    });
  });

  test('reports a missing path before reading any bytes', async () => {
    const payload = await catchRejection(() => identifyArtifact(fixturePath('targets/absent.bin')));
    expect(payload.code).toBe('target_unavailable');
    expect(payload.message).toContain('target does not exist or a path component is not a directory');
    expect(payload.details).toMatchObject({ path: fixturePath('targets/absent.bin'), reason: expect.stringContaining('ENOENT') as unknown as string });
  });

  test('rejects a FIFO as not a regular file', async () => {
    const targets = await tempTargets();
    const path = join(targets.dir, 'pipe');
    execFileSync('mkfifo', [path]);
    const payload = await catchRejection(() => identifyArtifact(path));
    expect(payload).toStrictEqual({
      code: 'target_unavailable',
      category: 'unavailable',
      message: 'open_binary accepts regular files only. This target is not a regular file.',
      retryable: false,
      remediation: { action: 'open_binary accepts regular files only. This target is not a regular file.' },
      details: { path: expect.stringContaining('pipe') as unknown as string, reason: 'not a regular file' },
    });
  });

  test('identifies a relative path against the given cwd', async () => {
    const identity = await identifyArtifact('minimal-elf.bin', { cwd: fixturePath('targets') });
    expect(identity.format).toBe('elf');
    expect(identity.sha256).toBe('2bdfef8afade4eb81137a0dc23bcbca5f72d1cd4d5dafbbe1ebe95d9fe69d662');
    expect(basename(identity.path)).toBe('minimal-elf.bin');
  });

  test('reports cancellation while hashing', async () => {
    const controller = new AbortController();
    controller.abort();
    const payload = await catchRejection(() => identifyArtifact(fixturePath('targets/fixture-go-macho'), { signal: controller.signal }));
    expect(payload).toStrictEqual({
      code: 'cancelled',
      category: 'cancelled',
      message: 'Hashing the target was cancelled.',
      retryable: true,
      remediation: { action: 'Hashing the target was cancelled.' },
    });
  });
});

describe('macho tools', () => {
  test('inspect_macho requires an open target', async () => {
    const message = 'No target is open. Call open_binary with a local path before inspecting a Mach-O image.';
    expect(await catchRejection(() => inspectMacho(session(), {}))).toStrictEqual({
      code: 'target_unavailable',
      category: 'unavailable',
      message,
      retryable: false,
      remediation: { action: message },
    });
  });

  test('inspect_macho rejects a non Mach-O open target', async () => {
    const open = session();
    const path = fixturePath('targets/minimal-elf.bin');
    await openBinary(open, { path });
    const payload = await catchRejection(() => inspectMacho(open, {}));
    expect(payload).toStrictEqual({
      code: 'invalid_request',
      category: 'invalid_input',
      message: 'The inspection input is not usable. Check the argument and retry.',
      retryable: true,
      remediation: { action: 'The inspection input is not usable. Check the argument and retry.' },
      details: {
        operation: 'inspect_macho',
        issues: [{ path: [], reason: 'invalid_value', message: `Cannot inspect ${path}: the open target is elf, not a Mach-O image.` }],
      },
    });
    expect(open.evidence.size).toBe(0);
  });

  test('inspect_macho rejects an unreadable open target', async () => {
    const targets = await tempTargets();
    const path = await targets.write('gone.bin', await readFile(fixturePath('targets/minimal-macho.bin')));
    const open = session();
    await openBinary(open, { path });
    rmSync(path);
    const payload = await catchRejection(() => inspectMacho(open, {}));
    expect(payload.code).toBe('invalid_request');
    expect(payload.message).toContain('The open target can no longer be read: ENOENT');
    expect(payload.details).toStrictEqual({ operation: 'inspect_macho', path: open.target?.identity.path });
    expect(open.evidence.size).toBe(0);
  });

  test('inspect_macho rejects bytes that are not Mach-O', async () => {
    const open = session();
    const path = fixturePath('targets/note.txt');
    open.openTarget({ path, sha256: 'a'.repeat(64), format: 'mach-o', kind: 'executable', architecture: 'arm64' });
    const payload = await catchRejection(() => inspectMacho(open, {}));
    expect(payload.code).toBe('invalid_request');
    expect(payload.details).toStrictEqual({
      operation: 'inspect_macho',
      issues: [{ path: [], reason: 'invalid_value', message: `Cannot inspect ${path}: it is not a Mach-O image.` }],
    });
  });

  test('inspect_macho records the parsed image', async () => {
    const open = session();
    const path = fixturePath('targets/fixture-go-macho');
    await openBinary(open, { path });
    const result = await inspectMacho(open, {});
    const record = recordOf(result);
    const normalized = record.normalized_result as {
      format: string;
      endian: string;
      word_size: number;
      file_type: string;
      architectures: { items: { name: string }[]; total: number };
      selected_architecture: { name: string };
      entrypoints: { items: { file_offset: number }[] };
      segments: { items: { file_offset: number; file_size: number }[] };
      provenance: { tool: string; tool_version: string }[];
      limitations: string[];
    };
    expect(record.operation).toBe('inspect_macho');
    expect(record.subject).toStrictEqual({
      name: 'fixture-go-macho',
      digest: { sha256: 'fb6fcf5aaf18e4c2990ce7e43d3f41c965952f32a6452b0c18c586053155a71e' },
      format: 'mach-o',
      architecture: 'arm64',
      local_path: path,
    });
    expect(normalized).toMatchObject({ format: 'mach-o', endian: 'little', word_size: 64, file_type: '2' });
    expect(normalized.architectures.total).toBe(1);
    expect(normalized.architectures.items[0]?.name).toBe('arm64');
    expect(normalized.selected_architecture.name).toBe('arm64');
    expect(normalized.provenance[0]).toMatchObject({ tool: 'pi-rea/macho-parser', tool_version: '0.1.0' });
    expect(normalized.limitations).toHaveLength(2);
    const offsets = record.locations.filter((location) => location['kind'] === 'file-offset');
    expect(offsets).toStrictEqual([{ kind: 'file-offset', offset: 489_280 }]);
    const ranges = record.locations.filter((location) => location['kind'] === 'file-offset-range');
    expect(ranges).toHaveLength(normalized.segments.items.filter((segment) => segment.file_size > 0).length);
    for (const [index, segment] of normalized.segments.items.filter((item) => item.file_size > 0).entries()) {
      expect(ranges[index]).toStrictEqual({ kind: 'file-offset-range', start: segment.file_offset, end: segment.file_offset + segment.file_size });
    }
    expect(open.evidence.size).toBe(1);
    expect(open.evidence.list()[0]?.evidence_id).toBe(record.evidence_id);
  });
});

describe('go binary tools', () => {
  const goBlob = (settings: string): Buffer => {
    const marker = Buffer.from('\xff Go buildinf:', 'latin1');
    const header = Buffer.alloc(32);
    marker.copy(header, 0);
    header[14] = 8;
    header[15] = 0;
    const text = Buffer.from(`go1.17.5\nexample.com/probe (devel)\n\n${settings}`, 'latin1');
    return Buffer.concat([Buffer.from([0xde, 0xad]), header, text, Buffer.from([0xff])]);
  };

  test('inspect_go_binary requires a path', async () => {
    const message = 'inspect_go_binary requires path.';
    expect(await catchRejection(() => inspectGoBinary(session(), { path: '' }))).toStrictEqual({
      code: 'invalid_request',
      category: 'invalid_input',
      message,
      retryable: true,
      remediation: { action: message },
      details: { parameter: 'path' },
    });
  });

  test('inspect_go_binary refuses bytes without a buildinfo marker', async () => {
    const open = session();
    const path = fixturePath('targets/note.txt');
    const payload = await catchRejection(() => inspectGoBinary(open, { path }));
    expect(payload).toStrictEqual({
      code: 'capability_unavailable',
      category: 'unsupported_provider',
      message: 'No Go buildinfo marker was found in the searched bytes. That is not evidence that the binary is not a Go program.',
      retryable: false,
      remediation: { action: 'No Go buildinfo marker was found in the searched bytes. That is not evidence that the binary is not a Go program.' },
      details: { operation: 'inspect_go_binary', path, searched_bytes: 19 },
    });
    expect(open.evidence.size).toBe(0);
  });

  test('inspect_go_binary maps a missing path to invalid_request', async () => {
    const path = fixturePath('targets/absent.bin');
    const payload = await catchRejection(() => inspectGoBinary(session(), { path }));
    expect(payload.code).toBe('invalid_request');
    expect(payload.message).toBe('No file or directory exists at the selected input path.');
    expect(payload.details).toStrictEqual({ issues: [{ path: ['path'], reason: 'invalid_value', message: `ENOENT: ${path}` }] });
  });

  test('inspect_go_binary records Mach-O build metadata', async () => {
    const open = session();
    const path = fixturePath('targets/fixture-go-macho');
    const record = recordOf(await inspectGoBinary(open, { path, architecture: 'arm64', detail: 'summary' }));
    const normalized = record.normalized_result as {
      artifact: { path: string; sha256: string; bytes: number };
      format: string;
      architecture: string;
      bits: number;
      byte_order: string;
      build_info: { go_version: string };
      limitations: string[];
    };
    expect(record.operation).toBe('inspect_go_binary');
    expect(record.parameters).toStrictEqual({ path, architecture: 'arm64', detail: 'summary' });
    expect(normalized.artifact).toStrictEqual({
      path,
      sha256: 'fb6fcf5aaf18e4c2990ce7e43d3f41c965952f32a6452b0c18c586053155a71e',
      bytes: 2_509_618,
    });
    expect(normalized).toMatchObject({ format: 'mach-o', architecture: 'arm64', bits: 64, byte_order: 'little' });
    expect(normalized.build_info.go_version).toBe('go1.26.8');
    expect(record.subject).toMatchObject({ architecture: 'arm64', format: 'mach-o' });
    expect(record.locations[0]).toStrictEqual({ kind: 'artifact-path', path });
    expect(record.locations[1]).toStrictEqual({ kind: 'file-offset-range', start: 1_572_864, end: 1_572_896 });
    expect(open.evidence.size).toBe(1);
  });

  test('inspect_go_binary maps a PE architecture to the subject', async () => {
    const open = session();
    const path = fixturePath('targets/pe/fixture-go-pe.exe');
    const record = recordOf(await inspectGoBinary(open, { path }));
    const normalized = record.normalized_result as { format: string; architecture: string; bits: number };
    expect(normalized).toMatchObject({ format: 'pe', architecture: 'amd64', bits: 64 });
    expect(record.subject).toMatchObject({ format: 'pe', architecture: 'x86_64' });
    expect(record.parameters).toStrictEqual({ path });
  });

  interface GoBlobCase {
    readonly label: string;
    readonly settings: string;
    readonly architecture: string | null;
    readonly subjectArchitecture: string | null;
  }

  const goBlobCases: GoBlobCase[] = [
    { label: 'an unknown format without bits', settings: 'GOOS=darwin\nGOARCH=wasm\n', architecture: 'wasm', subjectArchitecture: 'wasm' },
    { label: 'a mapped 386 architecture', settings: 'GOOS=linux\nGOARCH=386\n', architecture: '386', subjectArchitecture: 'x86' },
    { label: 'no GOARCH setting', settings: 'GOOS=darwin\n', architecture: null, subjectArchitecture: null },
  ];

  test.for(goBlobCases)('inspect_go_binary reports $label', async ({ settings, architecture, subjectArchitecture }) => {
    const targets = await tempTargets();
    const path = await targets.write('probe.bin', goBlob(settings));
    const open = session();
    const record = recordOf(await inspectGoBinary(open, { path }));
    const normalized = record.normalized_result as { format: string; architecture: string | null; bits: number | null };
    expect(normalized).toStrictEqual({
      artifact: { path, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: expect.any(Number) },
      format: 'unknown',
      architecture,
      bits: null,
      byte_order: 'little',
      build_info: expect.any(Object),
      limitations: expect.any(Array),
    });
    expect(record.subject?.architecture).toBe(subjectArchitecture);
    expect(open.evidence.size).toBe(1);
  });

  test('inspect_go_binary resolves a relative path against the context', async () => {
    const record = recordOf(await inspectGoBinary(session(), { path: 'fixture-go-macho' }, { cwd: fixturePath('targets') }));
    const normalized = record.normalized_result as { artifact: { path: string; bytes: number }; format: string };
    expect(normalized.format).toBe('mach-o');
    expect(normalized.artifact.path).toBe(fixturePath('targets/fixture-go-macho'));
    expect(record.parameters).toStrictEqual({ path: 'fixture-go-macho' });
    const missing = await catchRejection(() => inspectGoBinary(session(), { path: 'absent-relative.bin' }));
    expect(missing.code).toBe('invalid_request');
  });
});

describe('binary layout tools', () => {
  test('inspect_binary_layout requires a path', async () => {
    const message = 'inspect_binary_layout requires path.';
    expect(await catchRejection(() => inspectBinaryLayout(session(), { path: '' }))).toStrictEqual({
      code: 'invalid_request',
      category: 'invalid_input',
      message,
      retryable: true,
      remediation: { action: message },
      details: { parameter: 'path' },
    });
  });

  test('inspect_binary_layout follows the pwntools host profile', async () => {
    const open = session();
    const path = fixturePath('targets/minimal-elf.bin');
    if (process.platform === 'linux' && process.arch === 'x64') {
      const record = recordOf(await inspectBinaryLayout(open, { path, detail: 'summary' }));
      const normalized = record.normalized_result as { format: string; architecture: string | null; limitations: string[] };
      expect(record.operation).toBe('inspect_binary_layout');
      expect(record.parameters).toStrictEqual({ path, detail: 'summary' });
      expect(normalized.format).toBe('elf');
      expect(normalized.architecture).toBe('x86_64');
      expect(normalized.limitations.at(-1)).toBe('Static facts only; the port performs no execution and opens no disassembler.');
      expect(open.evidence.size).toBe(1);
      return;
    }
    const payload = await catchRejection(() => inspectBinaryLayout(open, { path }));
    expect(payload).toStrictEqual({
      code: 'capability_unavailable',
      category: 'unsupported_provider',
      message: PWNTTOOLS_LINUX_X64_ONLY,
      retryable: false,
      remediation: { action: PWNTTOOLS_LINUX_X64_ONLY },
      details: { provider_id: 'pwntools-elf', operation: 'inspect_binary_layout', reason: PWNTTOOLS_LINUX_X64_ONLY },
    });
    expect(open.evidence.size).toBe(0);
  });
});

describe('har tools', () => {
  const har = (overrides: Record<string, unknown> = {}): Parameters<typeof inspectWebNetworkCapture>[1] =>
    ({
      capture_path: fixturePath('targets/sample.har'),
      format: 'har',
      ...overrides,
    }) as Parameters<typeof inspectWebNetworkCapture>[1];

  test('inspect_web_network_capture requires a capture path', async () => {
    const message = 'inspect_web_network_capture requires capture_path.';
    expect(await catchRejection(() => inspectWebNetworkCapture(session(), har({ capture_path: '' })))).toStrictEqual({
      code: 'invalid_request',
      category: 'invalid_input',
      message,
      retryable: true,
      remediation: { action: message },
      details: { parameter: 'capture_path' },
    });
  });

  test('inspect_web_network_capture requires a known format', async () => {
    const message = 'inspect_web_network_capture requires format har or mitmproxy.';
    expect(await catchRejection(() => inspectWebNetworkCapture(session(), har({ format: 'saz' })))).toStrictEqual({
      code: 'invalid_request',
      category: 'invalid_input',
      message,
      retryable: true,
      remediation: { action: message },
      details: { parameter: 'format' },
    });
  });

  test('inspect_web_network_capture refuses mitmproxy captures', async () => {
    const path = fixturePath('targets/sample.har');
    const message = 'pi-rea implements HAR capture inspection only; mitmproxy format fails closed.';
    expect(await catchRejection(() => inspectWebNetworkCapture(session(), { capture_path: path, format: 'mitmproxy' }))).toStrictEqual({
      code: 'unsupported_target',
      category: 'unsupported_target',
      message,
      retryable: false,
      remediation: { action: message },
      details: { format: 'mitmproxy', path },
    });
  });

  test('inspect_web_network_capture records HAR Evidence', async () => {
    const open = session();
    const path = fixturePath('targets/sample.har');
    const record = recordOf(await inspectWebNetworkCapture(open, har()));
    const normalized = record.normalized_result as {
      format: string;
      total_records: number;
      records: { ordinal: number; reported: { request: { url: string }; response: { status: number } } }[];
      container: { reported: { log: { version: string; creator: { name: string; version: string } } } };
      artifact: { path: string; sha256: string; bytes: number };
    };
    expect(record.operation).toBe('inspect_web_network_capture');
    expect(record.authority).toBe('historical-reference');
    expect(record.parameters).toStrictEqual({ capture_path: path, format: 'har', record_ordinals: [0], sensitive_value_count: 0 });
    expect(record.subject).toStrictEqual({
      name: 'sample.har',
      digest: { sha256: expect.stringMatching(/^[a-f0-9]{64}$/) as unknown as string },
      local_path: path,
      format: 'file',
      architecture: null,
    });
    expect(normalized.format).toBe('har');
    expect(normalized.total_records).toBe(1);
    expect(normalized.records[0]?.ordinal).toBe(0);
    expect(normalized.records[0]?.reported.request.url).toBe('https://api.example.test/api/notes/42');
    expect(normalized.records[0]?.reported.response.status).toBe(200);
    expect(normalized.container.reported.log.version).toBe('1.2');
    expect(normalized.container.reported.log.creator).toStrictEqual({ name: 'parity', version: '1' });
    expect(normalized.artifact).toStrictEqual({ path, sha256: expect.stringMatching(/^[a-f0-9]{64}$/), bytes: 726 });
    expect(record.locations).toStrictEqual([{ kind: 'artifact-path', path }]);
    expect(open.evidence.size).toBe(1);
  });

  test('inspect_web_network_capture rejects an out-of-range ordinal', async () => {
    const payload = await catchRejection(() => inspectWebNetworkCapture(session(), har({ record_ordinals: [5] })));
    expect(payload).toStrictEqual({
      code: 'unsupported_target',
      category: 'unsupported_target',
      message: 'record_ordinals entry 5 is out of range for 1 retained entries.',
      retryable: false,
      remediation: { action: 'record_ordinals entry 5 is out of range for 1 retained entries.' },
      details: { code: 'malformed', offset: null },
    });
  });

  test('inspect_web_network_capture rejects a non-JSON capture', async () => {
    const path = fixturePath('targets/note.txt');
    expect(await catchRejection(() => inspectWebNetworkCapture(session(), har({ capture_path: path })))).toStrictEqual({
      code: 'unsupported_target',
      category: 'unsupported_target',
      message: 'The capture is not valid JSON, so no HAR document could be read.',
      retryable: false,
      remediation: { action: 'The capture is not valid JSON, so no HAR document could be read.' },
      details: { path, detected: 'unknown' },
    });
  });

  test('inspect_web_network_capture maps a missing capture', async () => {
    const path = fixturePath('targets/absent.har');
    const payload = await catchRejection(() => inspectWebNetworkCapture(session(), har({ capture_path: path })));
    expect(payload.code).toBe('invalid_request');
    expect(payload.message).toBe('No file or directory exists at the selected input path.');
    expect(payload.details).toStrictEqual({ issues: [{ path: ['path'], reason: 'invalid_value', message: `ENOENT: ${path}` }] });
  });

  test('inspect_web_network_capture rejects JSON without a HAR log', async () => {
    const targets = await tempTargets();
    const path = await targets.write('empty.json', '{}');
    const payload = await catchRejection(() => inspectWebNetworkCapture(session(), har({ capture_path: path })));
    expect(payload.code).toBe('unsupported_target');
    expect(payload.message).toBe('A HAR document must contain a log object.');
    expect(payload.details).toStrictEqual({ code: 'malformed', offset: null });
  });

  test('inspect_web_network_capture records explicit sensitive values', async () => {
    const open = session();
    const record = recordOf(await inspectWebNetworkCapture(open, har({ record_ordinals: [0], sensitive_values: ['abc'] })));
    expect(record.parameters).toStrictEqual({
      capture_path: fixturePath('targets/sample.har'),
      format: 'har',
      record_ordinals: [0],
      sensitive_value_count: 0,
      sensitive_values: ['abc'],
    });
    expect(open.evidence.size).toBe(1);
  });

  test('inspect_web_network_capture resolves a relative capture path', async () => {
    const record = recordOf(await inspectWebNetworkCapture(session(), { capture_path: 'sample.har', format: 'har' }, { cwd: fixturePath('targets') }));
    const normalized = record.normalized_result as { artifact: { path: string }; format: string };
    expect(normalized.format).toBe('har');
    expect(normalized.artifact.path).toBe(fixturePath('targets/sample.har'));
    expect(record.parameters).toMatchObject({ format: 'har' });
    const missing = await catchRejection(() => inspectWebNetworkCapture(session(), { capture_path: 'absent-relative.har', format: 'har' }));
    expect(missing.code).toBe('invalid_request');
  });
});

describe('plist tools', () => {
  const openTarget = async (): Promise<ReaSession> => {
    const open = session();
    await openBinary(open, { path: fixturePath('targets/minimal-elf.bin') });
    return open;
  };

  test('inspect_plist requires an open target', async () => {
    const message = 'No target is open. Call open_binary with a local path before inspecting a property list.';
    expect(await catchRejection(() => inspectPlist(session(), {}))).toStrictEqual({
      code: 'target_unavailable',
      category: 'unavailable',
      message,
      retryable: false,
      remediation: { action: message },
    });
  });

  test('inspect_plist falls back to the bundle Info.plist', async () => {
    const open = await openTarget();
    const fallback = join(fixturePath('targets/minimal-elf.bin'), 'Contents', 'Info.plist');
    const payload = await catchRejection(() => inspectPlist(open, {}));
    expect(payload.code).toBe('invalid_request');
    expect(payload.details).toStrictEqual({
      operation: 'inspect_plist',
      issues: [{ path: ['path'], reason: 'invalid_value', message: expect.stringContaining(`Cannot inspect ${fallback}: it could not be read (ENOTDIR`) }],
    });
    expect(open.evidence.size).toBe(0);
  });

  test('inspect_plist records an XML property list', async () => {
    const open = await openTarget();
    const path = fixturePath('targets/plist/sample-xml.plist');
    const record = recordOf(await inspectPlist(open, { path }));
    const normalized = record.normalized_result as {
      format: string;
      value: Record<string, unknown>;
      bundle: Record<string, unknown>;
      source_path: string;
      limitations: string[];
    };
    expect(record.operation).toBe('inspect_plist');
    expect(record.parameters).toStrictEqual({ input_path: path });
    expect(record.subject).toStrictEqual({
      name: 'sample-xml.plist',
      digest: {
        sha256: createHash('sha256')
          .update(await readFile(path))
          .digest('hex'),
      },
      format: 'plist',
      architecture: null,
      local_path: path,
    });
    expect(normalized.format).toBe('xml');
    expect(Object.keys(normalized.value)).toStrictEqual(['CFBundleIdentifier', 'CFBundleName', 'CFBundleShortVersionString', 'CFBundleVersion', 'LSMinimumSystemVersion', 'List', 'Nested', 'Nothing']);
    expect(normalized.value['Nothing']).toBe(false);
    expect(normalized.bundle).toStrictEqual({
      identifier: 'com.example.fixture',
      executable: null,
      name: 'Parity Fixture',
      version: '456',
      short_version: '1.2.3',
    });
    expect(normalized.source_path).toBe(path);
    expect(record.locations).toStrictEqual([{ kind: 'artifact-path', path }]);
    expect(open.evidence.size).toBe(1);
  });

  test('inspect_plist records a binary property list', async () => {
    const open = await openTarget();
    const record = recordOf(await inspectPlist(open, { path: fixturePath('targets/plist/sample-binary.plist') }));
    const normalized = record.normalized_result as { format: string; bundle: Record<string, unknown> };
    expect(normalized.format).toBe('binary');
    expect(normalized.bundle).toStrictEqual({
      identifier: 'com.example.fixture',
      executable: null,
      name: 'Parity Fixture',
      version: '456',
      short_version: '1.2.3',
    });
    expect(open.evidence.size).toBe(1);
  });

  test('inspect_plist records typed data, date values', async () => {
    const open = await openTarget();
    const record = recordOf(await inspectPlist(open, { path: fixturePath('targets/plist/sample-typed.plist') }));
    const normalized = record.normalized_result as { format: string; value: Record<string, unknown>; bundle: Record<string, unknown> };
    expect(normalized.format).toBe('xml');
    expect(normalized.value).toStrictEqual({
      Blob: { $plist_type: 'data', base64: 'AQIDBA==' },
      When: { $plist_type: 'date', iso8601: '2026-01-02T03:04:05.000Z' },
    });
    expect(normalized.bundle).toStrictEqual({ identifier: null, executable: null, name: null, version: null, short_version: null });
  });

  test('inspect_plist rejects bytes that are not a property list', async () => {
    const open = await openTarget();
    const path = fixturePath('targets/plist/not-a-plist.plist');
    expect(await catchRejection(() => inspectPlist(open, { path }))).toStrictEqual({
      code: 'invalid_request',
      category: 'invalid_input',
      message: 'The inspection input is not usable. Check the argument and retry.',
      retryable: true,
      remediation: { action: 'The inspection input is not usable. Check the argument and retry.' },
      details: {
        operation: 'inspect_plist',
        issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: it is not a property list (not a property list).` }],
      },
    });
  });

  test('inspect_plist reports a missing property list path', async () => {
    const open = await openTarget();
    const path = fixturePath('targets/plist/absent.plist');
    const payload = await catchRejection(() => inspectPlist(open, { path }));
    expect(payload.details).toStrictEqual({
      operation: 'inspect_plist',
      issues: [{ path: ['path'], reason: 'invalid_value', message: `Cannot inspect ${path}: no file exists there.` }],
    });
    expect(open.evidence.size).toBe(0);
  });

  test('inspect_plist reports an unreadable directory path', async () => {
    const open = await openTarget();
    const path = fixturePath('targets');
    const payload = await catchRejection(() => inspectPlist(open, { path }));
    expect(payload.code).toBe('invalid_request');
    expect(payload.details).toStrictEqual({
      operation: 'inspect_plist',
      issues: [{ path: ['path'], reason: 'invalid_value', message: expect.stringContaining(`Cannot inspect ${path}: it could not be read (EISDIR`) }],
    });
  });

  test('inspect_plist prefers input_path over path', async () => {
    const open = await openTarget();
    const inputPath = fixturePath('targets/plist/sample-xml.plist');
    const record = recordOf(await inspectPlist(open, { path: fixturePath('targets/note.txt'), input_path: inputPath }));
    expect(record.parameters).toStrictEqual({ input_path: inputPath });
    expect((record.normalized_result as { format: string }).format).toBe('xml');
  });

  test('inspect_plist resolves a relative path against the context', async () => {
    const open = await openTarget();
    const record = recordOf(await inspectPlist(open, { path: 'sample-xml.plist' }, { cwd: fixturePath('targets/plist') }));
    const normalized = record.normalized_result as { format: string; source_path: string };
    expect(normalized.format).toBe('xml');
    expect(normalized.source_path).toBe(fixturePath('targets/plist/sample-xml.plist'));
    const payload = await catchRejection(() => inspectPlist(open, { path: 'absent-relative.plist' }));
    expect(payload.details).toStrictEqual({
      operation: 'inspect_plist',
      issues: [{ path: ['path'], reason: 'invalid_value', message: expect.stringContaining('absent-relative.plist: no file exists there.') as unknown as string }],
    });
  });
});
