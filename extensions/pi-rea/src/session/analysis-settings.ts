import { createRequire } from 'node:module';

import { invalidRequest } from '../contract/errors.ts';
import { DEFAULT_RESPONSE_BUDGET_BYTES, responseBudgetBytes } from '../contract/results.ts';

export const ANALYSIS_SETTING_IDS = [
  'asar.max_header_bytes',
  'ghidra.startup_timeout_ms',
  'hopper.startup_timeout_ms',
  'ghidra.decompile_timeout_seconds',
  'jadx.operation_timeout_ms',
  'regex.matching_deadline_ms',
  'regex.worker_heap_request_mib',
  'capture.decoder_old_generation_mib',
  'javascript.analysis_timeout_ms',
  'javascript.max_heap_mb',
  'wasm.command_timeout_ms',
] as const;

export type AnalysisSettingId = (typeof ANALYSIS_SETTING_IDS)[number];

export type AnalysisSettingUnit = 'bytes' | 'ms' | 'seconds' | 'MiB';
export type AnalysisSettingAppliesAt = 'next_operation' | 'next_worker' | 'next_startup';
export type AnalysisSettingSource = 'default' | 'setting' | 'runtime' | 'invalid';

export interface AnalysisSettingDefinition {
  readonly id: AnalysisSettingId;
  readonly defaultValue: number | null;
  readonly minimum: number;
  readonly maximum: number;
  readonly unit: AnalysisSettingUnit;
  readonly appliesAt: AnalysisSettingAppliesAt;
  readonly provider: string;
  readonly relatedProviders?: readonly string[];
  readonly operations: readonly string[];
  readonly environment?: string;
  readonly parameter?: string;
  readonly nullable?: boolean;
}

const TIMER_MAX = 2_147_483_647;

export const ANALYSIS_SETTING_DEFINITIONS: Readonly<Record<AnalysisSettingId, AnalysisSettingDefinition>> = {
  'asar.max_header_bytes': {
    id: 'asar.max_header_bytes',
    defaultValue: 16 * 1024 * 1024,
    minimum: 1,
    maximum: 256 * 1024 * 1024,
    unit: 'bytes',
    appliesAt: 'next_operation',
    provider: 'rea-artifact-graph',
    relatedProviders: ['rea-javascript-application', 'rea-cdp-electron', 'rea-v8-inspector'],
    operations: ['open_binary', 'inspect_artifact', 'inventory_artifact', 'extract_artifact', 'analyze_javascript_application', 'inspect_electron_page', 'observe_javascript_runtime'],
    environment: 'REA_ASAR_MAX_HEADER_BYTES',
  },
  'ghidra.startup_timeout_ms': {
    id: 'ghidra.startup_timeout_ms',
    defaultValue: 330_000,
    minimum: 1,
    maximum: TIMER_MAX,
    unit: 'ms',
    appliesAt: 'next_startup',
    provider: 'ghidra',
    operations: ['binary_overview', 'list_documents', 'list_procedures', 'search_procedures', 'list_strings', 'search_strings', 'procedure_pseudo_code', 'procedure_assembly', 'analyze_function', 'decompile_all', 'trace_native_values'],
    environment: 'REA_GHIDRA_STARTUP_TIMEOUT_MS',
  },
  'hopper.startup_timeout_ms': {
    id: 'hopper.startup_timeout_ms',
    defaultValue: 120_000,
    minimum: 1,
    maximum: TIMER_MAX,
    unit: 'ms',
    appliesAt: 'next_startup',
    provider: 'hopper',
    operations: ['binary_overview', 'list_documents', 'list_procedures', 'search_procedures', 'list_strings', 'search_strings', 'procedure_pseudo_code', 'procedure_assembly', 'analyze_function', 'decompile_all', 'trace_native_values'],
    environment: 'REA_HOPPER_STARTUP_TIMEOUT_MS',
  },
  'ghidra.decompile_timeout_seconds': {
    id: 'ghidra.decompile_timeout_seconds',
    defaultValue: null,
    minimum: 1,
    maximum: Math.floor(TIMER_MAX / 1000),
    unit: 'seconds',
    appliesAt: 'next_operation',
    provider: 'ghidra',
    operations: ['procedure_pseudo_code', 'analyze_function', 'decompile_all', 'trace_native_values'],
    environment: 'REA_GHIDRA_DECOMPILE_TIMEOUT_SECONDS',
    nullable: true,
  },
  'jadx.operation_timeout_ms': {
    id: 'jadx.operation_timeout_ms',
    defaultValue: 120_000,
    minimum: 1,
    maximum: TIMER_MAX,
    unit: 'ms',
    appliesAt: 'next_operation',
    provider: 'jadx',
    operations: ['inspect_android_package', 'search_android_classes', 'inspect_android_class', 'inspect_android_method', 'trace_android_references'],
    environment: 'REA_JADX_OPERATION_TIMEOUT_MS',
  },
  'regex.matching_deadline_ms': {
    id: 'regex.matching_deadline_ms',
    defaultValue: 5_000,
    minimum: 1,
    maximum: TIMER_MAX,
    unit: 'ms',
    appliesAt: 'next_operation',
    provider: 'regex',
    relatedProviders: ['ida', 'hopper', 'kuna'],
    operations: ['search_strings', 'search_procedures'],
    environment: 'REA_REGEX_MATCHING_DEADLINE_MS',
  },
  'regex.worker_heap_request_mib': {
    id: 'regex.worker_heap_request_mib',
    defaultValue: 128,
    minimum: 7,
    maximum: 16_384,
    unit: 'MiB',
    appliesAt: 'next_worker',
    provider: 'regex',
    relatedProviders: ['ida', 'hopper', 'kuna'],
    operations: ['search_strings', 'search_procedures'],
    environment: 'REA_REGEX_WORKER_HEAP_REQUEST_MIB',
  },
  'capture.decoder_old_generation_mib': {
    id: 'capture.decoder_old_generation_mib',
    defaultValue: 192,
    minimum: 8,
    maximum: 16_384,
    unit: 'MiB',
    appliesAt: 'next_worker',
    provider: 'capture',
    operations: ['inspect_web_network_capture'],
    environment: 'REA_CAPTURE_DECODER_OLD_GENERATION_MIB',
  },
  'javascript.analysis_timeout_ms': {
    id: 'javascript.analysis_timeout_ms',
    defaultValue: 300_000,
    minimum: 1,
    maximum: TIMER_MAX,
    unit: 'ms',
    appliesAt: 'next_operation',
    provider: 'rea-javascript-application',
    operations: ['analyze_javascript_application'],
    parameter: 'analysis_timeout_ms',
  },
  'javascript.max_heap_mb': {
    id: 'javascript.max_heap_mb',
    defaultValue: 1024,
    minimum: 128,
    maximum: 16_384,
    unit: 'MiB',
    appliesAt: 'next_worker',
    provider: 'rea-javascript-application',
    operations: ['analyze_javascript_application'],
    parameter: 'max_heap_mb',
  },
  'wasm.command_timeout_ms': {
    id: 'wasm.command_timeout_ms',
    defaultValue: 30_000,
    minimum: 1,
    maximum: TIMER_MAX,
    unit: 'ms',
    appliesAt: 'next_operation',
    provider: 'wabt-artifact',
    operations: ['inspect_wasm_artifact'],
    parameter: 'command_timeout_ms',
  },
};

export interface SettingDescriptor {
  readonly setting: AnalysisSettingId;
  readonly value?: number | null;
  readonly launch_value?: number | null;
  readonly default_value: number | null;
  readonly source: AnalysisSettingSource;
  readonly unit: AnalysisSettingUnit;
  readonly minimum: number;
  readonly maximum: number;
  readonly applies_at: AnalysisSettingAppliesAt;
  readonly provider: string;
  readonly operations: readonly string[];
  readonly environment?: string;
  readonly parameter?: string;
  readonly agent_editable: true;
  readonly configuration_error?: Record<string, unknown>;
}

export interface AnalysisSettingsReport {
  readonly revision: number;
  readonly scope: 'rea-runtime';
  readonly active_values: { readonly status: 'not_observed' };
  readonly settings: readonly SettingDescriptor[];
  readonly constraints?: readonly RuntimeConstraint[];
}

export interface RuntimeConstraint {
  readonly control: string;
  readonly authority: 'operator' | 'external' | 'fixed';
  readonly value: number | null;
  readonly unit: string;
  readonly observation: 'known' | 'unknown';
  readonly recovery: string;
}

export type SettingChange = { readonly setting: AnalysisSettingId; readonly action: 'set'; readonly value: number | null } | { readonly setting: AnalysisSettingId; readonly action: 'reset' };

export interface UpdateAnalysisSettingsParams {
  readonly changes: readonly SettingChange[];
  readonly expected_revision?: number;
}

const isSettingId = (value: unknown): value is AnalysisSettingId => typeof value === 'string' && (ANALYSIS_SETTING_IDS as readonly string[]).includes(value);

const parseLaunch = (definition: AnalysisSettingDefinition, environment: NodeJS.ProcessEnv): { readonly value: number | null; readonly source: AnalysisSettingSource } | { readonly error: Record<string, unknown> } => {
  if (definition.environment === undefined) {
    return { value: definition.defaultValue, source: 'default' };
  }
  const raw = environment[definition.environment];
  if (raw === undefined) return { value: definition.defaultValue, source: 'default' };
  if (definition.nullable === true && (raw === '' || raw === 'null')) {
    return { value: null, source: 'setting' };
  }
  if (!/^-?[0-9]+$/.test(raw)) {
    return {
      error: {
        code: 'configuration_invalid',
        category: 'invalid_input',
        message: `Invalid ${definition.environment}`,
        retryable: false,
        remediation: { action: `Expected an integer from ${definition.minimum} to ${definition.maximum} ${definition.unit}` },
        details: {
          settings: [{ setting: definition.environment, constraint: `Expected an integer from ${definition.minimum} to ${definition.maximum} ${definition.unit}` }],
        },
      },
    };
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < definition.minimum || value > definition.maximum) {
    return {
      error: {
        code: 'configuration_invalid',
        category: 'invalid_input',
        message: `Invalid ${definition.environment}`,
        retryable: false,
        remediation: { action: `Expected an integer from ${definition.minimum} to ${definition.maximum} ${definition.unit}` },
        details: {
          settings: [{ setting: definition.environment, constraint: `Expected an integer from ${definition.minimum} to ${definition.maximum} ${definition.unit}` }],
        },
      },
    };
  }
  return { value, source: 'setting' };
};

const parentHeapBytes = (): number | null => {
  try {
    const require = createRequire(import.meta.url);
    const v8 = require('node:v8') as { getHeapStatistics?: () => { heap_size_limit: number } };
    return v8.getHeapStatistics?.().heap_size_limit ?? null;
  } catch {
    return null;
  }
};

export const runtimeConstraints = (environment: NodeJS.ProcessEnv = process.env): readonly RuntimeConstraint[] => {
  let budget: number;
  try {
    budget = responseBudgetBytes(environment);
  } catch {
    budget = DEFAULT_RESPONSE_BUDGET_BYTES;
  }
  const heap = parentHeapBytes();
  return [
    {
      control: 'REA_MCP_MAX_RESPONSE_BYTES',
      authority: 'operator',
      value: budget,
      unit: 'bytes',
      observation: 'known',
      recovery: 'Change the launch environment and restart REA with a matching client receive buffer. Prefer retained Evidence, paging or export for completed results.',
    },
    {
      control: 'mcp.client_deadline',
      authority: 'external',
      value: null,
      unit: 'ms',
      observation: 'unknown',
      recovery: 'The MCP host owns its tool-call deadline. REA cannot observe or raise it. Allow execution, cleanup and delivery headroom.',
    },
    {
      control: 'mcp.client_receive_buffer',
      authority: 'external',
      value: null,
      unit: 'bytes',
      observation: 'unknown',
      recovery: 'The MCP host owns its receive buffer; raising a REA output budget alone does not raise it.',
    },
    {
      control: 'node.parent_heap',
      authority: 'operator',
      value: heap,
      unit: 'bytes',
      observation: heap === null ? 'unknown' : 'known',
      recovery: 'This is the current process heap ceiling, not available memory. On Node, change --max-old-space-size at launch and restart REA. Worker heap settings do not raise it.',
    },
    {
      control: 'json.maximum_depth',
      authority: 'fixed',
      value: 1000,
      unit: 'levels',
      observation: 'known',
      recovery: "REA's JSON representation has this fixed nesting policy. This release has no runtime override; increasing byte or worker budgets does not change it.",
    },
  ];
};

export class AnalysisSettingsStore {
  #revision = 0;
  #overrides: Readonly<Partial<Record<AnalysisSettingId, number | null>>> = Object.freeze({});
  readonly #launch: ReadonlyMap<AnalysisSettingId, ReturnType<typeof parseLaunch>>;

  constructor(environment: NodeJS.ProcessEnv = process.env) {
    this.#launch = new Map(ANALYSIS_SETTING_IDS.map((id) => [id, parseLaunch(ANALYSIS_SETTING_DEFINITIONS[id], environment)]));
  }

  get revision(): number {
    return this.#revision;
  }

  inspect(input: { readonly settings?: readonly string[]; readonly operation?: string; readonly provider?: string } = {}): AnalysisSettingsReport {
    const settings = ANALYSIS_SETTING_IDS.filter((id) => {
      const definition = ANALYSIS_SETTING_DEFINITIONS[id];
      if (input.settings !== undefined && !input.settings.includes(id)) return false;
      if (input.provider !== undefined && input.provider !== definition.provider && definition.relatedProviders?.includes(input.provider) !== true) {
        return false;
      }
      if (input.operation !== undefined && !definition.operations.includes(input.operation)) return false;
      return true;
    }).map((id) => this.describe(id));

    return {
      revision: this.#revision,
      scope: 'rea-runtime',
      active_values: { status: 'not_observed' },
      settings,
      constraints: [...runtimeConstraints()],
    };
  }

  update(params: UpdateAnalysisSettingsParams): AnalysisSettingsReport & {
    readonly changed: boolean;
    readonly changes: readonly { readonly setting: AnalysisSettingId; readonly old_value?: number | null; readonly new_value?: number | null }[];
    readonly active_work_changed: false;
    readonly rea_restart_required: false;
  } {
    if (!Array.isArray(params.changes) || params.changes.length === 0) {
      throw invalidRequest('update_analysis_settings requires a non-empty changes array.', { parameter: 'changes' });
    }
    if (params.changes.length > ANALYSIS_SETTING_IDS.length) {
      throw invalidRequest(`update_analysis_settings accepts at most ${ANALYSIS_SETTING_IDS.length} changes.`, { parameter: 'changes' });
    }
    if (params.expected_revision !== undefined && params.expected_revision !== this.#revision) {
      throw invalidRequest(`Settings revision conflict: expected ${params.expected_revision}, current ${this.#revision}. Inspect settings before retrying.`, {
        operation: 'update_analysis_settings',
        issues: [{ path: ['expected_revision'], reason: 'invalid_value', expected: this.#revision }],
      });
    }

    const ids: AnalysisSettingId[] = [];
    for (const change of params.changes) {
      if (!isSettingId(change.setting)) {
        throw invalidRequest(`Unknown analysis setting ${JSON.stringify((change as { setting?: unknown }).setting)}.`, { parameter: 'changes' });
      }
      ids.push(change.setting);
      this.assertChange(change);
    }
    if (new Set(ids).size !== ids.length) {
      throw invalidRequest('Each setting may occur only once in an atomic update.', {
        operation: 'update_analysis_settings',
        issues: [{ path: ['changes'], reason: 'invalid_value' }],
      });
    }

    const previous = new Map(ids.map((id) => [id, this.describe(id).value]));
    const next: Partial<Record<AnalysisSettingId, number | null>> = { ...this.#overrides };
    for (const change of params.changes) {
      if (change.action === 'reset') delete next[change.setting];
      else next[change.setting] = change.value;
    }
    const changed = ids.some((id) => next[id] !== this.#overrides[id]);
    if (changed) {
      this.#revision += 1;
      this.#overrides = Object.freeze(next);
    }

    const { constraints: _constraints, ...report } = this.inspect({ settings: ids });
    return {
      ...report,
      changed,
      changes: ids.map((setting) => {
        const oldValue = previous.get(setting);
        const newValue = this.describe(setting).value;
        return {
          setting,
          ...(oldValue === undefined ? {} : { old_value: oldValue }),
          ...(newValue === undefined ? {} : { new_value: newValue }),
        };
      }),
      active_work_changed: false,
      rea_restart_required: false,
    };
  }

  private assertChange(change: SettingChange): void {
    const definition = ANALYSIS_SETTING_DEFINITIONS[change.setting];
    if (change.action === 'reset') return;
    if (change.value === null) {
      if (definition.nullable !== true) {
        throw invalidRequest(`Setting ${change.setting} does not accept null.`, { parameter: 'changes', setting: change.setting });
      }
      return;
    }
    if (typeof change.value !== 'number' || !Number.isInteger(change.value) || change.value < definition.minimum || change.value > definition.maximum) {
      throw invalidRequest(`Setting ${change.setting} must be an integer from ${definition.minimum} to ${definition.maximum}.`, {
        parameter: 'changes',
        setting: change.setting,
        minimum: definition.minimum,
        maximum: definition.maximum,
      });
    }
  }

  private describe(id: AnalysisSettingId): SettingDescriptor {
    const definition = ANALYSIS_SETTING_DEFINITIONS[id];
    const launch = this.#launch.get(id)!;
    const override = this.#overrides[id];
    if ('error' in launch) {
      return {
        setting: id,
        default_value: definition.defaultValue,
        source: 'invalid',
        configuration_error: launch.error,
        unit: definition.unit,
        minimum: definition.minimum,
        maximum: definition.maximum,
        applies_at: definition.appliesAt,
        provider: definition.provider,
        operations: [...definition.operations],
        ...(definition.environment === undefined ? {} : { environment: definition.environment }),
        ...(definition.parameter === undefined ? {} : { parameter: definition.parameter }),
        agent_editable: true,
      };
    }
    const launchValue = launch.value;
    const value = override === undefined ? launchValue : override;
    return {
      setting: id,
      ...(value === undefined ? {} : { value }),
      launch_value: launchValue,
      default_value: definition.defaultValue,
      source: override === undefined ? launch.source : 'runtime',
      unit: definition.unit,
      minimum: definition.minimum,
      maximum: definition.maximum,
      applies_at: definition.appliesAt,
      provider: definition.provider,
      operations: [...definition.operations],
      ...(definition.environment === undefined ? {} : { environment: definition.environment }),
      ...(definition.parameter === undefined ? {} : { parameter: definition.parameter }),
      agent_editable: true,
    };
  }
}
