import type { AgentToolResult, ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { loadCatalog, type ToolContract } from './contract/catalog.ts';
import { cancelled, capabilityUnavailable, type ReaError } from './contract/errors.ts';
import { errorResult } from './contract/results.ts';
import type { ReaSession } from './session/binary-session.ts';
import { listArchitectures } from './tools/arch-tools.ts';
import { extractArtifact, inspectArtifact } from './tools/artifact-tools.ts';
import { inspectApkSignature } from './tools/apk-signature-tools.ts';
import { inspectBinaryLayout } from './tools/binary-layout-tools.ts';
import { inspectAssetCatalog, inspectKeyedArchive, openBundleResources } from './tools/bundle-resource-tools.ts';
import { inspectAppleIps } from './tools/apple-ips-tools.ts';
import { projectAppleApplicationGraphTool } from './tools/apple-graph-tools.ts';
import {
  compareApplicationVersionsTool,
  compareArtifacts,
  compareBundles,
  compareJavascriptExportShapesTool,
  compareManagedMembers,
  compareSourceToBundleTool,
} from './tools/compare-tools.ts';
import { demangleSwift } from './tools/demangle-tools.ts';
import { exportEvidenceBundle, getEvidenceBundle, importEvidenceBundle, inspectAnalysisView } from './tools/evidence-tools.ts';
import { inspectElectronFuses } from './tools/electron-fuse-tools.ts';
import { identifyFlutterBuild, inspectDartAot } from './tools/flutter-tools.ts';
import { inspectGoBinary } from './tools/go-binary-tools.ts';
import { inspectWebNetworkCapture } from './tools/har-tools.ts';
import { decodeInterfaceBuilder } from './tools/interface-builder-tools.ts';
import { analyzeJavascriptApplication } from './tools/javascript-tools.ts';
import { inspectMacho } from './tools/macho-tools.ts';
import { inspectDesktopApplication } from './tools/desktop-application-tools.ts';
import { inspectElfNotes } from './tools/elf-tools.ts';
import { inspectByteEntropy } from './tools/entropy-tools.ts';
import { inspectErlangBeam } from './tools/erlang-beam-tools.ts';
import { inspectGpuCodeObjects } from './tools/gpu-code-object-tools.ts';
import { inspectIl2CppMetadata } from './tools/il2cpp-tools.ts';
import { inspectKernelModule } from './tools/kernel-module-tools.ts';
import { inspectManagedArtifact, inspectManagedMembers } from './tools/managed-tools.ts';
import { inspectModelArtifact } from './tools/model-artifact-tools.ts';
import { inspectPeCertificates, inspectPeImports, inspectPeLoadConfig, inspectPeResources } from './tools/pe-tools.ts';
import { inspectPlist } from './tools/plist-tools.ts';
import { inspectPythonPyc } from './tools/python-pyc-tools.ts';
import { inspectRecordedCrash } from './tools/recorded-crash-tools.ts';
import { inspectRustBinary } from './tools/rust-tools.ts';
import { inspectSignature } from './tools/signature-tools.ts';
import { inspectSqliteDatabase } from './tools/sqlite-tools.ts';
import type { ToolCallContext } from './tools/session-tools.ts';
import { binarySession, closeBinary, openBinary } from './tools/session-tools.ts';
import { inspectDevicetree } from './tools/devicetree-tools.ts';
import { listCutterSessions } from './tools/cutter-tools.ts';
import { inspectNativeExports } from './tools/native-exports-tools.ts';
import { inspectWithObjdump } from './tools/objdump-tools.ts';
import { isProviderRefuseTool, refuseProviderTool } from './tools/provider-refuse-tools.ts';
import { inspectAnalysisSettings, updateAnalysisSettings } from './tools/settings-tools.ts';
import { listUnknowns, recordUnknown, updateUnknown, verifyUnknownResolution } from './tools/unknown-tools.ts';
import { exportWebScriptsTool } from './tools/web-script-tools.ts';

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
      annotations: contract.annotations,
      namespace: REA_NAMESPACE,
      ...(contract.name === 'binary_session' ? { promptGuidelines: [ROUTING_GUIDELINE] } : {}),
      exposure: isDirect(contract) ? 'direct' : 'deferred',
      executionMode: 'sequential',
      execute: async (_toolCallId, params, signal, _onUpdate, ctx) => {
        if (signal?.aborted === true) return errorResult(cancelled(`The ${contract.name} call was cancelled before it ran.`));
        try {
          return await execute(contract, getSession(), params, { cwd: ctx.cwd, ...(signal === undefined ? {} : { signal }) });
        } catch (error) {
          return errorResult(error);
        }
      },
    });
  }
};

const execute = async (contract: ToolContract, session: ReaSession, params: unknown, context: ToolCallContext): Promise<AgentToolResult<unknown>> => {
  switch (contract.name) {
    case 'binary_session':
      return binarySession(session, (params ?? {}) as Parameters<typeof binarySession>[1]);
    case 'open_binary':
      return await openBinary(session, params as Parameters<typeof openBinary>[1], context);
    case 'close_binary':
      return closeBinary(session, (params ?? {}) as Parameters<typeof closeBinary>[1]);
    case 'get_evidence_bundle':
      return getEvidenceBundle(session, (params ?? {}) as Parameters<typeof getEvidenceBundle>[1]);
    case 'export_evidence_bundle':
      return await exportEvidenceBundle(session, params as Parameters<typeof exportEvidenceBundle>[1], context);
    case 'import_evidence_bundle':
      return await importEvidenceBundle(session, params as Parameters<typeof importEvidenceBundle>[1], context);
    case 'inspect_analysis_view':
      return await inspectAnalysisView(session, params as Parameters<typeof inspectAnalysisView>[1]);
    case 'list_architectures':
      return await listArchitectures(session, (params ?? {}) as Record<string, never>);
    case 'inspect_macho':
      return await inspectMacho(session, (params ?? {}) as Record<string, never>);
    case 'inspect_pe_resources':
      return await inspectPeResources(session, params as Parameters<typeof inspectPeResources>[1], context);
    case 'inspect_pe_imports':
      return await inspectPeImports(session, params as Parameters<typeof inspectPeImports>[1], context);
    case 'inspect_pe_certificates':
      return await inspectPeCertificates(session, params as Parameters<typeof inspectPeCertificates>[1], context);
    case 'inspect_pe_load_config':
      return await inspectPeLoadConfig(session, params as Parameters<typeof inspectPeLoadConfig>[1], context);
    case 'inspect_elf_notes':
      return await inspectElfNotes(session, params as Parameters<typeof inspectElfNotes>[1], context);
    case 'inspect_rust_binary':
      return await inspectRustBinary(session, params as Parameters<typeof inspectRustBinary>[1], context);
    case 'inspect_apple_ips':
      return await inspectAppleIps(session, params as Parameters<typeof inspectAppleIps>[1], context);
    case 'inspect_byte_entropy':
      return await inspectByteEntropy(session, params as Parameters<typeof inspectByteEntropy>[1], context);
    case 'inspect_model_artifact':
      return await inspectModelArtifact(session, params as Parameters<typeof inspectModelArtifact>[1], context);
    case 'inspect_sqlite_database':
      return await inspectSqliteDatabase(session, params as Parameters<typeof inspectSqliteDatabase>[1], context);
    case 'inspect_erlang_beam':
      return await inspectErlangBeam(session, params as Parameters<typeof inspectErlangBeam>[1], context);
    case 'inspect_desktop_application':
      return await inspectDesktopApplication(session, params as Parameters<typeof inspectDesktopApplication>[1], context);
    case 'inspect_gpu_code_objects':
      return await inspectGpuCodeObjects(session, params as Parameters<typeof inspectGpuCodeObjects>[1], context);
    case 'inspect_il2cpp_metadata':
      return await inspectIl2CppMetadata(session, params as Parameters<typeof inspectIl2CppMetadata>[1], context);
    case 'inspect_python_pyc':
      return await inspectPythonPyc(session, params as Parameters<typeof inspectPythonPyc>[1], context);
    case 'inspect_kernel_module':
      return await inspectKernelModule(session, params as Parameters<typeof inspectKernelModule>[1], context);
    case 'inspect_apk_signature':
      return await inspectApkSignature(session, params as Parameters<typeof inspectApkSignature>[1], context);
    case 'inspect_electron_fuses':
      return await inspectElectronFuses(session, params as Parameters<typeof inspectElectronFuses>[1], context);
    case 'inspect_signature':
      return await inspectSignature(session, (params ?? {}) as Parameters<typeof inspectSignature>[1]);
    case 'open_bundle_resources':
      return await openBundleResources(session, params as Parameters<typeof openBundleResources>[1], context);
    case 'inspect_keyed_archive':
      return await inspectKeyedArchive(session, (params ?? {}) as Parameters<typeof inspectKeyedArchive>[1], context);
    case 'inspect_asset_catalog':
      return await inspectAssetCatalog(session, (params ?? {}) as Parameters<typeof inspectAssetCatalog>[1]);
    case 'inspect_managed_artifact':
      return await inspectManagedArtifact(session, (params ?? {}) as Parameters<typeof inspectManagedArtifact>[1], context);
    case 'inspect_managed_members':
      return await inspectManagedMembers(session, (params ?? {}) as Parameters<typeof inspectManagedMembers>[1], context);
    case 'identify_flutter_build':
      return await identifyFlutterBuild(session, params as Parameters<typeof identifyFlutterBuild>[1], context);
    case 'inspect_dart_aot':
      return await inspectDartAot(session, params as Parameters<typeof inspectDartAot>[1], context);
    case 'inspect_plist':
      return await inspectPlist(session, (params ?? {}) as Parameters<typeof inspectPlist>[1], context);
    case 'inspect_artifact':
      return await inspectArtifact(session, (params ?? {}) as Parameters<typeof inspectArtifact>[1]);
    case 'extract_artifact':
      return await extractArtifact(session, (params ?? {}) as Parameters<typeof extractArtifact>[1]);
    case 'demangle_swift':
      return await demangleSwift(session, params as Parameters<typeof demangleSwift>[1]);
    case 'decode_interface_builder':
      return await decodeInterfaceBuilder(session, (params ?? {}) as Parameters<typeof decodeInterfaceBuilder>[1]);
    case 'compare_artifacts':
      return compareArtifacts(session, params as Parameters<typeof compareArtifacts>[1]);
    case 'compare_bundles':
      return await compareBundles(session, params as Parameters<typeof compareBundles>[1]);
    case 'compare_managed_members':
      return compareManagedMembers(session, params as Parameters<typeof compareManagedMembers>[1]);
    case 'compare_javascript_export_shapes':
      return compareJavascriptExportShapesTool(session, params as Parameters<typeof compareJavascriptExportShapesTool>[1]);
    case 'compare_application_versions':
      return compareApplicationVersionsTool(session, params as Parameters<typeof compareApplicationVersionsTool>[1]);
    case 'compare_source_to_bundle':
      return await compareSourceToBundleTool(session, params as Parameters<typeof compareSourceToBundleTool>[1]);
    case 'export_web_scripts':
      return await exportWebScriptsTool(session, params as Parameters<typeof exportWebScriptsTool>[1]);
    case 'project_apple_application_graph':
      return projectAppleApplicationGraphTool(session, params as Parameters<typeof projectAppleApplicationGraphTool>[1]);
    case 'inspect_recorded_crash':
      return await inspectRecordedCrash(session, params as Parameters<typeof inspectRecordedCrash>[1], context);
    case 'analyze_javascript_application':
      return await analyzeJavascriptApplication(session, params as Parameters<typeof analyzeJavascriptApplication>[1], context);
    case 'inspect_binary_layout':
      return await inspectBinaryLayout(session, params as Parameters<typeof inspectBinaryLayout>[1], context);
    case 'inspect_go_binary':
      return await inspectGoBinary(session, params as Parameters<typeof inspectGoBinary>[1], context);
    case 'inspect_web_network_capture':
      return await inspectWebNetworkCapture(session, params as Parameters<typeof inspectWebNetworkCapture>[1], context);
    case 'list_unknowns':
      return listUnknowns(session, (params ?? {}) as Parameters<typeof listUnknowns>[1]);
    case 'record_unknown':
      return recordUnknown(session, params);
    case 'update_unknown':
      return updateUnknown(session, params as Parameters<typeof updateUnknown>[1]);
    case 'verify_unknown_resolution':
      return verifyUnknownResolution(session, params as Parameters<typeof verifyUnknownResolution>[1]);
    case 'inspect_analysis_settings':
      return inspectAnalysisSettings(session, (params ?? {}) as Parameters<typeof inspectAnalysisSettings>[1]);
    case 'update_analysis_settings':
      return updateAnalysisSettings(session, params as Parameters<typeof updateAnalysisSettings>[1]);
    case 'list_cutter_sessions':
      return listCutterSessions(session, (params ?? {}) as Record<string, unknown>);
    case 'inspect_devicetree':
      return await inspectDevicetree(session, params as Parameters<typeof inspectDevicetree>[1], context);
    case 'inspect_with_objdump':
      return await inspectWithObjdump(session, params as Parameters<typeof inspectWithObjdump>[1], context);
    case 'inspect_native_exports':
      return await inspectNativeExports(session, params as Parameters<typeof inspectNativeExports>[1], context);
    default:
      if (isProviderRefuseTool(contract.name)) {
        return refuseProviderTool(session, contract.name, (params ?? {}) as Record<string, unknown>);
      }
      throw unimplemented(contract.name);
  }
};
