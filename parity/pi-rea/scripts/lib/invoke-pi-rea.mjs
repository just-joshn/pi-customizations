import { ReaError } from '../../../../extensions/pi-rea/src/contract/errors.ts';
import { PI_REA_VERSION, ReaSession } from '../../../../extensions/pi-rea/src/session/binary-session.ts';
import { identifyArtifact } from '../../../../extensions/pi-rea/src/targets/artifact-identity.ts';
import { inspectApkSignature } from '../../../../extensions/pi-rea/src/tools/apk-signature-tools.ts';
import { projectAppleApplicationGraphTool } from '../../../../extensions/pi-rea/src/tools/apple-graph-tools.ts';
import { inspectAppleIps } from '../../../../extensions/pi-rea/src/tools/apple-ips-tools.ts';
import { listArchitectures } from '../../../../extensions/pi-rea/src/tools/arch-tools.ts';
import { extractArtifact, inspectArtifact } from '../../../../extensions/pi-rea/src/tools/artifact-tools.ts';
import { inspectBinaryLayout } from '../../../../extensions/pi-rea/src/tools/binary-layout-tools.ts';
import { inspectAssetCatalog, inspectKeyedArchive, openBundleResources } from '../../../../extensions/pi-rea/src/tools/bundle-resource-tools.ts';
import { compareApplicationVersionsTool, compareArtifacts, compareBundles, compareJavascriptExportShapesTool, compareManagedMembers, compareSourceToBundleTool } from '../../../../extensions/pi-rea/src/tools/compare-tools.ts';
import { listCutterSessions } from '../../../../extensions/pi-rea/src/tools/cutter-tools.ts';
import { demangleSwift } from '../../../../extensions/pi-rea/src/tools/demangle-tools.ts';
import { inspectDesktopApplication } from '../../../../extensions/pi-rea/src/tools/desktop-application-tools.ts';
import { inspectDevicetree } from '../../../../extensions/pi-rea/src/tools/devicetree-tools.ts';
import { inspectElectronFuses } from '../../../../extensions/pi-rea/src/tools/electron-fuse-tools.ts';
import { inspectElfNotes } from '../../../../extensions/pi-rea/src/tools/elf-tools.ts';
import { inspectByteEntropy } from '../../../../extensions/pi-rea/src/tools/entropy-tools.ts';
import { inspectErlangBeam } from '../../../../extensions/pi-rea/src/tools/erlang-beam-tools.ts';
import { identifyFlutterBuild, inspectDartAot } from '../../../../extensions/pi-rea/src/tools/flutter-tools.ts';
import { inspectGoBinary } from '../../../../extensions/pi-rea/src/tools/go-binary-tools.ts';
import { inspectGpuCodeObjects } from '../../../../extensions/pi-rea/src/tools/gpu-code-object-tools.ts';
import { inspectWebNetworkCapture } from '../../../../extensions/pi-rea/src/tools/har-tools.ts';
import { inspectIl2CppMetadata } from '../../../../extensions/pi-rea/src/tools/il2cpp-tools.ts';
import { decodeInterfaceBuilder } from '../../../../extensions/pi-rea/src/tools/interface-builder-tools.ts';
import { analyzeJavascriptApplication } from '../../../../extensions/pi-rea/src/tools/javascript-tools.ts';
import { inspectKernelModule } from '../../../../extensions/pi-rea/src/tools/kernel-module-tools.ts';
import { inspectMacho } from '../../../../extensions/pi-rea/src/tools/macho-tools.ts';
import { inspectManagedArtifact, inspectManagedMembers } from '../../../../extensions/pi-rea/src/tools/managed-tools.ts';
import { inspectModelArtifact } from '../../../../extensions/pi-rea/src/tools/model-artifact-tools.ts';
import { inspectNativeExports } from '../../../../extensions/pi-rea/src/tools/native-exports-tools.ts';
import { inspectWithObjdump } from '../../../../extensions/pi-rea/src/tools/objdump-tools.ts';
import { inspectPeCertificates, inspectPeImports, inspectPeLoadConfig, inspectPeResources } from '../../../../extensions/pi-rea/src/tools/pe-tools.ts';
import { inspectPlist } from '../../../../extensions/pi-rea/src/tools/plist-tools.ts';
import { refuseProviderTool } from '../../../../extensions/pi-rea/src/tools/provider-refuse-tools.ts';
import { inspectPythonPyc } from '../../../../extensions/pi-rea/src/tools/python-pyc-tools.ts';
import { inspectRecordedCrash } from '../../../../extensions/pi-rea/src/tools/recorded-crash-tools.ts';
import { inspectRustBinary } from '../../../../extensions/pi-rea/src/tools/rust-tools.ts';
import { listBookmarks, listDocuments, listNames, listProcedures, listSegments, listStrings } from '../../../../extensions/pi-rea/src/tools/session-list-tools.ts';
import { binarySession, closeBinary, openBinary } from '../../../../extensions/pi-rea/src/tools/session-tools.ts';
import { inspectAnalysisSettings, updateAnalysisSettings } from '../../../../extensions/pi-rea/src/tools/settings-tools.ts';
import { inspectSignature } from '../../../../extensions/pi-rea/src/tools/signature-tools.ts';
import { inspectSqliteDatabase } from '../../../../extensions/pi-rea/src/tools/sqlite-tools.ts';
import { verifyUnknownResolution } from '../../../../extensions/pi-rea/src/tools/unknown-tools.ts';
import { exportWebScriptsTool } from '../../../../extensions/pi-rea/src/tools/web-script-tools.ts';

const runtime = () => ({ name: 'pi-rea-differential', version: PI_REA_VERSION, cwd: process.cwd() });

const asResult = async (run, successKind = 'evidence') => {
  try {
    const toolResult = await run();
    if (toolResult.isError === true) {
      const text = toolResult.content?.[0]?.text;
      let body;
      try {
        body = JSON.parse(text).error ?? JSON.parse(text);
      } catch {
        body = { code: 'execution_failure', category: 'execution_failure', message: text ?? 'error', retryable: false, remediation: { action: 'inspect' } };
      }
      return { kind: 'error', body };
    }
    const body = toolResult.structuredContent;
    if (successKind === 'configuration') return { kind: 'configuration', body };
    if (body && typeof body === 'object' && typeof body.evidence_id === 'string') return { kind: 'evidence', body };
    if (successKind === 'evidence') return { kind: 'evidence', body };
    return { kind: successKind, body };
  } catch (error) {
    if (error instanceof ReaError) return { kind: 'error', body: error.payload };
    throw error;
  }
};

export const createSession = () => new ReaSession(runtime());

export const openTarget = async (session, path) => {
  session.openTarget(await identifyArtifact(path));
};

const refuse = (name) => (session, params) => asResult(() => refuseProviderTool(session, name, params ?? {}));

export const piHandlers = {
  binary_session: (session, params) => asResult(() => binarySession(session, params ?? {}), 'configuration'),
  open_binary: (session, params) => asResult(() => openBinary(session, params ?? {}, { cwd: process.cwd() }), 'configuration'),
  close_binary: (session, params) => asResult(() => closeBinary(session, params ?? {}), 'configuration'),
  inspect_plist: (session, params) => asResult(() => inspectPlist(session, params)),
  inspect_macho: (session) => asResult(() => inspectMacho(session, {})),
  list_architectures: (session) => asResult(() => listArchitectures(session, {})),
  inspect_pe_resources: (session, params) => asResult(() => inspectPeResources(session, params)),
  inspect_pe_imports: (session, params) => asResult(() => inspectPeImports(session, params)),
  inspect_pe_certificates: (session, params) => asResult(() => inspectPeCertificates(session, params)),
  inspect_pe_load_config: (session, params) => asResult(() => inspectPeLoadConfig(session, params)),
  inspect_elf_notes: (session, params) => asResult(() => inspectElfNotes(session, params)),
  inspect_rust_binary: (session, params) => asResult(() => inspectRustBinary(session, params)),
  inspect_apple_ips: (session, params) => asResult(() => inspectAppleIps(session, params)),
  inspect_byte_entropy: (session, params) => asResult(() => inspectByteEntropy(session, params)),
  analyze_javascript_application: (session, params) => asResult(() => analyzeJavascriptApplication(session, params)),
  inspect_artifact: (session, params) => asResult(() => inspectArtifact(session, params ?? {})),
  inspect_binary_layout: (session, params) => asResult(() => inspectBinaryLayout(session, params)),
  inspect_go_binary: (session, params) => asResult(() => inspectGoBinary(session, params)),
  inspect_web_network_capture: (session, params) => asResult(() => inspectWebNetworkCapture(session, params)),
  inspect_model_artifact: (session, params) => asResult(() => inspectModelArtifact(session, params)),
  inspect_sqlite_database: (session, params) => asResult(() => inspectSqliteDatabase(session, params)),
  inspect_erlang_beam: (session, params) => asResult(() => inspectErlangBeam(session, params)),
  inspect_desktop_application: (session, params) => asResult(() => inspectDesktopApplication(session, params)),
  inspect_gpu_code_objects: (session, params) => asResult(() => inspectGpuCodeObjects(session, params)),
  inspect_il2cpp_metadata: (session, params) => asResult(() => inspectIl2CppMetadata(session, params)),
  inspect_python_pyc: (session, params) => asResult(() => inspectPythonPyc(session, params)),
  inspect_kernel_module: (session, params) => asResult(() => inspectKernelModule(session, params)),
  inspect_analysis_settings: (session, params) => asResult(() => inspectAnalysisSettings(session, params ?? {}), 'configuration'),
  update_analysis_settings: (session, params) => asResult(() => updateAnalysisSettings(session, params), 'configuration'),
  verify_unknown_resolution: (session, params) => asResult(() => verifyUnknownResolution(session, params), 'configuration'),
  list_bookmarks: (session, params) => asResult(() => listBookmarks(session, params ?? {})),
  list_documents: (session, params) => asResult(() => listDocuments(session, params ?? {})),
  list_names: (session, params) => asResult(() => listNames(session, params ?? {})),
  list_procedures: (session, params) => asResult(() => listProcedures(session, params ?? {})),
  list_segments: (session, params) => asResult(() => listSegments(session, params ?? {})),
  list_strings: (session, params) => asResult(() => listStrings(session, params ?? {})),
  inspect_devicetree: (session, params) => asResult(() => inspectDevicetree(session, params)),
  inspect_apk_signature: (session, params) => asResult(() => inspectApkSignature(session, params)),
  inspect_electron_fuses: (session, params) => asResult(() => inspectElectronFuses(session, params)),
  inspect_signature: (session, params) => asResult(() => inspectSignature(session, params ?? {})),
  open_bundle_resources: (session, params) => asResult(() => openBundleResources(session, params), 'configuration'),
  inspect_keyed_archive: (session, params) => asResult(() => inspectKeyedArchive(session, params ?? {})),
  inspect_asset_catalog: (session, params) => asResult(() => inspectAssetCatalog(session, params ?? {})),
  inspect_managed_artifact: (session, params) => asResult(() => inspectManagedArtifact(session, params)),
  inspect_managed_members: (session, params) => asResult(() => inspectManagedMembers(session, params)),
  identify_flutter_build: (session, params) => asResult(() => identifyFlutterBuild(session, params)),
  inspect_dart_aot: (session, params) => asResult(() => inspectDartAot(session, params)),
  demangle_swift: (session, params) => asResult(() => demangleSwift(session, params)),
  decode_interface_builder: (session, params) => asResult(() => decodeInterfaceBuilder(session, params ?? {})),
  extract_artifact: (session, params) => asResult(() => extractArtifact(session, params ?? {})),
  compare_artifacts: (session, params) => asResult(() => compareArtifacts(session, params)),
  compare_bundles: (session, params) => asResult(() => compareBundles(session, params)),
  compare_managed_members: (session, params) => asResult(() => compareManagedMembers(session, params)),
  compare_javascript_export_shapes: (session, params) => asResult(() => compareJavascriptExportShapesTool(session, params)),
  compare_application_versions: (session, params) => asResult(() => compareApplicationVersionsTool(session, params)),
  compare_source_to_bundle: (session, params) => asResult(() => compareSourceToBundleTool(session, params)),
  export_web_scripts: (session, params) => asResult(() => exportWebScriptsTool(session, params)),
  project_apple_application_graph: (session, params) => asResult(() => projectAppleApplicationGraphTool(session, params)),
  inspect_recorded_crash: (session, params) => asResult(() => inspectRecordedCrash(session, params)),
  goto_address: refuse('goto_address'),
  read_bytes: refuse('read_bytes'),
  list_adb_devices: refuse('list_adb_devices'),
  start_frida_session: refuse('start_frida_session'),
  list_frida_devices: refuse('list_frida_devices'),
  list_browser_targets: refuse('list_browser_targets'),
  list_jeb_units: refuse('list_jeb_units'),
  execute_rizin_command: refuse('execute_rizin_command'),
  start_gdb_session: refuse('start_gdb_session'),
  list_cutter_sessions: (session, params) => asResult(() => listCutterSessions(session, params ?? {}), 'configuration'),
  inspect_apktool_client: refuse('inspect_apktool_client'),
  recover_javascript_sources: refuse('recover_javascript_sources'),
  inspect_firmware_regions: refuse('inspect_firmware_regions'),
  inspect_android_class: refuse('inspect_android_class'),
  inspect_wasm_artifact: refuse('inspect_wasm_artifact'),
  inspect_packet_capture: refuse('inspect_packet_capture'),
  inspect_packet_fields: refuse('inspect_packet_fields'),
  inspect_pcap_capture: refuse('inspect_pcap_capture'),
  inspect_pcap_client: refuse('inspect_pcap_client'),
  inspect_signal_decoders: refuse('inspect_signal_decoders'),
  decode_signal_recording: refuse('decode_signal_recording'),
  inspect_evm_interface: refuse('inspect_evm_interface'),
  observe_native_calls: refuse('observe_native_calls'),
  inspect_with_objdump: (session, params) => asResult(() => inspectWithObjdump(session, params ?? {})),
  inspect_native_exports: (session, params) => asResult(() => inspectNativeExports(session, params ?? {})),
  compare_functions: refuse('compare_functions'),
  export_environment_bundle: refuse('export_environment_bundle'),
};
