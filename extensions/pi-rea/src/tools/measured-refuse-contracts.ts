export const MEASURED_INPUT_CONTRACTS: Readonly<Record<string, (params: Record<string, unknown>) => Record<string, unknown>>> = {
  build_call_path: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool build_call_path do not match its advertised input schema.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for build_call_path; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'build_call_path' },
    details: {
      operation: 'build_call_path',
      issues: [
        {
          path: [],
          reason: 'invalid_value',
          message: 'functions: Too small: expected array to have >=1 items, start.address: Invalid input: expected string, received undefined, goal.address: Invalid input: expected string, received undefined',
        },
      ],
    },
  }),
  build_reconstruction_obligation_ledger: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool build_reconstruction_obligation_ledger do not match its advertised input schema.',
    retryable: false,
    remediation: {
      action: 'Read the declared input schema or CLI usage for build_reconstruction_obligation_ledger; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
    },
    recovery: { kind: 'inspect_input_contract', operation: 'build_reconstruction_obligation_ledger' },
    details: {
      operation: 'build_reconstruction_obligation_ledger',
      issues: [
        {
          path: [],
          reason: 'invalid_value',
          message: 'evidence_bundle: Invalid input: expected object, received string, manifest.bindings: Invalid input: expected array, received undefined, manifest.contradictions: Invalid input: expected array, received undefined',
        },
      ],
    },
  }),
  capture_browser_scenario: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool capture_browser_scenario do not match its advertised input schema.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for capture_browser_scenario; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'capture_browser_scenario' },
    details: {
      operation: 'capture_browser_scenario',
      issues: [
        {
          path: [],
          reason: 'invalid_value',
          message: "browser.mode: Invalid discriminator value. Expected 'launch' | 'connect', start_url: Invalid input: expected object, received string, actions: Too small: expected array to have >=1 items",
        },
      ],
    },
  }),
  capture_electron_scenario: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'Analysis input is invalid. Check the arguments and try again.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for capture_electron_scenario; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'capture_electron_scenario' },
    details: {
      operation: 'capture_electron_scenario',
      issues: [
        {
          path: ['executable_path'],
          reason: 'invalid_value',
          message:
            "executable_path /Users/josh-desktop/src/personal/pi-customizations/parity/pi-rea/fixtures/targets/minimal-elf.bin is not an executable file: EACCES: permission denied, access '/Users/josh-desktop/src/personal/pi-customizations/parity/pi-rea/fixtures/targets/minimal-elf.bin'",
        },
      ],
    },
  }),
  capture_process_scenario: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'Analysis input is invalid. Check the arguments and try again.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for capture_process_scenario; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'capture_process_scenario' },
    details: {
      operation: 'capture_process_scenario',
      issues: [
        {
          path: ['executable'],
          reason: 'invalid_value',
          message:
            'executable could not be resolved: pi-rea-executable; checked /Users/josh-desktop/.local/share/mise/installs/node/26.13.0/bin/pi-rea-executable (ENOENT); /Users/josh-desktop/src/personal/pi-customizations/node_modules/.bin/pi-rea-executable (ENOENT); /Users/josh-desktop/src/personal/node_modules/.bin/pi-rea-executable (ENOENT); /Users/josh-desktop/src/node_modules/.bin/pi-rea-executable (ENOENT); /Users/josh-desktop/node_modules/.bin/pi-rea-executable (ENOENT); /Users/node_modules/.bin/pi-rea-executable (ENOENT); /node_modules/.bin/pi-rea-executable (ENOENT); /Users/josh-desktop/.local/share/mise/installs/node/26.13.0/lib/node_modules/npm/node_modules/@npmcli/run-script/lib/node-gyp-bin/pi-rea-executable (ENOENT); /Users/josh-desktop/.local/share/mise/installs/node/lts/bin/pi-rea-executable (ENOENT); /Users/josh-desktop/.local/share/mise/installs/bun/1.4.2/bin/pi-rea-executable (ENOENT); /Users/josh-desktop/.pi/agent/bin/pi-rea-executable (ENOENT); /Users/josh-desktop/.grok/bin/pi-rea-executable (ENOENT); /Users/josh-desktop/.local/share/mise/installs/pnpm/latest/pi-rea-executable (ENOENT); /Users/josh-desktop/.local/share/mise/installs/node/lts/bin/pi-rea-executable (ENOENT); /Users/josh-desktop/.local/share/mise/installs/java/temurin-25/bin/pi-rea-executable (ENOENT); /Users/josh-desktop/.cargo/bin/pi-rea-executable (ENOENT); /Users/josh-desktop/.local/share/mise/installs/python/latest/bin/pi-rea-executable (ENOENT); /Users/josh-desktop/.local/share/mise/installs/bun/latest/bin/pi-rea-executable (ENOENT); /Users/josh-desktop/.local/share/mise/installs/go/1.26.8/bin/pi-rea-executable (ENOENT); /Users/josh-desktop/.local/share/mise/shims/pi-rea-executable (ENOENT); /opt/homebrew/opt/uutils-findutils/libexec/uubin/pi-rea-executable (ENOENT); /opt/homebrew/opt/uutils-diffutils/libexec/uubin/pi-rea-executable (ENOENT); /opt/homebrew/opt/uutils-coreutils/libexec/uubin/pi-rea-executable (ENOENT); /Users/josh-desktop/.local/bin/pi-rea-executable (ENOENT); /opt/homebrew/bin/pi-rea-executable (ENOENT); /opt/homebrew/sbin/pi-rea-executable (ENOENT); /usr/local/bin/pi-rea-executable (ENOENT); /System/Cryptexes/App/usr/bin/pi-rea-executable (ENOENT); /usr/bin/pi-rea-executable (ENOENT); /bin/pi-rea-executable (ENOENT); /usr/sbin/pi-rea-executable (ENOENT); /sbin/pi-rea-executable (ENOENT); /var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/local/bin/pi-rea-executable (ENOENT); /var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/bin/pi-rea-executable (ENOENT); /var/run/com.apple.security.cryptexd/codex.system/bootstrap/usr/appleinternal/bin/pi-rea-executable (ENOENT); /pkg/env/global/bin/pi-rea-executable (ENOENT); /Users/josh-desktop/Library/Android/sdk/platform-tools/pi-rea-executable (ENOENT); /Users/josh-desktop/Library/Android/sdk/emulator/pi-rea-executable (ENOENT); /Users/josh-desktop/Library/Android/sdk/cmdline-tools/latest/bin/pi-rea-executable (ENOENT); /Users/josh-desktop/.orbstack/bin/pi-rea-executable (ENOENT)',
        },
      ],
    },
  }),
  compare_process_captures: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool compare_process_captures do not match its advertised input schema.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for compare_process_captures; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'compare_process_captures' },
    details: {
      operation: 'compare_process_captures',
      issues: [
        {
          path: [],
          reason: 'invalid_value',
          message:
            'left.evidence_id: Invalid input: expected string, received undefined, left.subject: Invalid input: expected object, received undefined, left.provider: Invalid input: expected object, received undefined, left.analysis_profile: Invalid input: expected object, received undefined, left.predicate_type: Invalid input: expected string, received undefined, left.operation: Invalid input: expected string, received undefined, left.parameters: Invalid input: expected nonoptional, received undefined, left.raw_result: Invalid input: expected nonoptional, received undefined, left.normalized_result: Invalid input: expected nonoptional, received undefined, left.confidence: Invalid option: expected one of "observed"|"derived"|"inferred", left.authority: Invalid option: expected one of "shipped-artifact"|"controlled-replay"|"historical-reference"|"external-service"|"analyst-inference", left.environment: Invalid input: expected object, received undefined, left.limitations: Invalid input: expected array, received undefined, left.relationship_coverage: Invalid input: expected object, received undefined, left.locations: Invalid input: expected array, received undefined, left.evidence_links: Invalid input: expected array, received undefined, right.evidence_id: Invalid input: expected string, received undefined, right.subject: Invalid input: expected object, received undefined, right.provider: Invalid input: expected object, received undefined, right.analysis_profile: Invalid input: expected object, received undefined, right.predicate_type: Invalid input: expected string, received undefined, right.operation: Invalid input: expected string, received undefined, right.parameters: Invalid input: expected nonoptional, received undefined, right.raw_result: Invalid input: expected nonoptional, received undefined, right.normalized_result: Invalid input: expected nonoptional, received undefined, right.confidence: Invalid option: expected one of "observed"|"derived"|"inferred", right.authority: Invalid option: expected one of "shipped-artifact"|"controlled-replay"|"historical-reference"|"external-service"|"analyst-inference", right.environment: Invalid input: expected object, received undefined, right.limitations: Invalid input: expected array, received undefined, right.relationship_coverage: Invalid input: expected object, received undefined, right.locations: Invalid input: expected array, received undefined, right.evidence_links: Invalid input: expected array, received undefined',
        },
      ],
    },
  }),
  compare_wasm_interfaces: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool compare_wasm_interfaces do not match its advertised input schema.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for compare_wasm_interfaces; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'compare_wasm_interfaces' },
    details: { operation: 'compare_wasm_interfaces', issues: [{ path: [], reason: 'invalid_value', message: 'left: Invalid input, right: Invalid input, scope: Invalid option: expected one of "imports"|"exports"|"both"' }] },
  }),
  compare_web_captures: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool compare_web_captures do not match its advertised input schema.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for compare_web_captures; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'compare_web_captures' },
    details: {
      operation: 'compare_web_captures',
      issues: [
        {
          path: [],
          reason: 'invalid_value',
          message:
            '\u2716 Invalid input: expected object, received undefined\n  \u2192 at before\n\u2716 Invalid input: expected object, received undefined\n  \u2192 at after\n\u2716 Invalid input: expected object, received undefined\n  \u2192 at before_scenario\n\u2716 Invalid input: expected object, received undefined\n  \u2192 at after_scenario',
        },
      ],
    },
  }),
  compare_web_screenshots: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool compare_web_screenshots do not match its advertised input schema.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for compare_web_screenshots; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'compare_web_screenshots' },
    details: {
      operation: 'compare_web_screenshots',
      issues: [
        {
          path: [],
          reason: 'invalid_value',
          message:
            'before.sha256: Invalid input: expected string, received undefined, before.bytes: Invalid input: expected number, received undefined, before.media_type: Invalid input: expected "image/png", before.data_base64: Invalid input: expected string, received undefined, after.sha256: Invalid input: expected string, received undefined, after.bytes: Invalid input: expected number, received undefined, after.media_type: Invalid input: expected "image/png", after.data_base64: Invalid input: expected string, received undefined',
        },
      ],
    },
  }),
  correlate_static_and_runtime: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool correlate_static_and_runtime do not match its advertised input schema.',
    retryable: false,
    remediation: {
      action: 'Read the declared input schema or CLI usage for correlate_static_and_runtime; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
    },
    recovery: { kind: 'inspect_input_contract', operation: 'correlate_static_and_runtime' },
    details: {
      operation: 'correlate_static_and_runtime',
      issues: [
        {
          path: [],
          reason: 'invalid_value',
          message: 'static_comparisons: Too small: expected array to have >=1 items, runtime_comparisons: Too small: expected array to have >=1 items, mappings: Too small: expected array to have >=1 items',
        },
      ],
    },
  }),
  evaluate_reconstruction_coverage: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'Analysis input is invalid. Check the arguments and try again.',
    retryable: false,
    remediation: {
      action: 'Read the declared input schema or CLI usage for evaluate_reconstruction_coverage; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
    },
    recovery: { kind: 'inspect_input_contract', operation: 'evaluate_reconstruction_coverage' },
    details: {
      operation: 'evaluate_reconstruction_coverage',
      issues: [
        { path: ['coverage', 'evidence_bundle'], reason: 'missing_argument', expected: 'nonoptional' },
        { path: ['coverage', 'artifacts'], reason: 'missing_argument', expected: 'array' },
        { path: ['coverage', 'surfaces'], reason: 'missing_argument', expected: 'array' },
        { path: ['coverage', 'owners'], reason: 'missing_argument', expected: 'array' },
        { path: ['coverage', 'claims'], reason: 'missing_argument', expected: 'array' },
        { path: ['coverage', 'verifier_contracts'], reason: 'missing_argument', expected: 'array' },
        { path: ['coverage', 'verifier_results'], reason: 'missing_argument', expected: 'array' },
        { path: ['coverage', 'residual_unknown_ids'], reason: 'missing_argument', expected: 'array' },
        { path: ['coverage', 'contradictions'], reason: 'missing_argument', expected: 'array' },
        { path: ['coverage', 'package_proofs'], reason: 'missing_argument', expected: 'array' },
        { path: ['coverage', 'boundaries'], reason: 'missing_argument', expected: 'array' },
      ],
    },
  }),
  find_changed_behavior: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'Provide at least one comparison Evidence item.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for find_changed_behavior; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'find_changed_behavior' },
    details: { operation: 'find_changed_behavior', issues: [{ path: ['comparisons'], reason: 'out_of_range', minimum: 1 }] },
  }),
  import_managed_reconstruction: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool import_managed_reconstruction do not match its advertised input schema.',
    retryable: false,
    remediation: {
      action: 'Read the declared input schema or CLI usage for import_managed_reconstruction; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
    },
    recovery: { kind: 'inspect_input_contract', operation: 'import_managed_reconstruction' },
    details: {
      operation: 'import_managed_reconstruction',
      issues: [
        {
          path: [],
          reason: 'invalid_value',
          message:
            'static_members.evidence_id: Invalid input: expected string, received undefined, static_members.subject: Invalid input: expected object, received undefined, static_members.provider: Invalid input: expected object, received undefined, static_members.analysis_profile: Invalid input: expected object, received undefined, static_members.predicate_type: Invalid input: expected string, received undefined, static_members.operation: Invalid input: expected string, received undefined, static_members.parameters: Invalid input: expected nonoptional, received undefined, static_members.raw_result: Invalid input: expected nonoptional, received undefined, static_members.normalized_result: Invalid input: expected nonoptional, received undefined, static_members.confidence: Invalid option: expected one of "observed"|"derived"|"inferred", static_members.authority: Invalid option: expected one of "shipped-artifact"|"controlled-replay"|"historical-reference"|"external-service"|"analyst-inference", static_members.environment: Invalid input: expected object, received undefined, static_members.limitations: Invalid input: expected array, received undefined, static_members.relationship_coverage: Invalid input: expected object, received undefined, static_members.locations: Invalid input: expected array, received undefined, static_members.evidence_links: Invalid input: expected array, received undefined, decompiler.name: Invalid input: expected string, received undefined, decompiler.family: Invalid option: expected one of "ilspy"|"dnspy"|"dnlib"|"mono-cecil"|"other", methods: Too small: expected array to have >=1 items',
        },
      ],
    },
  }),
  inspect_managed_native_boundaries: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'Analysis input is invalid. Check the arguments and try again.',
    retryable: false,
    remediation: {
      action: 'Read the declared input schema or CLI usage for inspect_managed_native_boundaries; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
    },
    recovery: { kind: 'inspect_input_contract', operation: 'inspect_managed_native_boundaries' },
    details: { operation: 'inspect_managed_native_boundaries', issues: [{ path: ['path'], reason: 'missing_argument', message: 'Provide a managed PE/CLI path or first select one with inspect_managed_artifact.' }] },
  }),
  match_native_functions: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'Analysis input is invalid. Check the arguments and try again.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for match_native_functions; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'match_native_functions' },
    details: { operation: 'match_native_functions', issues: [{ path: ['left'], reason: 'invalid_type', expected: 'object' }] },
  }),
  project_android_application_graph: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool project_android_application_graph do not match its advertised input schema.',
    retryable: false,
    remediation: {
      action: 'Read the declared input schema or CLI usage for project_android_application_graph; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
    },
    recovery: { kind: 'inspect_input_contract', operation: 'project_android_application_graph' },
    details: { operation: 'project_android_application_graph', issues: [{ path: [], reason: 'invalid_value', message: 'inventory_evidence: Too small: expected array to have >=1 items' }] },
  }),
  project_harmony_application_graph: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool project_harmony_application_graph do not match its advertised input schema.',
    retryable: false,
    remediation: {
      action: 'Read the declared input schema or CLI usage for project_harmony_application_graph; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
    },
    recovery: { kind: 'inspect_input_contract', operation: 'project_harmony_application_graph' },
    details: { operation: 'project_harmony_application_graph', issues: [{ path: [], reason: 'invalid_value', message: 'inventory_evidence: Too small: expected array to have >=1 items' }] },
  }),
  project_managed_application_graph: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool project_managed_application_graph do not match its advertised input schema.',
    retryable: false,
    remediation: {
      action: 'Read the declared input schema or CLI usage for project_managed_application_graph; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
    },
    recovery: { kind: 'inspect_input_contract', operation: 'project_managed_application_graph' },
    details: { operation: 'project_managed_application_graph', issues: [{ path: [], reason: 'invalid_value', message: 'Invalid input' }] },
  }),
  reconcile_javascript_runtime: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool reconcile_javascript_runtime do not match its advertised input schema.',
    retryable: false,
    remediation: {
      action: 'Read the declared input schema or CLI usage for reconcile_javascript_runtime; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
    },
    recovery: { kind: 'inspect_input_contract', operation: 'reconcile_javascript_runtime' },
    details: {
      operation: 'reconcile_javascript_runtime',
      issues: [
        {
          path: [],
          reason: 'invalid_value',
          message: 'static_layers: Too small: expected array to have >=1 items, runtime_observations: Too small: expected array to have >=1 items, static_layers: Exactly one application static layer is required',
        },
      ],
    },
  }),
  trace_application_feature: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool trace_application_feature do not match its advertised input schema.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for trace_application_feature; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'trace_application_feature' },
    details: { operation: 'trace_application_feature', issues: [{ path: [], reason: 'invalid_value', message: 'seed: Invalid input, application: Invalid input' }] },
  }),
  trace_javascript_semantics: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool trace_javascript_semantics do not match its advertised input schema.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for trace_javascript_semantics; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'trace_javascript_semantics' },
    details: {
      operation: 'trace_javascript_semantics',
      issues: [
        {
          path: [],
          reason: 'invalid_value',
          message: 'application: Invalid input, query.seed: Invalid input: expected object, received undefined, query.direction: Invalid option: expected one of "backward-provenance"|"forward-influence"|"callers"|"ownership"',
        },
      ],
    },
  }),
  trace_web_module_imports: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'Analysis input is invalid. Check the arguments and try again.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for trace_web_module_imports; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'trace_web_module_imports' },
    details: {
      operation: 'trace_web_module_imports',
      issues: [
        {
          path: ['manifest_path'],
          reason: 'invalid_format',
          message: '/Users/josh-desktop/src/personal/pi-customizations/parity/pi-rea/fixtures/targets/minimal-elf.bin: Unexpected token \'\u007f\', "\u007fELF\u0002\u0001\u0001\u0000\u0000\u0000"... is not valid JSON',
        },
      ],
    },
  }),
  trace_web_source_location: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'Analysis input is invalid. Check the arguments and try again.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for trace_web_source_location; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'trace_web_source_location' },
    details: {
      operation: 'trace_web_source_location',
      issues: [
        { path: ['source_map', 'path'], reason: 'missing_argument', expected: 'string' },
        { path: ['source_map', 'url'], reason: 'missing_argument', expected: 'string' },
        { path: ['generated_position', 'line'], reason: 'missing_argument', expected: 'number' },
        { path: ['generated_position', 'column'], reason: 'missing_argument', expected: 'number' },
      ],
    },
  }),
  verify_managed_native_boundaries: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool verify_managed_native_boundaries do not match its advertised input schema.',
    retryable: false,
    remediation: {
      action: 'Read the declared input schema or CLI usage for verify_managed_native_boundaries; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.',
    },
    recovery: { kind: 'inspect_input_contract', operation: 'verify_managed_native_boundaries' },
    details: {
      operation: 'verify_managed_native_boundaries',
      issues: [
        {
          path: [],
          reason: 'invalid_value',
          message:
            'managed_boundaries.evidence_id: Invalid input: expected string, received undefined, managed_boundaries.subject: Invalid input: expected object, received undefined, managed_boundaries.provider: Invalid input: expected object, received undefined, managed_boundaries.analysis_profile: Invalid input: expected object, received undefined, managed_boundaries.predicate_type: Invalid input: expected string, received undefined, managed_boundaries.operation: Invalid input: expected string, received undefined, managed_boundaries.parameters: Invalid input: expected nonoptional, received undefined, managed_boundaries.raw_result: Invalid input: expected nonoptional, received undefined, managed_boundaries.normalized_result: Invalid input: expected nonoptional, received undefined, managed_boundaries.confidence: Invalid option: expected one of "observed"|"derived"|"inferred", managed_boundaries.authority: Invalid option: expected one of "shipped-artifact"|"controlled-replay"|"historical-reference"|"external-service"|"analyst-inference", managed_boundaries.environment: Invalid input: expected object, received undefined, managed_boundaries.limitations: Invalid input: expected array, received undefined, managed_boundaries.relationship_coverage: Invalid input: expected object, received undefined, managed_boundaries.locations: Invalid input: expected array, received undefined, managed_boundaries.evidence_links: Invalid input: expected array, received undefined, native_observations: Too small: expected array to have >=1 items',
        },
      ],
    },
  }),
  verify_reconstruction: () => ({
    code: 'invalid_request',
    category: 'invalid_input',
    message: 'The arguments for MCP tool verify_reconstruction do not match its advertised input schema.',
    retryable: false,
    remediation: { action: 'Read the declared input schema or CLI usage for verify_reconstruction; if using MCP and the catalog may be stale, call tools/list. Correct the listed fields, then retry. Do not repeat the unchanged call.' },
    recovery: { kind: 'inspect_input_contract', operation: 'verify_reconstruction' },
    details: {
      operation: 'verify_reconstruction',
      issues: [{ path: [], reason: 'invalid_value', message: 'specification.name: Invalid input: expected string, received undefined, specification.claims: Invalid input: expected array, received undefined' }],
    },
  }),
};
