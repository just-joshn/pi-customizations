import type { AgentToolResult, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';
import { loadCatalog, type ToolContract } from './contract/catalog.ts';
import { cancelled, capabilityUnavailable, type ReaError } from './contract/errors.ts';
import type { HandlerParameters } from './contract/handler-parameters.generated.ts';
import { errorResult } from './contract/results.ts';
import type { ReaSession } from './session/binary-session.ts';
import { persistEvidence, persistUnknown, type UnknownPersistEntry } from './session/branch-state.ts';
import { isEvidenceRecord } from './session/evidence.ts';
import { inspectApkSignature } from './tools/apk-signature-tools.ts';
import { projectAppleApplicationGraphTool } from './tools/apple-graph-tools.ts';
import { inspectAppleIps } from './tools/apple-ips-tools.ts';
import { listArchitectures } from './tools/arch-tools.ts';
import { extractArtifact, inspectArtifact } from './tools/artifact-tools.ts';
import { inspectBinaryLayout } from './tools/binary-layout-tools.ts';
import { inspectAssetCatalog, inspectKeyedArchive, openBundleResources } from './tools/bundle-resource-tools.ts';
import { compareApplicationVersionsTool, compareArtifacts, compareBundles, compareJavascriptExportShapesTool, compareManagedMembers, compareSourceToBundleTool } from './tools/compare-tools.ts';
import { listCutterSessions } from './tools/cutter-tools.ts';
import { demangleSwift } from './tools/demangle-tools.ts';
import { inspectDesktopApplication } from './tools/desktop-application-tools.ts';
import { inspectDevicetree } from './tools/devicetree-tools.ts';
import { inspectElectronFuses } from './tools/electron-fuse-tools.ts';
import { inspectElfNotes } from './tools/elf-tools.ts';
import { inspectByteEntropy } from './tools/entropy-tools.ts';
import { inspectErlangBeam } from './tools/erlang-beam-tools.ts';
import { exportEvidenceBundle, getEvidenceBundle, importEvidenceBundle, inspectAnalysisView } from './tools/evidence-tools.ts';
import { identifyFlutterBuild, inspectDartAot } from './tools/flutter-tools.ts';
import { inspectGoBinary } from './tools/go-binary-tools.ts';
import { inspectGpuCodeObjects } from './tools/gpu-code-object-tools.ts';
import { inspectWebNetworkCapture } from './tools/har-tools.ts';
import { inspectIl2CppMetadata } from './tools/il2cpp-tools.ts';
import { decodeInterfaceBuilder } from './tools/interface-builder-tools.ts';
import { analyzeJavascriptApplication } from './tools/javascript-tools.ts';
import { inspectKernelModule } from './tools/kernel-module-tools.ts';
import { inspectMacho } from './tools/macho-tools.ts';
import { inspectManagedArtifact, inspectManagedMembers } from './tools/managed-tools.ts';
import { inspectModelArtifact } from './tools/model-artifact-tools.ts';
import { inspectNativeExports } from './tools/native-exports-tools.ts';
import { inspectWithObjdump } from './tools/objdump-tools.ts';
import { inspectPcapCapture, inspectPcapClient } from './tools/pcap-tools.ts';
import { inspectPeCertificates, inspectPeImports, inspectPeLoadConfig, inspectPeResources } from './tools/pe-tools.ts';
import { inspectPlist } from './tools/plist-tools.ts';
import { isProviderRefuseTool, refuseProviderTool } from './tools/provider-refuse-tools.ts';
import { inspectPythonPyc } from './tools/python-pyc-tools.ts';
import { inspectRecordedCrash } from './tools/recorded-crash-tools.ts';
import { inspectRustBinary } from './tools/rust-tools.ts';
import type { ToolCallContext } from './tools/session-tools.ts';
import { binarySession, closeBinary, openBinary } from './tools/session-tools.ts';
import { inspectAnalysisSettings, updateAnalysisSettings } from './tools/settings-tools.ts';
import { inspectSignature } from './tools/signature-tools.ts';
import { inspectSqliteDatabase } from './tools/sqlite-tools.ts';
import { listUnknowns, recordUnknown, updateUnknown, verifyUnknownResolution } from './tools/unknown-tools.ts';
import { exportWebScriptsTool } from './tools/web-script-tools.ts';
import { batchDecompile } from './tools/workflow-tools.ts';

export const isDirect = (contract: ToolContract): boolean => contract.implementation === 'kernel';

export const ROUTING_GUIDELINE =
  'pi-rea implements the session/Evidence kernel plus in-process analyzers (JavaScript/ASAR export-shape and version compares, source-to-bundle, web-script export, Apple application graph projection, ZIP inventory/extract, binary layout, Go buildinfo, HAR, PE/ELF/Rust/IPS/entropy/core, model/SQLite/BEAM/desktop/GPU/IL2CPP/pyc/kernel-module/devicetree, APK signature, Electron fuses, Mach-O signature, keyed archive, asset catalog, Interface Builder, Swift demangle, managed PE/CLI compare, artifact/bundle compare, Flutter/Dart AOT, analysis settings, and fail-closed provider-gated families: official-proxy/Ghidra-IDA-Hopper-Kuna session tools, Frida, ADB, CDP/Electron page, JEB, Rizin, GDB, Cutter, apktool, binwalk, Wakaru, jadx Android inspect, selected compare_*, WABT/TShark/pcap/sigrok/EVM, native-macos observe/dylib, and remaining engine-free surfaces that refuse closed until parsers land). Every catalog tool is registered; a capability_unavailable or provider_unavailable answer is a coverage gap, not a finding about the target. Prefer binary_session then the matching tool; tool_search remains available when enabled.';

export const REA_NAMESPACE = {
  name: 'rea',
  aliases: ['pi-rea', 'rea-agents'],
  description: 'REA: reverse engineering evidence tools. Inspect native binaries, JavaScript/Electron applications, archives, managed assemblies, captures and devices, and keep every finding attached to its Evidence.',
  instructions: [
    'Route the target first: call binary_session for availability and open_binary to bind a local target.',
    'Read result.result for an operation payload and the top-level record for an Evidence-producing operation.',
    'Every conclusion must separate observations, inferences and unknowns; call list_unknowns and record_unknown to',
    'keep residual questions explicit. Export the session with export_evidence_bundle before close_binary, which clears it.',
    'pi-rea currently implements the session/Evidence kernel and the absorbed static analyzers; a tool that is not implemented answers with',
    'capability_unavailable instead of an invented result.',
  ].join(' '),
} as const;

const STRUCTURED_OUTPUT = Type.Object({}, { additionalProperties: true });

const persistResultState = (pi: ExtensionAPI, result: AgentToolResult<unknown>): void => {
  if (result.isError === true) return;
  const details = (result.details ?? {}) as Record<string, unknown>;
  const evidence = details['evidence'];
  if (isEvidenceRecord(evidence)) persistEvidence(pi, evidence);
  const unknown = details['unknown'];
  if (typeof unknown === 'object' && unknown !== null) persistUnknown(pi, unknown as UnknownPersistEntry);
};

const toolLabel = (name: string): string =>
  name
    .split('_')
    .map((word) => (word.length === 0 ? word : word[0]?.toUpperCase() + word.slice(1)))
    .join(' ');

const UNIMPLEMENTED_DETAILS = {
  reason: 'not_implemented',
  reference: 'rea-agents 6.8.0',
  ledger: 'parity/pi-rea/',
} as const;

const unimplemented = (name: string): ReaError =>
  capabilityUnavailable(`pi-rea advertises ${name} but has not implemented it yet, so the call fails closed instead of returning a substitute result. parity/pi-rea/ tracks the gap.`, { operation: name, ...UNIMPLEMENTED_DETAILS });

export const registerReaTools = (pi: ExtensionAPI, getSession: () => ReaSession): void => {
  const catalog = loadCatalog();
  for (const contract of catalog.tools) {
    pi.registerTool({
      name: contract.name,
      label: toolLabel(contract.name),
      description: contract.description,
      parameters: contract.parameters,
      outputSchema: STRUCTURED_OUTPUT,
      annotations: contract.annotations,
      namespace: REA_NAMESPACE,
      ...(contract.name === 'binary_session' ? { promptGuidelines: [ROUTING_GUIDELINE] } : {}),
      exposure: isDirect(contract) ? 'direct' : 'deferred',
      executionMode: 'sequential',
      execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
        if (signal?.aborted === true) return errorResult(cancelled(`The ${contract.name} call was cancelled before it ran.`));
        try {
          const result = await execute(contract, getSession(), params, { cwd: ctx.cwd, ...(signal === undefined ? {} : { signal }) });
          persistResultState(pi, result);
          return result;
        } catch (error) {
          return errorResult(error);
        }
      },
    });
  }
};

type ToolHandler<Args> = (session: ReaSession, args: Args, context: ToolCallContext) => AgentToolResult<unknown> | Promise<AgentToolResult<unknown>>;
type KernelHandlers = { readonly [Name in keyof HandlerParameters]: ToolHandler<HandlerParameters[Name]> };

export const KERNEL_HANDLERS: KernelHandlers = {
  binary_session: (session, args) => binarySession(session, args),
  open_binary: (session, args, context) => openBinary(session, args, context),
  close_binary: (session, args) => closeBinary(session, args),
  get_evidence_bundle: (session, args) => getEvidenceBundle(session, args),
  export_evidence_bundle: (session, args, context) => exportEvidenceBundle(session, args, context),
  import_evidence_bundle: (session, args, context) => importEvidenceBundle(session, args, context),
  inspect_analysis_view: (session, args) => inspectAnalysisView(session, args),
  list_architectures: (session, args) => listArchitectures(session, args),
  inspect_macho: (session, args) => inspectMacho(session, args),
  inspect_pe_resources: (session, args, context) => inspectPeResources(session, args, context),
  inspect_pe_imports: (session, args, context) => inspectPeImports(session, args, context),
  inspect_pe_certificates: (session, args, context) => inspectPeCertificates(session, args, context),
  inspect_pe_load_config: (session, args, context) => inspectPeLoadConfig(session, args, context),
  inspect_elf_notes: (session, args, context) => inspectElfNotes(session, args, context),
  inspect_rust_binary: (session, args, context) => inspectRustBinary(session, args, context),
  inspect_apple_ips: (session, args, context) => inspectAppleIps(session, args, context),
  inspect_byte_entropy: (session, args, context) => inspectByteEntropy(session, args, context),
  inspect_model_artifact: (session, args, context) => inspectModelArtifact(session, args, context),
  inspect_sqlite_database: (session, args, context) => inspectSqliteDatabase(session, args, context),
  inspect_erlang_beam: (session, args, context) => inspectErlangBeam(session, args, context),
  inspect_desktop_application: (session, args, context) => inspectDesktopApplication(session, args, context),
  inspect_gpu_code_objects: (session, args, context) => inspectGpuCodeObjects(session, args, context),
  inspect_il2cpp_metadata: (session, args, context) => inspectIl2CppMetadata(session, args, context),
  inspect_python_pyc: (session, args, context) => inspectPythonPyc(session, args, context),
  inspect_kernel_module: (session, args, context) => inspectKernelModule(session, args, context),
  inspect_apk_signature: (session, args, context) => inspectApkSignature(session, args, context),
  inspect_electron_fuses: (session, args, context) => inspectElectronFuses(session, args, context),
  inspect_signature: (session, args) => inspectSignature(session, args),
  open_bundle_resources: (session, args, context) => openBundleResources(session, args, context),
  inspect_keyed_archive: (session, args, context) => inspectKeyedArchive(session, args, context),
  inspect_asset_catalog: (session, args) => inspectAssetCatalog(session, args),
  inspect_managed_artifact: (session, args, context) => inspectManagedArtifact(session, args, context),
  inspect_managed_members: (session, args, context) => inspectManagedMembers(session, args, context),
  identify_flutter_build: (session, args, context) => identifyFlutterBuild(session, args, context),
  inspect_dart_aot: (session, args, context) => inspectDartAot(session, args, context),
  inspect_plist: (session, args, context) => inspectPlist(session, args, context),
  inspect_artifact: (session, args) => inspectArtifact(session, args),
  extract_artifact: (session, args) => extractArtifact(session, args),
  demangle_swift: (session, args) => demangleSwift(session, args),
  decode_interface_builder: (session, args) => decodeInterfaceBuilder(session, args),
  compare_artifacts: (session, args) => compareArtifacts(session, args),
  compare_bundles: (session, args) => compareBundles(session, args),
  compare_managed_members: (session, args) => compareManagedMembers(session, args),
  compare_javascript_export_shapes: (session, args) => compareJavascriptExportShapesTool(session, args),
  compare_application_versions: (session, args) => compareApplicationVersionsTool(session, args),
  compare_source_to_bundle: (session, args) => compareSourceToBundleTool(session, args),
  export_web_scripts: (session, args) => exportWebScriptsTool(session, args),
  project_apple_application_graph: (session, args) => projectAppleApplicationGraphTool(session, args),
  inspect_recorded_crash: (session, args, context) => inspectRecordedCrash(session, args, context),
  analyze_javascript_application: (session, args, context) => analyzeJavascriptApplication(session, args, context),
  inspect_binary_layout: (session, args, context) => inspectBinaryLayout(session, args, context),
  inspect_go_binary: (session, args, context) => inspectGoBinary(session, args, context),
  inspect_web_network_capture: (session, args, context) => inspectWebNetworkCapture(session, args, context),
  list_unknowns: (session, args) => listUnknowns(session, args),
  record_unknown: (session, args) => recordUnknown(session, args),
  update_unknown: (session, args) => updateUnknown(session, args),
  verify_unknown_resolution: (session, args) => verifyUnknownResolution(session, args),
  inspect_analysis_settings: (session, args) => inspectAnalysisSettings(session, args),
  update_analysis_settings: (session, args) => updateAnalysisSettings(session, args),
  list_cutter_sessions: (session, args) => listCutterSessions(session, args),
  inspect_devicetree: (session, args, context) => inspectDevicetree(session, args, context),
  inspect_with_objdump: (session, args, context) => inspectWithObjdump(session, args, context),
  inspect_native_exports: (session, args, context) => inspectNativeExports(session, args, context),
  inspect_pcap_client: (session) => inspectPcapClient(session),
  inspect_pcap_capture: (session, args) => inspectPcapCapture(session, args),
  batch_decompile: (session, args) => batchDecompile(session, args),
};

export const KERNEL_TOOL_NAMES: readonly string[] = Object.keys(KERNEL_HANDLERS).toSorted();

const execute = async (contract: ToolContract, session: ReaSession, params: unknown, context: ToolCallContext): Promise<AgentToolResult<unknown>> => {
  // The host validates parameters against the catalog before invoking execute.
  // Each entry above is checked against the generated type for that schema.
  const handler = (KERNEL_HANDLERS as unknown as Record<string, ToolHandler<unknown>>)[contract.name];
  if (handler !== undefined) return await handler(session, params, context);
  if (isProviderRefuseTool(contract.name)) return refuseProviderTool(session, contract.name, (params ?? {}) as Record<string, unknown>);
  throw unimplemented(contract.name);
};
