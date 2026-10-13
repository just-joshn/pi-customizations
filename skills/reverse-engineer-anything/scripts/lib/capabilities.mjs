/**
 * The operations this port implements, and the reference families it does not.
 * Every entry states its effects and limitations, because an operation that
 * writes a file or spawns a process must say so before it is called.
 */
export const EFFECT_TEMPLATE = Object.freeze({
  mutates_artifact: false,
  launches_process: false,
  may_show_ui: false,
  may_access_network: false,
  may_write_filesystem: false,
  changes_permissions: false,
  requires_root: false,
});

export const IMPLEMENTED_OPERATIONS = Object.freeze([
  {
    operation: 'capabilities',
    title: 'List implemented operations, effects and limitations',
    effects: { ...EFFECT_TEMPLATE },
    limitations: ['Availability describes this port on this host, not the reference installation.'],
  },
  {
    operation: 'route',
    title: 'Choose the first operation for a supplied target',
    effects: { ...EFFECT_TEMPLATE },
    limitations: ['Routing follows leading bytes; an unusual container is reported as unsupported rather than guessed.'],
  },
  {
    operation: 'analyze_javascript_application',
    title: 'Statically reconstruct a local JavaScript/Electron application or ASAR',
    effects: { ...EFFECT_TEMPLATE, may_write_filesystem: true },
    limitations: ['JavaScript and HTML are parsed as inert text; nothing is executed, required or evaluated.'],
  },
  {
    operation: 'inspect_artifact',
    title: 'Inspect an archive or package inventory without extracting it',
    effects: { ...EFFECT_TEMPLATE, may_write_filesystem: true },
    limitations: ['ZIP-family containers only; disk images, tarballs and 7z are refused by name.'],
  },
  {
    operation: 'inspect_binary_layout',
    title: 'Read a binary file and linked layout without opening a disassembler',
    effects: { ...EFFECT_TEMPLATE, may_write_filesystem: true },
    limitations: ['Mach-O, ELF and PE headers and tables only; no decompilation and no execution.'],
  },
  {
    operation: 'inspect_go_binary',
    title: 'Read embedded Go compiler, module and build-setting metadata',
    effects: { ...EFFECT_TEMPLATE, may_write_filesystem: true },
    limitations: ['Absent metadata is never reported as “not a Go binary”.'],
  },
  {
    operation: 'inspect_web_network_capture',
    title: 'Inspect a retained HAR capture offline',
    effects: { ...EFFECT_TEMPLATE, may_write_filesystem: true },
    limitations: ['Recorded traffic only; recorded URLs are never fetched and credential values are dropped.'],
  },
  {
    operation: 'discipline_audit',
    title: 'Check retained evidence against the rules a report must satisfy',
    effects: { ...EFFECT_TEMPLATE },
    limitations: ['Read-only. It reports violations; it does not repair a record or upgrade its coverage.'],
  },
  {
    operation: 'inspect_analysis_view',
    title: 'Project a view of retained evidence without repeating the analysis',
    effects: { ...EFFECT_TEMPLATE },
    limitations: ['A view never re-runs the producer and never upgrades the producer’s coverage.'],
  },
  {
    operation: 'record_unknown',
    title: 'Record a residual unknown with its required evidence',
    effects: { ...EFFECT_TEMPLATE, may_write_filesystem: true },
    limitations: ['Duplicate questions are rejected; the record is a question, not a finding.'],
  },
  {
    operation: 'update_unknown',
    title: 'Append an immutable revision to a residual unknown',
    effects: { ...EFFECT_TEMPLATE, may_write_filesystem: true },
    limitations: ['Resolution is refused unless the cited evidence meets the recorded requirement.'],
  },
  {
    operation: 'list_unknowns',
    title: 'List residual-unknown heads in deterministic order',
    effects: { ...EFFECT_TEMPLATE },
    limitations: ['Read-only.'],
  },
  {
    operation: 'evidence_export',
    title: 'Export the session’s retained evidence and unknowns as one canonical bundle',
    effects: { ...EFFECT_TEMPLATE, may_write_filesystem: true },
    limitations: ['Byte-stable for an unchanged session except when a timestamp is requested.'],
  },
  {
    operation: 'evidence_import',
    title: 'Import a canonical bundle after validating every content address',
    effects: { ...EFFECT_TEMPLATE, may_write_filesystem: true },
    limitations: ['A record whose content address does not match its bytes is refused.'],
  },
]);

/** Reference families this port deliberately does not implement, with the reason. */
export const UNAVAILABLE_OPERATIONS = Object.freeze([
  { operation: 'open_binary', reason: 'Native decompilation needs a Hopper, Ghidra or IDA provider; none is installed here.', availability_code: 'missing_prerequisite' },
  { operation: 'analyze_function', reason: 'Provider-backed pseudocode is unavailable without an analysis engine.', availability_code: 'missing_prerequisite' },
  { operation: 'procedure_pseudo_code', reason: 'Provider-backed pseudocode is unavailable without an analysis engine.', availability_code: 'missing_prerequisite' },
  { operation: 'search_procedures', reason: 'Procedure inventory requires an analysis engine.', availability_code: 'missing_prerequisite' },
  { operation: 'inspect_android_package', reason: 'APK code analysis needs a headless JADX MCP JAR and a full JDK; neither is configured here.', availability_code: 'missing_prerequisite' },
  { operation: 'decode_android_resources', reason: 'Resource decoding needs a caller-supplied Apktool launcher.', availability_code: 'missing_prerequisite' },
  { operation: 'inspect_firmware_regions', reason: 'Firmware analysis needs Binwalk or Unblob on Linux.', availability_code: 'unsupported_host' },
  { operation: 'inspect_packet_capture', reason: 'Packet inspection needs TShark 4.x with util-linux prlimit.', availability_code: 'missing_prerequisite' },
  { operation: 'decode_signal_recording', reason: 'Signal decoding needs sigrok-cli 0.7.2.', availability_code: 'missing_prerequisite' },
  { operation: 'inspect_recorded_crash', reason: 'Core inspection needs caller-supplied pwntools on Linux x64.', availability_code: 'unsupported_host' },
  { operation: 'inspect_managed_artifact', reason: 'Managed .NET metadata and CIL decoding are outside this port’s scope.', availability_code: 'unsupported_format' },
  { operation: 'inspect_wasm_artifact', reason: 'WebAssembly decoding needs WABT 1.0.42.', availability_code: 'missing_prerequisite' },
  { operation: 'inspect_evm_interface', reason: 'EVM interface inference is outside this port’s scope.', availability_code: 'unsupported_format' },
  { operation: 'inspect_sqlite_database', reason: 'SQLite inspection is outside this port’s scope.', availability_code: 'unsupported_format' },
  { operation: 'list_browser_targets', reason: 'Passive browser observation needs a running Chrome-family CDP endpoint the caller selects.', availability_code: 'missing_prerequisite' },
  { operation: 'capture_process_scenario', reason: 'Runtime process capture executes a declared target; this port performs no execution.', availability_code: 'unsupported_host' },
  { operation: 'inspect_macho', reason: 'The Mach-O load-command read is implemented as inspect_binary_layout; this port exposes no separate Hopper-shaped entry point.', availability_code: 'unsupported_format' },
  { operation: 'list_architectures', reason: 'Architecture slices are reported by inspect_binary_layout (`slices`); no separate entry point exists here.', availability_code: 'unsupported_format' },
  { operation: 'inspect_plist', reason: 'Apple plist and bundle-metadata parsing is outside this port’s scope.', availability_code: 'unsupported_format' },
  { operation: 'inspect_keyed_archive', reason: 'Foundation keyed-archive parsing is outside this port’s scope.', availability_code: 'unsupported_format' },
  { operation: 'inspect_asset_catalog', reason: 'Compiled Apple asset-catalog parsing is outside this port’s scope.', availability_code: 'unsupported_format' },
  { operation: 'decode_interface_builder', reason: 'Storyboard and nib archive decoding is outside this port’s scope.', availability_code: 'unsupported_format' },
  { operation: 'inspect_signature', reason: 'Code-signature inspection needs the platform signing toolchain and its trust policy.', availability_code: 'unsupported_host' },
  { operation: 'demangle_swift', reason: 'Swift symbol demangling is outside this port’s scope.', availability_code: 'unsupported_format' },
  { operation: 'trace_dylib_resolution', reason: 'Dynamic-library resolution tracing needs a loaded-image provider.', availability_code: 'missing_prerequisite' },
  { operation: 'inspect_managed_native_boundaries', reason: 'Managed/native boundary declarations require managed-artifact parsing, which is out of scope.', availability_code: 'unsupported_format' },
  { operation: 'inspect_native_dispatch_metadata', reason: 'Objective-C/Swift dispatch metadata recovery needs an analysis engine.', availability_code: 'missing_prerequisite' },
  { operation: 'extract_artifact', reason: 'This port reads members in memory by logical path and never extracts artifacts to disk.', availability_code: 'unsupported_format' },
  { operation: 'compare_artifacts', reason: 'Comparison workflows await their own port; the evidence discipline they need is in place.', availability_code: 'unsupported_format' },
  { operation: 'verify_reconstruction', reason: 'Reconstruction verification is outside this port’s scope.', availability_code: 'unsupported_format' },
]);

export function capabilityMatrix({ version = '1' } = {}) {
  return {
    open: false,
    provider: { id: 'pi-rea', name: 'pi reverse-engineer-anything', version },
    capabilities: IMPLEMENTED_OPERATIONS.map((entry) => ({
      operation: entry.operation,
      title: entry.title,
      available: true,
      reason: null,
      availability_code: null,
      effects: { ...entry.effects },
      limitations: [...entry.limitations],
    })),
  };
}

export function unavailableMatrix() {
  return UNAVAILABLE_OPERATIONS.map((entry) => ({
    operation: entry.operation,
    title: null,
    available: false,
    reason: entry.reason,
    availability_code: entry.availability_code,
    effects: { ...EFFECT_TEMPLATE },
    limitations: [entry.reason],
  }));
}

export function unavailableEntry(name) {
  return UNAVAILABLE_OPERATIONS.find((entry) => entry.operation === name) ?? null;
}
