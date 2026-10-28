import { accessSync, constants, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, posix } from 'node:path';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { capabilityUnavailable, providerUnavailable, ReaError, targetUnavailable } from '../contract/errors.ts';
import type { ReaSession } from '../session/binary-session.ts';

export type RefuseStrategy =
  | { readonly kind: 'official_proxy' }
  | {
      readonly kind: 'capability';
      readonly providerId: string;
      readonly message: string;
      readonly reason: string;
      readonly diagnostics?: Readonly<Record<string, unknown>>;
    }
  | {
      readonly kind: 'target_then_capability';
      readonly providerId: string;
      readonly message: string;
      readonly reason: string;
      readonly diagnostics?: Readonly<Record<string, unknown>>;
    }
  | { readonly kind: 'cdp_endpoint' };

const NO_APP_OPEN =
  'No app is open. Ask the user which app to investigate, then call open_binary with its local path.';

const OFFICIAL_PROXY_MESSAGE =
  'The selected analysis provider is unavailable. Review the reported local diagnostics or run `rea doctor`, then retry.';

const CANDIDATE_IDS = ['ghidra', 'hopper', 'ida', 'kuna'] as const;

const GHIDRA_RELEASE_LINE = '12.1.x';

const MAC_HOPPER_SYSTEM_LAUNCHER = '/Applications/Hopper Disassembler.app/Contents/MacOS/hopper';

const executableFile = (path: string): boolean => {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
};

const javaHomeFromEnv = (): string | undefined => {
  const home = process.env.JAVA_HOME;
  return home !== undefined && home.length > 0 ? home : undefined;
};

const javaCommandForHost = (javaHome: string | undefined, platform: NodeJS.Platform): string => {
  if (javaHome !== undefined) return join(javaHome, 'bin', platform === 'win32' ? 'java.exe' : 'java');
  if (platform !== 'darwin') return platform === 'win32' ? 'java.exe' : 'java';
  const pathValue = process.env.PATH;
  if (pathValue !== undefined) {
    const found = pathValue.split(':').some((directory) => directory.length > 0 && executableFile(join(directory, 'java')));
    if (found) return 'java';
  }
  return 'java';
};

const ghidraRejection = (): Record<string, unknown> => {
  const installDir = process.env.GHIDRA_INSTALL_DIR;
  if (installDir !== undefined && installDir.length > 0) {
    return {
      provider_id: 'ghidra',
      code: 'not_configured',
      reason: 'pi-rea has no Ghidra provider bridge; parity/pi-rea/ records the gap.',
      diagnostics: { install_dir: installDir },
    };
  }
  const platform = process.platform;
  const architecture = process.arch;
  const javaHome = javaHomeFromEnv();
  const javaCommand = javaCommandForHost(javaHome, platform);
  const reason = `Set GHIDRA_INSTALL_DIR to an extracted Ghidra ${GHIDRA_RELEASE_LINE} release directory.`;
  return {
    provider_id: 'ghidra',
    code: 'not_configured',
    reason,
    diagnostics: {
      install_dir: null,
      analyze_headless_path: null,
      native_decompiler_path: null,
      application_properties_path: null,
      provider_version: null,
      java_command: javaCommand,
      java_home: javaHome ?? null,
      java_version: null,
      java_vm_name: null,
      java_os_arch: null,
      java_os_name: null,
      platform,
      architecture,
      checks: [
        { name: 'configuration', ok: false, code: 'not_configured', detail: 'GHIDRA_INSTALL_DIR is not set' },
        { name: 'platform', ok: true, code: null, detail: platform },
        { name: 'architecture', ok: true, code: null, detail: architecture },
        { name: 'installation', ok: false, code: 'executable_missing', detail: 'Ghidra application properties unavailable' },
        { name: 'version', ok: false, code: 'version_unresolved', detail: 'unknown' },
        { name: 'headless', ok: false, code: 'executable_missing', detail: 'analyzeHeadless unavailable' },
        {
          name: 'native_decompiler',
          ok: false,
          code: 'executable_missing',
          detail: `Matching native decompiler for ${platform}/${architecture} was not found`,
        },
        {
          name: 'java',
          ok: false,
          code: 'version_unresolved',
          detail: `${javaCommand}; application.properties is unavailable`,
        },
      ],
    },
  };
};

const hopperLauncherPath = (): string => {
  const configured = process.env.HOPPER_LAUNCHER_PATH;
  if (configured !== undefined && configured.length > 0) return configured;
  if (process.platform !== 'darwin') return MAC_HOPPER_SYSTEM_LAUNCHER;
  const home = process.env.HOME ?? homedir();
  const candidates = [
    MAC_HOPPER_SYSTEM_LAUNCHER,
    posix.join(home, 'Applications', 'Hopper Disassembler.app', 'Contents/MacOS/hopper'),
  ];
  for (const candidate of candidates) {
    if (executableFile(candidate)) return candidate;
  }
  return MAC_HOPPER_SYSTEM_LAUNCHER;
};

const hopperRejection = (): Record<string, unknown> => {
  const launcherPath = hopperLauncherPath();
  const platform = process.platform;
  if (executableFile(launcherPath)) {
    return {
      provider_id: 'hopper',
      code: 'not_configured',
      reason: 'pi-rea has no Hopper provider bridge; parity/pi-rea/ records the gap.',
      diagnostics: { launcher_path: launcherPath, platform },
    };
  }
  return {
    provider_id: 'hopper',
    code: 'executable_missing',
    reason: `Hopper launcher is missing or not executable: ${launcherPath}`,
    diagnostics: { launcher_path: launcherPath, platform },
  };
};

const idaRejection = (): Record<string, unknown> => {
  const registrationPath = process.env.REA_IDA_MCP_CONFIG;
  if (registrationPath !== undefined && registrationPath.length > 0) {
    return {
      provider_id: 'ida',
      code: 'not_configured',
      reason: 'pi-rea has no IDA provider bridge; parity/pi-rea/ records the gap.',
      diagnostics: {
        configured: true,
        registration_path: registrationPath,
        live_connection_probed: false,
      },
    };
  }
  const constraint = 'Set REA_IDA_MCP_CONFIG to an upstream IDA MCP JSON registration; see docs/ida-provider.md.';
  return {
    provider_id: 'ida',
    code: 'not_configured',
    reason: `REA configuration is invalid: ${constraint}`,
    diagnostics: {
      configured: false,
      registration_path: null,
      live_connection_probed: false,
      configuration_details: {
        settings: [{ setting: 'REA_IDA_MCP_CONFIG', constraint }],
      },
      configuration_remediation:
        'Correct REA_IDA_MCP_CONFIG in the environment that starts REA (your shell or the MCP client\'s registration), then rerun.',
    },
  };
};

const kunaRejection = (): Record<string, unknown> => {
  const command = process.env.REA_KUNA_COMMAND;
  if (command !== undefined && command.length > 0) {
    return {
      provider_id: 'kuna',
      code: 'not_configured',
      reason: 'pi-rea has no Kuna provider bridge; parity/pi-rea/ records the gap.',
      diagnostics: { configured: true, version_probed: false },
    };
  }
  return {
    provider_id: 'kuna',
    code: 'not_configured',
    reason:
      'Set REA_KUNA_COMMAND to the absolute path of a caller-supplied kuna executable (verified with 1.833). REA does not download, install or update Kuna.',
    diagnostics: { configured: false, version_probed: false },
  };
};

const officialProxyRejections = (): readonly Record<string, unknown>[] => [
  ghidraRejection(),
  hopperRejection(),
  idaRejection(),
  kunaRejection(),
];

const assign = (names: readonly string[], strategy: RefuseStrategy): ReadonlyArray<readonly [string, RefuseStrategy]> =>
  names.map((name) => [name, strategy] as const);

const ADB_MESSAGE =
  'The selected adb binary was not found: adb. Set REA_ADB_PATH to an absolute path to an existing adb binary.';

const ADB_DIAGNOSTICS = {
  selected_binary: 'adb',
  path_source: 'path',
  remediation: 'Set REA_ADB_PATH to an absolute path to an existing adb binary',
} as const;

const JEB_MESSAGE =
  'Start a JEB client serving MCP (default http://127.0.0.1:8425/mcp) or set REA_JEB_MCP_URL to the running endpoint.';

const RIZIN_MESSAGE = 'Could not launch the selected rizin executable "rizin" (ENOENT).';
const RIZIN_REASON = 'Unable to run configured command (ENOENT)';
const RIZIN_DIAGNOSTICS = {
  boundary: 'provider-launch',
  command: 'rizin',
  system_code: 'ENOENT',
} as const;
const RIZIN_REMEDIATION =
  'Set REA_RIZIN_COMMAND to an installed executable Rizin command, or make that command available on PATH. Check execute permission on the command and search permission on its parent directories before retrying.';

const GDB_MESSAGE =
  'This analysis is unavailable for the current target. Choose another analysis or target.';
const GDB_REASON =
  'Persistent GDB sessions are available only on Linux because REA verifies live inferior output descriptors through /proc.';

const FRIDA_UNAVAILABLE_MESSAGE =
  'This analysis is unavailable for the current target. Choose another analysis or target.';
const FRIDA_ADDON_DISABLED_REASON = 'Cannot load native addon because loading addons is disabled.';

const CUTTER_MESSAGE =
  'pi-rea has no Cutter bridge. No live cutter-bridge session directory is configured for this port.';

const APKTOOL_MESSAGE =
  'The selected apktool launcher was not found: apktool. Set REA_APKTOOL_COMMAND to an absolute apktool launcher (the upstream wrapper or a java -jar script).';
const APKTOOL_DIAGNOSTICS = {
  filesystem_error: 'ENOENT',
  selected_command: 'apktool',
  command_source: 'path',
  remediation: 'Set REA_APKTOOL_COMMAND to an absolute apktool launcher (the upstream wrapper or a java -jar script)',
} as const;

const BINWALK_MESSAGE =
  'This integration requires Linux and an absolute REA_BINWALK_COMMAND path to the caller-supplied tool';

const WAKARU_MESSAGE =
  'Provide an absolute REA_WAKARU_COMMAND pointing to a Wakaru ^1.13.0 Linux x64 binary (verified with 1.14.0); no tool is installed by REA. See docs/javascript-recovery.md#install-wakaru.';

const JADX_MESSAGE =
  'Set REA_JADX_MCP_JAR to the absolute path of a caller-supplied jadx-headless-mcp 0.7.1 JAR. REA does not download or install it.';
const JADX_DIAGNOSTICS = {
  jar_configured: false,
  failure_kind: 'jar',
  failure_code: 'not_configured',
} as const;

const WABT_MESSAGE = 'REA_WABT_BIN_DIRECTORY must be an absolute tool directory.';
const WABT_REMEDIATION =
  'Set absolute REA_WABT_BIN_DIRECTORY to a directory that contains wasm-validate, wasm-objdump and wasm2wat from WABT 1.0.42; each --version must report 1.0.42 on stdout with empty stderr. Correct the reported tool path, access or release before retrying, not the WASM input. Set this in the shell for the next CLI call, or in the MCP server launch environment and restart that server; a shell export does not update a running MCP server. Do not repeat the unchanged call or install tools implicitly.';

const TSHARK_MESSAGE =
  'Packet inspection requires Linux with util-linux prlimit and TShark 4.x (on PATH or through absolute REA_TSHARK_COMMAND) so expanded captures are processed under an enforced address-space limit. On Linux, supply TShark 4.x on PATH or through absolute REA_TSHARK_COMMAND, and util-linux prlimit through REA_TSHARK_PRLIMIT_COMMAND (default /usr/bin/prlimit).';
const TSHARK_REASON =
  'Packet inspection requires Linux with util-linux prlimit and TShark 4.x (on PATH or through absolute REA_TSHARK_COMMAND) so expanded captures are processed under an enforced address-space limit.';

const PCAP_MESSAGE =
  'tshark was not found in an absolute PATH entry; add it to PATH or set REA_TSHARK_COMMAND to its absolute path. Supply Wireshark 4.x tshark and capinfos on PATH or through absolute REA_TSHARK_COMMAND and REA_CAPINFOS_COMMAND; REA does not install them.';
const PCAP_REASON =
  'tshark was not found in an absolute PATH entry; add it to PATH or set REA_TSHARK_COMMAND to its absolute path';

const SIGROK_MESSAGE =
  'Signal decoding requires Linux with util-linux prlimit and REA_SIGROK_COMMAND so expanded recordings are processed under an enforced address-space limit. On Linux, configure sigrok-cli 0.7.2 through REA_SIGROK_COMMAND and util-linux prlimit through REA_SIGROK_PRLIMIT_COMMAND (default /usr/bin/prlimit).';
const SIGROK_REASON =
  'Signal decoding requires Linux with util-linux prlimit and REA_SIGROK_COMMAND so expanded recordings are processed under an enforced address-space limit.';

const EVM_MESSAGE = 'Initial real-verified offline EVM interface profile supports Linux x64 only.';

const NATIVE_MACOS_MESSAGE =
  'pi-rea has no LLDB/native-macos observe bridge. Configure debugging for the upstream REA host, or track the gap in parity/pi-rea/.';

const NATIVE_MACOS_UNAVAILABLE_MESSAGE =
  'This analysis is unavailable for the current target. Choose another analysis or target.';

const NATIVE_MACOS_NON_MACHO_REASON =
  'Native call observation launches a Mach-O executable; the active target is not one';

const ENGINE_FREE_GAP_MESSAGE =
  'pi-rea has not implemented this engine-free surface yet, so the call fails closed instead of returning a substitute result. parity/pi-rea/ tracks the gap.';

const OFFICIAL_PROXY_NAMES = [
  'address_name',
  'address_to_file_offset',
  'annotate_native_function',
  'comment',
  'current_address',
  'current_document',
  'current_procedure',
  'goto_address',
  'inline_comment',
  'inspect_native_data_type',
  'inspect_native_instruction',
  'inspect_native_load_image',
  'list_bookmarks',
  'list_documents',
  'list_names',
  'list_procedures',
  'list_segments',
  'list_strings',
  'next_address',
  'prev_address',
  'procedure_address',
  'procedure_assembly',
  'procedure_callees',
  'procedure_callers',
  'procedure_info',
  'procedure_pseudo_code',
  'procedure_references',
  'read_bytes',
  'read_function_instructions',
  'resolve_containing_procedure',
  'resolve_native_call_targets',
  'search_bytes',
  'search_procedures',
  'search_strings',
  'set_address_name',
  'set_addresses_names',
  'set_bookmark',
  'set_comment',
  'set_inline_comment',
  'unset_bookmark',
  'xrefs',
  'analyze_function',
  'analyze_swift_types',
  'batch_decompile',
  'binary_overview',
  'decompile_all',
  'find_xrefs_to_name',
  'get_call_graph',
  'get_navigation_context',
  'get_objc_classes',
  'get_objc_protocols',
  'inspect_address_context',
  'inspect_native_api',
  'inspect_native_dispatch_metadata',
  'trace_call_path',
  'trace_feature',
  'trace_native_ui_action',
  'trace_native_values',
] as const;

const ADB_NAMES = [
  'capture_adb_screen',
  'collect_adb_bugreport',
  'inspect_adb_client',
  'inspect_adb_device',
  'inspect_adb_display',
  'inspect_adb_package',
  'inspect_adb_window',
  'install_adb_package',
  'list_adb_devices',
  'list_adb_directory',
  'list_adb_features',
  'list_adb_packages',
  'list_adb_processes',
  'list_adb_services',
  'pull_adb_file',
  'pull_adb_package',
  'push_adb_file',
  'read_adb_logcat',
  'read_adb_setting',
  'resolve_adb_packages',
  'start_adb_activity',
  'start_adb_app',
  'stop_adb_app',
  'uninstall_adb_package',
] as const;

const FRIDA_NAMES = [
  'close_frida_session',
  'frida_session_status',
  'instrument_with_frida',
  'list_frida_devices',
  'list_frida_processes',
  'load_frida_script',
  'resume_frida_session',
  'start_frida_session',
  'unload_frida_script',
] as const;

const JEB_NAMES = ['decompile_jeb_item', 'inspect_jeb_client', 'list_jeb_units', 'open_jeb_project'] as const;

const RIZIN_NAMES = [
  'close_rizin_debug_session',
  'execute_rizin_command',
  'rizin_debug_command',
  'rizin_debug_session_status',
  'start_rizin_debug_session',
] as const;

const GDB_NAMES = ['close_gdb_session', 'gdb_console', 'gdb_session_status', 'start_gdb_session'] as const;

const CUTTER_NAMES = ['cutter_command'] as const;

const CDP_NAMES = [
  'analyze_web_bundle',
  'capture_browser_scenario',
  'capture_electron_scenario',
  'capture_web_screenshot',
  'compare_web_captures',
  'compare_web_screenshots',
  'discover_webmcp_tools',
  'inspect_electron_page',
  'inspect_web_event_listeners',
  'inspect_web_page',
  'list_browser_targets',
  'list_electron_targets',
  'list_javascript_runtime_targets',
  'observe_javascript_runtime',
  'observe_web_execution',
  'observe_web_session',
  'reconcile_javascript_runtime',
] as const;

const ANDROID_NAMES = [
  'inspect_android_class',
  'inspect_android_method',
  'inspect_android_package',
  'search_android_classes',
  'trace_android_references',
] as const;

const APKTOOL_NAMES = ['decode_android_resources', 'inspect_apktool_client'] as const;

const FIRMWARE_NAMES = ['extract_firmware', 'inspect_firmware_regions'] as const;

const COMPARE_FAIL_CLOSED_NAMES = [
  'compare_functions',
  'compare_process_captures',
  'compare_wasm_interfaces',
  'find_changed_behavior',
] as const;

const WABT_NAMES = ['inspect_wasm_artifact'] as const;
const TSHARK_NAMES = ['inspect_packet_capture', 'inspect_packet_fields'] as const;
const PCAP_NAMES = ['inspect_pcap_capture', 'inspect_pcap_client'] as const;
const SIGROK_NAMES = ['decode_signal_recording', 'inspect_signal_decoders'] as const;
const EVM_NAMES = ['inspect_evm_interface'] as const;

const NATIVE_OBSERVE_NAMES = [
  'capture_native_ui_scenario',
  'observe_native_calls',
  'observe_native_ui',
  'trace_dylib_resolution',
] as const;

const ENGINE_FREE_GAP_NAMES = [
  'build_call_path',
  'build_reconstruction_obligation_ledger',
  'capture_process_scenario',
  'correlate_static_and_runtime',
  'evaluate_reconstruction_coverage',
  'export_environment_bundle',
  'import_managed_reconstruction',
  'inspect_managed_native_boundaries',
  'match_native_functions',
  'project_android_application_graph',
  'project_harmony_application_graph',
  'project_managed_application_graph',
  'trace_application_feature',
  'trace_javascript_semantics',
  'trace_web_module_imports',
  'trace_web_source_location',
  'verify_managed_native_boundaries',
  'verify_reconstruction',
] as const;

const buildTable = (): ReadonlyMap<string, RefuseStrategy> => {
  const entries: ReadonlyArray<readonly [string, RefuseStrategy]> = [
    ...assign(OFFICIAL_PROXY_NAMES, { kind: 'official_proxy' }),
    ...assign(ADB_NAMES, {
      kind: 'capability',
      providerId: 'adb',
      message: ADB_MESSAGE,
      reason: ADB_MESSAGE,
      diagnostics: ADB_DIAGNOSTICS,
    }),
    ...assign(FRIDA_NAMES, {
      kind: 'capability',
      providerId: 'frida',
      message: FRIDA_UNAVAILABLE_MESSAGE,
      reason: FRIDA_ADDON_DISABLED_REASON,
    }),
    ...assign(JEB_NAMES, {
      kind: 'capability',
      providerId: 'jeb',
      message: JEB_MESSAGE,
      reason: 'fetch failed',
    }),
    ...assign(RIZIN_NAMES, {
      kind: 'capability',
      providerId: 'rizin',
      message: RIZIN_MESSAGE,
      reason: RIZIN_REASON,
      diagnostics: RIZIN_DIAGNOSTICS,
    }),
    ...assign(GDB_NAMES, {
      kind: 'capability',
      providerId: 'gdb',
      message: GDB_MESSAGE,
      reason: GDB_REASON,
    }),
    ...assign(CUTTER_NAMES, {
      kind: 'capability',
      providerId: 'cutter',
      message: CUTTER_MESSAGE,
      reason: 'no_live_bridge_found',
    }),
    ...assign(CDP_NAMES, { kind: 'cdp_endpoint' }),
    ...assign(ANDROID_NAMES, {
      kind: 'capability',
      providerId: 'jadx',
      message: JADX_MESSAGE,
      reason: JADX_MESSAGE,
      diagnostics: JADX_DIAGNOSTICS,
    }),
    ...assign(APKTOOL_NAMES, {
      kind: 'capability',
      providerId: 'apktool',
      message: APKTOOL_MESSAGE,
      reason: APKTOOL_MESSAGE,
      diagnostics: APKTOOL_DIAGNOSTICS,
    }),
    ...assign(FIRMWARE_NAMES, {
      kind: 'capability',
      providerId: 'binwalk',
      message: BINWALK_MESSAGE,
      reason: BINWALK_MESSAGE,
    }),
    ...assign(['recover_javascript_sources'], {
      kind: 'capability',
      providerId: 'wakaru',
      message: WAKARU_MESSAGE,
      reason: WAKARU_MESSAGE,
    }),
    ...assign(COMPARE_FAIL_CLOSED_NAMES, {
      kind: 'capability',
      providerId: 'compare',
      message:
        'pi-rea has no provider bridge for this compare surface yet, so the call fails closed instead of returning a substitute result. parity/pi-rea/ tracks the gap.',
      reason: 'not_implemented',
    }),
    ...assign(WABT_NAMES, {
      kind: 'capability',
      providerId: 'wabt-artifact',
      message: WABT_MESSAGE,
      reason: WABT_MESSAGE,
    }),
    ...assign(TSHARK_NAMES, {
      kind: 'capability',
      providerId: 'tshark-capture',
      message: TSHARK_MESSAGE,
      reason: TSHARK_REASON,
    }),
    ...assign(PCAP_NAMES, {
      kind: 'capability',
      providerId: 'pcap',
      message: PCAP_MESSAGE,
      reason: PCAP_REASON,
    }),
    ...assign(SIGROK_NAMES, {
      kind: 'capability',
      providerId: 'sigrok-recording',
      message: SIGROK_MESSAGE,
      reason: SIGROK_REASON,
    }),
    ...assign(EVM_NAMES, {
      kind: 'capability',
      providerId: 'evmole-interface',
      message: EVM_MESSAGE,
      reason: EVM_MESSAGE,
    }),
    ...assign(NATIVE_OBSERVE_NAMES, {
      kind: 'target_then_capability',
      providerId: 'native-macos',
      message: NATIVE_MACOS_MESSAGE,
      reason: 'pi-rea has no LLDB/native-macos observe bridge',
    }),
    ...assign(ENGINE_FREE_GAP_NAMES, {
      kind: 'capability',
      providerId: 'engine-free',
      message: ENGINE_FREE_GAP_MESSAGE,
      reason: 'not_implemented',
    }),
  ];
  return new Map(entries);
};

export const PROVIDER_REFUSE_BY_NAME: ReadonlyMap<string, RefuseStrategy> = buildTable();

export const PROVIDER_REFUSE_TOOL_NAMES: readonly string[] = [...PROVIDER_REFUSE_BY_NAME.keys()].toSorted();

export const isProviderRefuseTool = (name: string): boolean => PROVIDER_REFUSE_BY_NAME.has(name);

const refuseOfficialProxy = (session: ReaSession, operation: string): never => {
  if (!session.open) {
    throw targetUnavailable(NO_APP_OPEN);
  }
  throw providerUnavailable(OFFICIAL_PROXY_MESSAGE, {
    operation,
    selection_reason: 'provider_unavailable',
    requested_provider_id: 'auto',
    candidate_ids: [...CANDIDATE_IDS],
    rejections: officialProxyRejections(),
  });
};

const refuseCapability = (
  operation: string,
  strategy: Extract<RefuseStrategy, { kind: 'capability' | 'target_then_capability' }>,
): never => {
  const remediation =
    strategy.providerId === 'rizin'
      ? RIZIN_REMEDIATION
      : strategy.providerId === 'wabt-artifact'
        ? WABT_REMEDIATION
        : strategy.message;
  throw capabilityUnavailable(strategy.message, {
    provider_id: strategy.providerId,
    operation,
    reason: strategy.reason,
    ...(strategy.diagnostics === undefined ? {} : { diagnostics: strategy.diagnostics }),
  }, remediation);
};

const refuseTargetThenCapability = (
  session: ReaSession,
  operation: string,
  strategy: Extract<RefuseStrategy, { kind: 'target_then_capability' }>,
): never => {
  if (!session.open) {
    throw targetUnavailable(NO_APP_OPEN);
  }
  if (strategy.providerId === 'native-macos' && session.target?.identity.format !== 'mach-o') {
    return refuseCapability(operation, {
      kind: 'target_then_capability',
      providerId: strategy.providerId,
      message: NATIVE_MACOS_UNAVAILABLE_MESSAGE,
      reason: NATIVE_MACOS_NON_MACHO_REASON,
    });
  }
  return refuseCapability(operation, strategy);
};

const refuseCdp = (operation: string): never => {
  const message = `${operation} could not reach the selected loopback debugging endpoint. Verify that the target process is running with debugging enabled and that the endpoint's port matches it, then retry.`;
  throw providerUnavailable(message, {
    operation,
    reason: 'endpoint_unreachable',
  });
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null;

const inspectInputRemediation = (operation: string): string =>
  `Read the declared input schema or CLI usage for ${operation}; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.`;

const refuseCompareFunctions = (params: Record<string, unknown>): never => {
  const left = params['left'];
  if (isRecord(left)) {
    const operation = left['operation'];
    const predicate = left['predicate_type'];
    if (operation !== 'analyze_function' || predicate !== 'rea.analysis') {
      const message = `Function analysis requires analyze_function Evidence with the rea.analysis predicate; the left Evidence has operation ${String(operation)} and predicate ${String(predicate)}.`;
      throw new ReaError({
        code: 'invalid_request',
        category: 'invalid_input',
        message,
        retryable: false,
        remediation: { action: inspectInputRemediation('compare_functions') },
        recovery: { kind: 'inspect_input_contract', operation: 'compare_functions' },
        details: {
          operation: 'compare_functions',
          issues: [
            {
              path: ['left'],
              reason: 'invalid_value',
              message,
              expected: { operation: 'analyze_function', predicate_type: 'rea.analysis' },
            },
          ],
        },
      });
    }
  }
  throw capabilityUnavailable(
    'pi-rea has no provider bridge for this compare surface yet, so the call fails closed instead of returning a substitute result. parity/pi-rea/ tracks the gap.',
    { provider_id: 'compare', operation: 'compare_functions', reason: 'not_implemented' },
  );
};

const refuseExportEnvironmentBundle = (params: Record<string, unknown>): never => {
  const source = params['source'];
  if (isRecord(source) && source['kind'] === 'evidence-file' && typeof source['path'] === 'string') {
    try {
      const evidence = JSON.parse(readFileSync(source['path'], 'utf8')) as unknown;
      if (isRecord(evidence)) {
        const operation = evidence['operation'];
        if (operation !== 'inspect_web_network_capture' && operation !== 'capture_browser_scenario') {
          throw new ReaError({
            code: 'invalid_request',
            category: 'invalid_input',
            message: `The capture file is ${String(operation)} Evidence, not capture Evidence.`,
            retryable: false,
            remediation: { action: inspectInputRemediation('environment-build') },
            recovery: { kind: 'inspect_input_contract', operation: 'environment-build' },
            details: {
              operation: 'environment-build',
              issues: [
                {
                  path: ['capture', 'operation'],
                  reason: 'invalid_value',
                  message:
                    'Pass a HAR file, or capture Evidence JSON from inspect-web-network-capture (HAR) or capture-browser-scenario.',
                  expected: 'inspect_web_network_capture or capture_browser_scenario',
                },
              ],
            },
          });
        }
      }
    } catch (error) {
      if (error instanceof ReaError) throw error;
    }
  }
  throw capabilityUnavailable(
    'pi-rea has not implemented this engine-free surface yet, so the call fails closed instead of returning a substitute result. parity/pi-rea/ tracks the gap.',
    { provider_id: 'engine-free', operation: 'export_environment_bundle', reason: 'not_implemented' },
  );
};

const refuseFrida = (name: string, params: Record<string, unknown>): never => {
  let reason = FRIDA_ADDON_DISABLED_REASON;
  if (name === 'start_frida_session') {
    const pid = params['pid'];
    if (typeof pid === 'number' && Number.isFinite(pid)) {
      reason = `Unable to find process with pid ${String(pid)}`;
    } else if (typeof pid === 'string' && pid.length > 0) {
      reason = `Unable to find process with pid ${pid}`;
    }
  }
  throw capabilityUnavailable(FRIDA_UNAVAILABLE_MESSAGE, {
    provider_id: 'frida',
    operation: name,
    reason,
  });
};

export const refuseProviderTool = (session: ReaSession, name: string, params: Record<string, unknown> = {}): AgentToolResult<unknown> => {
  if (name === 'compare_functions') return refuseCompareFunctions(params);
  if (name === 'export_environment_bundle') return refuseExportEnvironmentBundle(params);
  if ((FRIDA_NAMES as readonly string[]).includes(name)) return refuseFrida(name, params);

  const strategy = PROVIDER_REFUSE_BY_NAME.get(name);
  if (strategy === undefined) {
    throw new Error(`refuseProviderTool called for unregistered tool ${name}`);
  }
  switch (strategy.kind) {
    case 'official_proxy':
      return refuseOfficialProxy(session, name);
    case 'capability':
      return refuseCapability(name, strategy);
    case 'target_then_capability':
      return refuseTargetThenCapability(session, name, strategy);
    case 'cdp_endpoint':
      return refuseCdp(name);
  }
};
