import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { NOTEPAD_APP, target } from './paths.mjs';
import {
  ensureAltGoPeFixture,
  ensureDevicetreeFixture,
  ensureEmptyEvidenceBundles,
  ensureFixtureAppZip,
  ensureGoMachoFixtures,
  ensureJsCompareFixtures,
  ensureMinimalElfCoreFixture,
  ensureWebPageCaptureFixture,
  resetWebScriptOutputDirectory,
} from './ensure-fixtures.mjs';
import { classifyOracle, invokeReaAgentsCli, invokeReaAgentsMcp, invokeReaAgentsMcpSession } from './invoke-rea-agents.mjs';
import { createSession, openTarget, piHandlers } from './invoke-pi-rea.mjs';

const pathWithoutAndroidAdb = () => {
  const nodeDir = dirname(process.execPath);
  const filtered = (process.env.PATH ?? '')
    .split(':')
    .filter((part) => part !== '' && !/Android\/sdk|platform-tools/i.test(part));
  if (!filtered.includes(nodeDir)) filtered.unshift(nodeDir);
  return filtered.join(':');
};

const adbMissingOracleEnv = () => ({ PATH: pathWithoutAndroidAdb(), REA_ADB_PATH: '' });

const fridaMissingOracleEnv = () => ({ NODE_OPTIONS: '--no-addons' });

const OBSERVE_NATIVE_ARGS = {
  breakpoints: [{ kind: 'function', name: 'main' }],
  duration_ms: 100,
  max_events: 1,
};

const READ_BYTES_ARGS = { address: '0x0', length: 1 };

let cachedGoEvidence = null;
const goBinaryEvidence = async () => {
  if (cachedGoEvidence !== null) return cachedGoEvidence;
  const classified = classifyOracle(
    (await invokeReaAgentsCli(['inspect-go-binary', target('pe/fixture-go-pe.exe')])).parsed,
  );
  if (classified.kind !== 'evidence') throw new Error('inspect-go-binary fixture did not return Evidence');
  cachedGoEvidence = classified.body;
  return cachedGoEvidence;
};

const invalidExportEnvironmentArgs = async () => {
  const evidence = await goBinaryEvidence();
  const evidencePath = join(tmpdir(), 'pi-rea-export-env-invalid-capture.json');
  const outputDirectory = join(tmpdir(), 'pi-rea-export-env-invalid-out');
  writeFileSync(evidencePath, `${JSON.stringify(evidence)}\n`);
  rmSync(outputDirectory, { recursive: true, force: true });
  mkdirSync(dirname(outputDirectory), { recursive: true });
  return {
    source: { kind: 'evidence-file', path: evidencePath },
    output_directory: outputDirectory,
  };
};

const importHistoricalSourceGraph = async (root) => {
  const parsed = (await invokeReaAgentsCli(['import-reference-source', root])).parsed;
  if (parsed?.ok !== true || parsed.data?.schema !== 'HistoricalSourceGraph') {
    throw new Error(`import-reference-source failed for ${root}`);
  }
  return parsed.data;
};

const oracleCli = async (cliArgs) => classifyOracle((await invokeReaAgentsCli(cliArgs)).parsed);

const oracleMcp = async (toolName, args = {}) => {
  const result = await invokeReaAgentsMcp(toolName, args);
  return { kind: result.kind, body: result.body };
};

/** @typedef {{ id: string, tool: string, prepare?: () => void | Promise<void>, runPiRea: () => Promise<{kind:string, body:unknown}>, runOracle: () => Promise<{kind:string, body:unknown}> }} DiffCase */

const SESSION_LIST_TOOLS = [
  'list_bookmarks',
  'list_documents',
  'list_names',
  'list_procedures',
  'list_segments',
  'list_strings',
];

const closedSessionListCases = () =>
  SESSION_LIST_TOOLS.map((tool) => ({
    id: `${tool}--closed-session`,
    tool,
    runPiRea: async () => piHandlers[tool](createSession(), {}),
    runOracle: () => oracleMcp(tool, {}),
  }));

const openBinaryNoBridgeListCases = () =>
  SESSION_LIST_TOOLS.map((tool) => ({
    id: `${tool}--open-binary-no-bridge`,
    tool,
    runPiRea: async () => {
      const session = createSession();
      await openTarget(session, target('minimal-elf.bin'));
      return piHandlers[tool](session, {});
    },
    runOracle: async () => {
      const [, listed] = await invokeReaAgentsMcpSession([
        ['open_binary', { path: target('minimal-elf.bin') }],
        [tool, {}],
      ]);
      return { kind: listed.kind, body: listed.body };
    },
  }));

/** @type {DiffCase[]} */
export const CASES = [
  {
    id: 'inspect_plist--sample-xml',
    tool: 'inspect_plist',
    prepare: ensureGoMachoFixtures,
    runPiRea: async () => {
      const { thin } = ensureGoMachoFixtures();
      const session = createSession();
      await openTarget(session, thin);
      return piHandlers.inspect_plist(session, { path: target('plist/sample-xml.plist') });
    },
    runOracle: () => oracleCli(['inspect-plist', target('plist/sample-xml.plist')]),
  },
  {
    id: 'inspect_macho--thin-go',
    tool: 'inspect_macho',
    prepare: ensureGoMachoFixtures,
    runPiRea: async () => {
      const { thin } = ensureGoMachoFixtures();
      const session = createSession();
      await openTarget(session, thin);
      return piHandlers.inspect_macho(session);
    },
    runOracle: () => {
      const { thin } = ensureGoMachoFixtures();
      return oracleCli(['inspect-macho', thin]);
    },
  },
  {
    id: 'list_architectures--thin-go',
    tool: 'list_architectures',
    prepare: ensureGoMachoFixtures,
    runPiRea: async () => {
      const { thin } = ensureGoMachoFixtures();
      const session = createSession();
      await openTarget(session, thin);
      return piHandlers.list_architectures(session);
    },
    runOracle: () => {
      const { thin } = ensureGoMachoFixtures();
      return oracleCli(['list-architectures', thin]);
    },
  },
  {
    id: 'list_architectures--fat-go',
    tool: 'list_architectures',
    prepare: ensureGoMachoFixtures,
    runPiRea: async () => {
      const { fat } = ensureGoMachoFixtures();
      const session = createSession();
      await openTarget(session, fat);
      return piHandlers.list_architectures(session);
    },
    runOracle: () => {
      const { fat } = ensureGoMachoFixtures();
      return oracleCli(['list-architectures', fat]);
    },
  },
  {
    id: 'inspect_pe_resources--resources',
    tool: 'inspect_pe_resources',
    runPiRea: async () => {
      const session = createSession();
      const path = target('pe/fixture-pe-resources.exe');
      return piHandlers.inspect_pe_resources(session, { path, max_file_bytes: 67_108_864, max_entries: 4096 });
    },
    runOracle: () =>
      oracleCli([
        'inspect-pe-resources',
        target('pe/fixture-pe-resources.exe'),
        '--max-file-bytes',
        '67108864',
        '--max-entries',
        '4096',
      ]),
  },
  {
    id: 'inspect_pe_imports--fixture-go-pe',
    tool: 'inspect_pe_imports',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_pe_imports(session, { path: target('pe/fixture-go-pe.exe') });
    },
    runOracle: () => oracleCli(['inspect-pe-imports', target('pe/fixture-go-pe.exe')]),
  },
  {
    id: 'inspect_pe_certificates--signed',
    tool: 'inspect_pe_certificates',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_pe_certificates(session, { path: target('pe/fixture-pe-certificate.exe') });
    },
    runOracle: () => oracleCli(['inspect-pe-certificates', target('pe/fixture-pe-certificate.exe')]),
  },
  {
    id: 'inspect_pe_load_config--fixture-go-pe',
    tool: 'inspect_pe_load_config',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_pe_load_config(session, { path: target('pe/fixture-go-pe.exe') });
    },
    runOracle: () => oracleCli(['inspect-pe-load-config', target('pe/fixture-go-pe.exe')]),
  },
  {
    id: 'inspect_elf_notes--notes-and-dep',
    tool: 'inspect_elf_notes',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_elf_notes(session, { path: target('elf/notes-and-dep.so') });
    },
    runOracle: () => oracleCli(['inspect-elf-notes', target('elf/notes-and-dep.so')]),
  },
  {
    id: 'inspect_rust_binary--auditable',
    tool: 'inspect_rust_binary',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_rust_binary(session, { path: target('rust/auditable.elf') });
    },
    runOracle: () => oracleCli(['inspect-rust-binary', target('rust/auditable.elf')]),
  },
  {
    id: 'inspect_apple_ips--sample-crash',
    tool: 'inspect_apple_ips',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_apple_ips(session, { path: target('ips/sample-crash.ips') });
    },
    runOracle: () => oracleCli(['inspect-apple-ips', target('ips/sample-crash.ips')]),
  },
  {
    id: 'inspect_byte_entropy--mixed',
    tool: 'inspect_byte_entropy',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_byte_entropy(session, { path: target('entropy/mixed.bin'), block_size: 4096 });
    },
    runOracle: () => oracleCli(['inspect-byte-entropy', target('entropy/mixed.bin'), '--block-size', '4096']),
  },
  {
    id: 'analyze_javascript_application--notepad',
    tool: 'analyze_javascript_application',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.analyze_javascript_application(session, { input_path: NOTEPAD_APP, format: 'directory' });
    },
    runOracle: () => oracleCli(['analyze-javascript-application', NOTEPAD_APP, '--artifact-format', 'directory']),
  },
  {
    id: 'inspect_artifact--fixture-zip',
    tool: 'inspect_artifact',
    runPiRea: async () => {
      const session = createSession();
      await openTarget(session, target('fixture.zip'));
      return piHandlers.inspect_artifact(session, { integrity_policy: 'fail' });
    },
    runOracle: () => oracleCli(['inspect-artifact', target('fixture.zip'), '--integrity-policy', 'fail']),
  },
  {
    id: 'inspect_binary_layout--minimal-elf',
    tool: 'inspect_binary_layout',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_binary_layout(session, { path: target('minimal-elf.bin') });
    },
    runOracle: () => oracleCli(['inspect-binary-layout', target('minimal-elf.bin')]),
  },
  {
    id: 'inspect_go_binary--fixture-go-pe',
    tool: 'inspect_go_binary',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_go_binary(session, { path: target('pe/fixture-go-pe.exe') });
    },
    runOracle: () => oracleCli(['inspect-go-binary', target('pe/fixture-go-pe.exe')]),
  },
  {
    id: 'inspect_web_network_capture--sample-har',
    tool: 'inspect_web_network_capture',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_web_network_capture(session, {
        capture_path: target('sample.har'),
        format: 'har',
      });
    },
    runOracle: () => oracleCli(['inspect-web-network-capture', target('sample.har'), 'har']),
  },
  {
    id: 'inspect_model_artifact--tiny-gguf',
    tool: 'inspect_model_artifact',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_model_artifact(session, { path: target('models/tiny.gguf') });
    },
    runOracle: () => oracleCli(['inspect-model-artifact', target('models/tiny.gguf')]),
  },
  {
    id: 'inspect_sqlite_database--fixture-db',
    tool: 'inspect_sqlite_database',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_sqlite_database(session, { path: target('fixture.db') });
    },
    runOracle: () => oracleCli(['inspect-sqlite-database', target('fixture.db')]),
  },
  {
    id: 'inspect_erlang_beam--demo',
    tool: 'inspect_erlang_beam',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_erlang_beam(session, { path: target('beam/demo.beam') });
    },
    runOracle: () => oracleCli(['inspect-erlang-beam', target('beam/demo.beam')]),
  },
  {
    id: 'inspect_desktop_application--electron-app',
    tool: 'inspect_desktop_application',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_desktop_application(session, { path: target('desktop/electron-app') });
    },
    runOracle: () => oracleCli(['inspect-desktop-application', target('desktop/electron-app')]),
  },
  {
    id: 'inspect_gpu_code_objects--sample-ptx',
    tool: 'inspect_gpu_code_objects',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_gpu_code_objects(session, { path: target('gpu/sample.ptx') });
    },
    runOracle: () => oracleCli(['inspect-gpu-code-objects', target('gpu/sample.ptx')]),
  },
  {
    id: 'inspect_il2cpp_metadata--global-metadata',
    tool: 'inspect_il2cpp_metadata',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_il2cpp_metadata(session, { path: target('il2cpp/global-metadata.dat') });
    },
    runOracle: () => oracleCli(['inspect-il2cpp-metadata', target('il2cpp/global-metadata.dat')]),
  },
  {
    id: 'inspect_python_pyc--sample',
    tool: 'inspect_python_pyc',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_python_pyc(session, { path: target('pyc/sample.pyc') });
    },
    runOracle: () => oracleCli(['inspect-python-pyc', target('pyc/sample.pyc')]),
  },
  {
    id: 'inspect_kernel_module--demo-ko',
    tool: 'inspect_kernel_module',
    runPiRea: async () => {
      const session = createSession();
      return piHandlers.inspect_kernel_module(session, { path: target('kernel/demo.ko') });
    },
    runOracle: () => oracleCli(['inspect-kernel-module', target('kernel/demo.ko')]),
  },
  {
    id: 'inspect_analysis_settings--asar-max-header',
    tool: 'inspect_analysis_settings',
    runPiRea: async () =>
      piHandlers.inspect_analysis_settings(createSession(), { settings: ['asar.max_header_bytes'] }),
    runOracle: () => oracleMcp('inspect_analysis_settings', { settings: ['asar.max_header_bytes'] }),
  },
  {
    id: 'update_analysis_settings--asar-set-restore',
    tool: 'update_analysis_settings',
    runPiRea: async () => {
      const session = createSession();
      const updated = await piHandlers.update_analysis_settings(session, {
        changes: [{ setting: 'asar.max_header_bytes', action: 'set', value: 33_554_432 }],
      });
      await piHandlers.update_analysis_settings(session, {
        changes: [{ setting: 'asar.max_header_bytes', action: 'reset' }],
        expected_revision: updated.body.revision,
      });
      return updated;
    },
    runOracle: async () => {
      const [updated] = await invokeReaAgentsMcpSession([
        ['update_analysis_settings', { changes: [{ setting: 'asar.max_header_bytes', action: 'set', value: 33_554_432 }] }],
        [
          'update_analysis_settings',
          { changes: [{ setting: 'asar.max_header_bytes', action: 'reset' }], expected_revision: 1 },
        ],
      ]);
      return { kind: updated.kind, body: updated.body };
    },
  },
  {
    id: 'verify_unknown_resolution--missing-id',
    tool: 'verify_unknown_resolution',
    runPiRea: async () =>
      piHandlers.verify_unknown_resolution(createSession(), { unknown_id: `unk_${'0'.repeat(64)}` }),
    runOracle: () => oracleMcp('verify_unknown_resolution', { unknown_id: `unk_${'0'.repeat(64)}` }),
  },
  ...closedSessionListCases(),
  ...openBinaryNoBridgeListCases(),
  {
    id: 'inspect_devicetree--board-dtb',
    tool: 'inspect_devicetree',
    prepare: ensureDevicetreeFixture,
    runPiRea: async () => {
      const path = ensureDevicetreeFixture();
      return piHandlers.inspect_devicetree(createSession(), { path });
    },
    runOracle: () => oracleCli(['inspect-devicetree', ensureDevicetreeFixture()]),
  },
  {
    id: 'inspect_apk_signature--v1-only',
    tool: 'inspect_apk_signature',
    runPiRea: async () => piHandlers.inspect_apk_signature(createSession(), { path: target('apk/v1-only.apk') }),
    runOracle: () => oracleCli(['inspect-apk-signature', target('apk/v1-only.apk')]),
  },
  {
    id: 'inspect_electron_fuses--fuse-thin',
    tool: 'inspect_electron_fuses',
    runPiRea: async () => piHandlers.inspect_electron_fuses(createSession(), { path: target('electron/fuse-thin.bin') }),
    runOracle: () => oracleCli(['inspect-electron-fuses', target('electron/fuse-thin.bin')]),
  },
  {
    id: 'inspect_signature--thin-go',
    tool: 'inspect_signature',
    prepare: ensureGoMachoFixtures,
    runPiRea: async () => {
      const { thin } = ensureGoMachoFixtures();
      const session = createSession();
      await openTarget(session, thin);
      return piHandlers.inspect_signature(session, {});
    },
    runOracle: () => {
      const { thin } = ensureGoMachoFixtures();
      return oracleCli(['inspect-signature', thin]);
    },
  },
  {
    id: 'open_bundle_resources--fixture-app',
    tool: 'open_bundle_resources',
    runPiRea: async () => piHandlers.open_bundle_resources(createSession(), { path: target('bundle/Fixture.app') }),
    runOracle: () => oracleMcp('open_bundle_resources', { path: target('bundle/Fixture.app') }),
  },
  {
    id: 'inspect_keyed_archive--fixture-app',
    tool: 'inspect_keyed_archive',
    runPiRea: async () => {
      const session = createSession();
      await piHandlers.open_bundle_resources(session, { path: target('bundle/Fixture.app') });
      return piHandlers.inspect_keyed_archive(session, { path: 'Contents/Resources/archive.plist' });
    },
    runOracle: () =>
      oracleCli(['inspect-keyed-archive', target('bundle/Fixture.app'), 'Contents/Resources/archive.plist']),
  },
  {
    id: 'inspect_asset_catalog--fixture-app',
    tool: 'inspect_asset_catalog',
    runPiRea: async () => {
      const session = createSession();
      await piHandlers.open_bundle_resources(session, { path: target('bundle/Fixture.app') });
      return piHandlers.inspect_asset_catalog(session, {});
    },
    runOracle: () => oracleCli(['inspect-asset-catalog', target('bundle/Fixture.app')]),
  },
  {
    id: 'inspect_managed_artifact--fixture-go-pe',
    tool: 'inspect_managed_artifact',
    runPiRea: async () =>
      piHandlers.inspect_managed_artifact(createSession(), { path: target('pe/fixture-go-pe.exe') }),
    runOracle: () => oracleCli(['inspect-managed-artifact', target('pe/fixture-go-pe.exe')]),
  },
  {
    id: 'inspect_managed_members--fixture-go-pe',
    tool: 'inspect_managed_members',
    runPiRea: async () =>
      piHandlers.inspect_managed_members(createSession(), { path: target('pe/fixture-go-pe.exe') }),
    runOracle: () => oracleCli(['inspect-managed-members', target('pe/fixture-go-pe.exe')]),
  },
  {
    id: 'identify_flutter_build--demo-apk',
    tool: 'identify_flutter_build',
    runPiRea: async () =>
      piHandlers.identify_flutter_build(createSession(), { path: target('flutter/demo.apk') }),
    runOracle: () => oracleCli(['identify-flutter-build', target('flutter/demo.apk')]),
  },
  {
    id: 'inspect_dart_aot--demo-apk',
    tool: 'inspect_dart_aot',
    runPiRea: async () =>
      piHandlers.inspect_dart_aot(createSession(), { path: target('flutter/demo.apk'), abi: 'arm64-v8a' }),
    runOracle: () => oracleCli(['inspect-dart-aot', target('flutter/demo.apk'), '--abi', 'arm64-v8a']),
  },
  {
    id: 'demangle_swift--thin-go',
    tool: 'demangle_swift',
    prepare: ensureGoMachoFixtures,
    runPiRea: async () => {
      const { thin } = ensureGoMachoFixtures();
      const session = createSession();
      await openTarget(session, thin);
      return piHandlers.demangle_swift(session, { symbols: ['_$sSSN', 'not_swift', '_'] });
    },
    runOracle: () => {
      const { thin } = ensureGoMachoFixtures();
      return oracleCli(['demangle-swift', thin, '_$sSSN', 'not_swift', '_']);
    },
  },
  {
    id: 'decode_interface_builder--fixture-app',
    tool: 'decode_interface_builder',
    runPiRea: async () => {
      const session = createSession();
      await piHandlers.open_bundle_resources(session, { path: target('bundle/Fixture.app') });
      return piHandlers.decode_interface_builder(session, {
        detail: 'complete',
        max_documents: 64,
        max_objects: 20000,
        max_connections: 40000,
      });
    },
    runOracle: () =>
      oracleCli([
        'decode-interface-builder',
        target('bundle/Fixture.app'),
        '--max-documents',
        '64',
        '--max-objects',
        '20000',
        '--max-connections',
        '40000',
      ]),
  },
  {
    id: 'extract_artifact--fixture-zip',
    tool: 'extract_artifact',
    runPiRea: async () => {
      const session = createSession();
      await openTarget(session, target('fixture.zip'));
      return piHandlers.extract_artifact(session, { integrity_policy: 'fail' });
    },
    runOracle: () => oracleCli(['extract-artifact', target('fixture.zip'), '--integrity-policy', 'fail']),
  },
  {
    id: 'compare_artifacts--fixture-zip',
    tool: 'compare_artifacts',
    runPiRea: async () => {
      const session = createSession();
      await openTarget(session, target('fixture.zip'));
      const left = await piHandlers.inspect_artifact(session, { integrity_policy: 'fail' });
      const right = await piHandlers.inspect_artifact(session, { integrity_policy: 'fail' });
      return piHandlers.compare_artifacts(session, { left: left.body, right: right.body });
    },
    runOracle: async () => {
      const leftCalls = await invokeReaAgentsMcpSession([
        ['open_binary', { path: target('fixture.zip') }],
        ['inspect_artifact', { integrity_policy: 'fail' }],
      ]);
      const rightCalls = await invokeReaAgentsMcpSession([
        ['open_binary', { path: target('fixture.zip') }],
        ['inspect_artifact', { integrity_policy: 'fail' }],
      ]);
      return oracleMcp('compare_artifacts', { left: leftCalls[1].body, right: rightCalls[1].body });
    },
  },
  {
    id: 'compare_bundles--empty',
    tool: 'compare_bundles',
    prepare: ensureEmptyEvidenceBundles,
    runPiRea: async () => {
      const { left, right } = ensureEmptyEvidenceBundles();
      return piHandlers.compare_bundles(createSession(), { left_bundle_path: left, right_bundle_path: right });
    },
    runOracle: () => {
      const { left, right } = ensureEmptyEvidenceBundles();
      return oracleMcp('compare_bundles', { left_bundle_path: left, right_bundle_path: right });
    },
  },
  {
    id: 'compare_managed_members--fixture-go-pe',
    tool: 'compare_managed_members',
    prepare: ensureAltGoPeFixture,
    runPiRea: async () => {
      const { base, alt } = ensureAltGoPeFixture();
      const session = createSession();
      const left = await piHandlers.inspect_managed_members(session, { path: base });
      const right = await piHandlers.inspect_managed_members(session, { path: alt });
      return piHandlers.compare_managed_members(session, { left: left.body, right: right.body });
    },
    runOracle: () => {
      const { base, alt } = ensureAltGoPeFixture();
      return oracleCli(['compare-managed-members', base, alt]);
    },
  },
  {
    id: 'inspect_recorded_crash--minimal-core',
    tool: 'inspect_recorded_crash',
    prepare: ensureMinimalElfCoreFixture,
    runPiRea: async () =>
      piHandlers.inspect_recorded_crash(createSession(), { path: ensureMinimalElfCoreFixture() }),
    runOracle: () => oracleCli(['inspect-recorded-crash', ensureMinimalElfCoreFixture()]),
  },
  {
    id: 'compare_javascript_export_shapes--js-compare',
    tool: 'compare_javascript_export_shapes',
    prepare: ensureJsCompareFixtures,
    runPiRea: async () => {
      const { left, right } = ensureJsCompareFixtures();
      const session = createSession();
      const leftEv = await piHandlers.analyze_javascript_application(session, { input_path: left, format: 'directory' });
      const rightEv = await piHandlers.analyze_javascript_application(session, { input_path: right, format: 'directory' });
      return piHandlers.compare_javascript_export_shapes(session, {
        left: leftEv.body,
        right: rightEv.body,
        left_module_path: 'src/main.js',
        left_export_name: 'shape',
        right_module_path: 'src/main.js',
        right_export_name: 'shape',
      });
    },
    runOracle: async () => {
      const { left, right } = ensureJsCompareFixtures();
      const leftEv = classifyOracle(
        (await invokeReaAgentsCli(['analyze-javascript-application', left, '--artifact-format', 'directory'])).parsed,
      );
      const rightEv = classifyOracle(
        (await invokeReaAgentsCli(['analyze-javascript-application', right, '--artifact-format', 'directory'])).parsed,
      );
      return oracleMcp('compare_javascript_export_shapes', {
        left: leftEv.body,
        right: rightEv.body,
        left_module_path: 'src/main.js',
        left_export_name: 'shape',
        right_module_path: 'src/main.js',
        right_export_name: 'shape',
      });
    },
  },
  {
    id: 'compare_application_versions--js-compare',
    tool: 'compare_application_versions',
    prepare: ensureJsCompareFixtures,
    runPiRea: async () => {
      const { left, right } = ensureJsCompareFixtures();
      const session = createSession();
      const leftEv = await piHandlers.analyze_javascript_application(session, { input_path: left, format: 'directory' });
      const rightEv = await piHandlers.analyze_javascript_application(session, { input_path: right, format: 'directory' });
      return piHandlers.compare_application_versions(session, { left: leftEv.body, right: rightEv.body });
    },
    runOracle: async () => {
      const { left, right } = ensureJsCompareFixtures();
      const leftEv = classifyOracle(
        (await invokeReaAgentsCli(['analyze-javascript-application', left, '--artifact-format', 'directory'])).parsed,
      );
      const rightEv = classifyOracle(
        (await invokeReaAgentsCli(['analyze-javascript-application', right, '--artifact-format', 'directory'])).parsed,
      );
      return oracleMcp('compare_application_versions', { left: leftEv.body, right: rightEv.body });
    },
  },
  {
    id: 'compare_source_to_bundle--js-compare',
    tool: 'compare_source_to_bundle',
    prepare: ensureJsCompareFixtures,
    runPiRea: async () => {
      const { left } = ensureJsCompareFixtures();
      const reference = await importHistoricalSourceGraph(left);
      const session = createSession();
      const app = await piHandlers.analyze_javascript_application(session, { input_path: left, format: 'directory' });
      return piHandlers.compare_source_to_bundle(session, { reference, application: app.body });
    },
    runOracle: async () => {
      const { left } = ensureJsCompareFixtures();
      const reference = await importHistoricalSourceGraph(left);
      const app = classifyOracle(
        (await invokeReaAgentsCli(['analyze-javascript-application', left, '--artifact-format', 'directory'])).parsed,
      );
      return oracleMcp('compare_source_to_bundle', { reference, application: app.body });
    },
  },
  {
    id: 'export_web_scripts--page-capture',
    tool: 'export_web_scripts',
    prepare: ensureWebPageCaptureFixture,
    runPiRea: async () => {
      const { capturePath, outputDirectory } = ensureWebPageCaptureFixture();
      resetWebScriptOutputDirectory(outputDirectory);
      return piHandlers.export_web_scripts(createSession(), {
        capture_path: capturePath,
        output_directory: outputDirectory,
      });
    },
    runOracle: async () => {
      const { capturePath, outputDirectory } = ensureWebPageCaptureFixture();
      resetWebScriptOutputDirectory(outputDirectory);
      return oracleCli(['export-web-scripts', capturePath, outputDirectory]);
    },
  },
  {
    id: 'project_apple_application_graph--fixture-app-zip',
    tool: 'project_apple_application_graph',
    prepare: ensureFixtureAppZip,
    runPiRea: async () => {
      const zip = ensureFixtureAppZip();
      const session = createSession();
      await openTarget(session, zip);
      const inventory = await piHandlers.inspect_artifact(session, { integrity_policy: 'fail' });
      return piHandlers.project_apple_application_graph(session, { inventory_evidence: [inventory.body] });
    },
    runOracle: async () => {
      const zip = ensureFixtureAppZip();
      const inventory = classifyOracle(
        (await invokeReaAgentsCli(['inspect-artifact', zip, '--integrity-policy', 'fail'])).parsed,
      );
      return oracleMcp('project_apple_application_graph', { inventory_evidence: [inventory.body] });
    },
  },
  {
    id: 'goto_address--closed-session',
    tool: 'goto_address',
    runPiRea: async () => piHandlers.goto_address(createSession(), { address: '0x0' }),
    runOracle: () => oracleMcp('goto_address', { address: '0x0' }),
  },
  {
    id: 'goto_address--open-binary-no-bridge',
    tool: 'goto_address',
    runPiRea: async () => {
      const session = createSession();
      await openTarget(session, target('minimal-elf.bin'));
      return piHandlers.goto_address(session, { address: '0x0' });
    },
    runOracle: async () => {
      const [, listed] = await invokeReaAgentsMcpSession([
        ['open_binary', { path: target('minimal-elf.bin') }],
        ['goto_address', { address: '0x0' }],
      ]);
      return { kind: listed.kind, body: listed.body };
    },
  },
  {
    id: 'list_adb_devices--missing',
    tool: 'list_adb_devices',
    runPiRea: async () => piHandlers.list_adb_devices(createSession(), {}),
    runOracle: () => invokeReaAgentsMcp('list_adb_devices', {}, { env: adbMissingOracleEnv() }),
  },
  {
    id: 'start_frida_session--missing',
    tool: 'start_frida_session',
    runPiRea: async () =>
      piHandlers.start_frida_session(createSession(), { mode: 'attach', device_id: 'local', pid: 999_999_999 }),
    runOracle: () =>
      oracleMcp('start_frida_session', { mode: 'attach', device_id: 'local', pid: 999_999_999 }),
  },
  {
    id: 'list_browser_targets--unreachable',
    tool: 'list_browser_targets',
    runPiRea: async () => piHandlers.list_browser_targets(createSession(), { cdp_endpoint: 'http://127.0.0.1:1' }),
    runOracle: () => oracleMcp('list_browser_targets', { cdp_endpoint: 'http://127.0.0.1:1' }),
  },
  {
    id: 'list_jeb_units--missing',
    tool: 'list_jeb_units',
    runPiRea: async () => piHandlers.list_jeb_units(createSession(), {}),
    runOracle: () => oracleMcp('list_jeb_units', {}),
  },
  {
    id: 'execute_rizin_command--missing',
    tool: 'execute_rizin_command',
    runPiRea: async () =>
      piHandlers.execute_rizin_command(createSession(), { path: target('minimal-elf.bin'), command: 'i' }),
    runOracle: () => oracleMcp('execute_rizin_command', { path: target('minimal-elf.bin'), command: 'i' }),
  },
  {
    id: 'start_gdb_session--missing',
    tool: 'start_gdb_session',
    runPiRea: async () => piHandlers.start_gdb_session(createSession(), {}),
    runOracle: () => oracleMcp('start_gdb_session', {}),
  },
  {
    id: 'inspect_wasm_artifact--missing',
    tool: 'inspect_wasm_artifact',
    runPiRea: async () => piHandlers.inspect_wasm_artifact(createSession(), { path: target('minimal-elf.bin') }),
    runOracle: () => oracleMcp('inspect_wasm_artifact', { path: target('minimal-elf.bin') }),
  },
  {
    id: 'inspect_packet_capture--missing',
    tool: 'inspect_packet_capture',
    runPiRea: async () =>
      piHandlers.inspect_packet_capture(createSession(), {
        path: target('minimal-elf.bin'),
        fields: ['frame.number'],
      }),
    runOracle: () =>
      oracleMcp('inspect_packet_capture', { path: target('minimal-elf.bin'), fields: ['frame.number'] }),
  },
  {
    id: 'inspect_pcap_client--missing',
    tool: 'inspect_pcap_client',
    runPiRea: async () => piHandlers.inspect_pcap_client(createSession(), {}),
    runOracle: () => oracleMcp('inspect_pcap_client', {}),
  },
  {
    id: 'inspect_signal_decoders--missing',
    tool: 'inspect_signal_decoders',
    runPiRea: async () => piHandlers.inspect_signal_decoders(createSession(), {}),
    runOracle: () => oracleMcp('inspect_signal_decoders', {}),
  },
  {
    id: 'inspect_evm_interface--missing',
    tool: 'inspect_evm_interface',
    runPiRea: async () =>
      piHandlers.inspect_evm_interface(createSession(), { path: target('minimal-elf.bin'), encoding: 'raw' }),
    runOracle: () => oracleMcp('inspect_evm_interface', { path: target('minimal-elf.bin'), encoding: 'raw' }),
  },
  {
    id: 'observe_native_calls--closed-session',
    tool: 'observe_native_calls',
    runPiRea: async () => piHandlers.observe_native_calls(createSession(), OBSERVE_NATIVE_ARGS),
    runOracle: () => oracleMcp('observe_native_calls', OBSERVE_NATIVE_ARGS),
  },
  {
    id: 'observe_native_calls--open-binary-no-bridge',
    tool: 'observe_native_calls',
    runPiRea: async () => {
      const session = createSession();
      await openTarget(session, target('minimal-elf.bin'));
      return piHandlers.observe_native_calls(session, OBSERVE_NATIVE_ARGS);
    },
    runOracle: async () => {
      const [, observed] = await invokeReaAgentsMcpSession([
        ['open_binary', { path: target('minimal-elf.bin') }],
        ['observe_native_calls', OBSERVE_NATIVE_ARGS],
      ]);
      return { kind: observed.kind, body: observed.body };
    },
  },
  {
    id: 'inspect_with_objdump--gap',
    tool: 'inspect_with_objdump',
    runPiRea: async () =>
      piHandlers.inspect_with_objdump(createSession(), {
        operation: 'file_headers',
        path: target('minimal-elf.bin'),
      }),
    runOracle: () =>
      oracleMcp('inspect_with_objdump', { operation: 'file_headers', path: target('minimal-elf.bin') }),
  },
  {
    id: 'list_cutter_sessions--missing',
    tool: 'list_cutter_sessions',
    runPiRea: async () => piHandlers.list_cutter_sessions(createSession(), {}),
    runOracle: () => oracleMcp('list_cutter_sessions', {}),
  },
  {
    id: 'inspect_apktool_client--missing',
    tool: 'inspect_apktool_client',
    runPiRea: async () => piHandlers.inspect_apktool_client(createSession(), {}),
    runOracle: () => oracleMcp('inspect_apktool_client', {}),
  },
  {
    id: 'recover_javascript_sources--missing',
    tool: 'recover_javascript_sources',
    runPiRea: async () =>
      piHandlers.recover_javascript_sources(createSession(), {
        path: target('minimal-elf.bin'),
        output_directory: '/tmp/pi-rea-wakaru-out',
      }),
    runOracle: () =>
      oracleMcp('recover_javascript_sources', {
        path: target('minimal-elf.bin'),
        output_directory: '/tmp/pi-rea-wakaru-out',
      }),
  },
  {
    id: 'inspect_firmware_regions--missing',
    tool: 'inspect_firmware_regions',
    runPiRea: async () =>
      piHandlers.inspect_firmware_regions(createSession(), { path: target('minimal-elf.bin') }),
    runOracle: () => oracleMcp('inspect_firmware_regions', { path: target('minimal-elf.bin') }),
  },
  {
    id: 'inspect_android_class--missing',
    tool: 'inspect_android_class',
    runPiRea: async () =>
      piHandlers.inspect_android_class(createSession(), {
        path: target('apk/v1-only.apk'),
        class_name: 'a.b.C',
      }),
    runOracle: () =>
      oracleMcp('inspect_android_class', { path: target('apk/v1-only.apk'), class_name: 'a.b.C' }),
  },
  {
    id: 'list_frida_devices--missing',
    tool: 'list_frida_devices',
    runPiRea: async () => piHandlers.list_frida_devices(createSession(), {}),
    runOracle: () => invokeReaAgentsMcp('list_frida_devices', {}, { env: fridaMissingOracleEnv() }),
  },
  {
    id: 'read_bytes--closed-session',
    tool: 'read_bytes',
    runPiRea: async () => piHandlers.read_bytes(createSession(), READ_BYTES_ARGS),
    runOracle: () => oracleMcp('read_bytes', READ_BYTES_ARGS),
  },
  {
    id: 'read_bytes--open-binary-no-bridge',
    tool: 'read_bytes',
    runPiRea: async () => {
      const session = createSession();
      await openTarget(session, target('minimal-elf.bin'));
      return piHandlers.read_bytes(session, READ_BYTES_ARGS);
    },
    runOracle: async () => {
      const [, listed] = await invokeReaAgentsMcpSession([
        ['open_binary', { path: target('minimal-elf.bin') }],
        ['read_bytes', READ_BYTES_ARGS],
      ]);
      return { kind: listed.kind, body: listed.body };
    },
  },
  {
    id: 'inspect_native_exports--gap',
    tool: 'inspect_native_exports',
    runPiRea: async () =>
      piHandlers.inspect_native_exports(createSession(), { path: target('minimal-elf.bin') }),
    runOracle: () => oracleMcp('inspect_native_exports', { path: target('minimal-elf.bin') }),
  },
  {
    id: 'inspect_packet_fields--missing',
    tool: 'inspect_packet_fields',
    runPiRea: async () => piHandlers.inspect_packet_fields(createSession(), { kind: 'protocols' }),
    runOracle: () => oracleMcp('inspect_packet_fields', { kind: 'protocols' }),
  },
  {
    id: 'decode_signal_recording--missing',
    tool: 'decode_signal_recording',
    runPiRea: async () =>
      piHandlers.decode_signal_recording(createSession(), {
        path: target('minimal-elf.bin'),
        decoders: 'uart',
      }),
    runOracle: () =>
      oracleMcp('decode_signal_recording', { path: target('minimal-elf.bin'), decoders: 'uart' }),
  },
  {
    id: 'inspect_pcap_capture--missing',
    tool: 'inspect_pcap_capture',
    runPiRea: async () =>
      piHandlers.inspect_pcap_capture(createSession(), { path: target('minimal-elf.bin') }),
    runOracle: () => oracleMcp('inspect_pcap_capture', { path: target('minimal-elf.bin') }),
  },
  {
    id: 'compare_functions--gap',
    tool: 'compare_functions',
    runPiRea: async () => {
      const evidence = await goBinaryEvidence();
      return piHandlers.compare_functions(createSession(), { left: evidence, right: evidence });
    },
    runOracle: async () => {
      const evidence = await goBinaryEvidence();
      return oracleMcp('compare_functions', { left: evidence, right: evidence });
    },
  },
  {
    id: 'export_environment_bundle--invalid-capture',
    tool: 'export_environment_bundle',
    runPiRea: async () =>
      piHandlers.export_environment_bundle(createSession(), await invalidExportEnvironmentArgs()),
    runOracle: async () => oracleMcp('export_environment_bundle', await invalidExportEnvironmentArgs()),
  },
];
