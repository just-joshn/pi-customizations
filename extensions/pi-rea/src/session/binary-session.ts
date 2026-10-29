import { randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { catalogDigest, loadCatalog, type ToolCatalog, type ToolContract } from '../contract/catalog.ts';
import type { ArtifactIdentity } from '../targets/artifact-identity.ts';
import { isProviderRefuseTool, providerRefuseAvailability } from '../tools/provider-refuse-tools.ts';
import { AnalysisSettingsStore } from './analysis-settings.ts';
import { type EvidenceBundle, EvidenceLedger } from './evidence-ledger.ts';
import { UnknownLedger } from './unknown-ledger.ts';

export const SERVER_NAME = 'pi-rea';

export const PI_REA_VERSION: string = (() => {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version?: string };
    return manifest.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

export const PROMPT_COUNT: number = (() => {
  try {
    return readdirSync(new URL('../../prompts', import.meta.url)).filter((name) => name.endsWith('.md')).length;
  } catch {
    return 0;
  }
})();

export const NOT_IMPLEMENTED = 'not_implemented';
export const TARGET_REQUIRED = 'target_required';
export const PROVIDER_UNAVAILABLE = 'provider_unavailable';
export const AVAILABLE = 'available';

export const HOST_CAPABILITY_LIMITATION = 'pi-rea has not implemented this host capability; parity/pi-rea/ records the gap.';
export const PROVIDER_LIMITATION = 'pi-rea has no deep-analysis provider bridge; parity/pi-rea/ records the scope boundary.';

export const CLIENT_FEATURES: Readonly<Record<string, boolean>> = { elicitation_form: false, elicitation_url: false, roots: false, sampling: false };

const TARGET_REQUIRED_TOOLS = new Set<string>(['demangle_swift']);

const ANNOTATION_NAMES = [
  ['readOnlyHint', 'read_only'],
  ['destructiveHint', 'destructive'],
  ['idempotentHint', 'idempotent'],
  ['openWorldHint', 'open_world'],
] as const;

const EFFECT_NAMES = ['mutatesTarget', 'mutatesSession', 'writesFilesystem', 'launchesProcess', 'accessesNetwork', 'changesUiState', 'mayDiscardData', 'idempotent'] as const;

interface ToolAvailability {
  readonly available: boolean;
  readonly reason: string | null;
  readonly remediation: string | null;
}

interface AvailabilityGroup extends ToolAvailability {
  readonly names: readonly string[];
  readonly surface: string;
  readonly effects: readonly string[];
  readonly annotations: readonly string[];
}

export type SessionLane = 'binary' | 'bundle-resources';

export interface TargetBinding {
  readonly identity: ArtifactIdentity;
  readonly openedAt: string;
  readonly runId: string;
  readonly lane: SessionLane;
}

export interface BundleResourceRoot {
  readonly callerPath: string;
  readonly canonicalPath: string;
  readonly infoPlistPath: string | null;
  readonly layout: 'root' | 'contents';
  readonly openedAt: string;
  readonly runId: string;
}

export interface PiRuntimeIdentity {
  readonly name: string;
  readonly version: string;
  readonly cwd: string;
}

export const serverPath = (): string => fileURLToPath(new URL('../..', import.meta.url));

export class ReaSession {
  readonly serverPath: string = serverPath();

  readonly evidence = new EvidenceLedger();
  readonly unknowns = new UnknownLedger();
  readonly settings = new AnalysisSettingsStore();
  readonly startedAt = new Date().toISOString();
  readonly catalog: ToolCatalog = loadCatalog();
  #target: TargetBinding | undefined;
  #bundleResources: BundleResourceRoot | undefined;

  readonly runtime: PiRuntimeIdentity;

  constructor(runtime: PiRuntimeIdentity) {
    this.runtime = runtime;
  }

  get target(): TargetBinding | undefined {
    return this.#target;
  }

  get bundleResources(): BundleResourceRoot | undefined {
    return this.#bundleResources;
  }

  get open(): boolean {
    return this.#target !== undefined || this.#bundleResources !== undefined;
  }

  openTarget(identity: ArtifactIdentity): TargetBinding {
    const binding: TargetBinding = {
      identity,
      openedAt: new Date().toISOString(),
      runId: randomUUID(),
      lane: 'binary',
    };
    this.#bundleResources = undefined;
    this.#target = binding;
    return binding;
  }

  openBundleResources(root: Omit<BundleResourceRoot, 'openedAt' | 'runId'>): BundleResourceRoot {
    const binding: BundleResourceRoot = {
      ...root,
      openedAt: new Date().toISOString(),
      runId: randomUUID(),
    };
    this.#target = undefined;
    this.#bundleResources = binding;
    return binding;
  }

  closeTarget(): void {
    this.#target = undefined;
    this.#bundleResources = undefined;
    this.evidence.clear();
    this.unknowns.clear();
  }

  bundle(): EvidenceBundle {
    return {
      artifacts: this.evidence.subjects(),
      captures: [],
      environments: [],
      providers: this.evidence.providers(),
      records: this.evidence.list(),
      scenarios: [],
      unknowns: this.unknowns.list() as unknown as Record<string, unknown>[],
    };
  }

  availability(contract: ToolContract): ToolAvailability {
    if (contract.implementation === 'kernel') {
      if (TARGET_REQUIRED_TOOLS.has(contract.name) && !this.open) {
        return { available: false, reason: TARGET_REQUIRED, remediation: 'Call open_binary with a supported local target.' };
      }
      return { available: true, reason: AVAILABLE, remediation: null };
    }
    if (isProviderRefuseTool(contract.name)) {
      const refuse = providerRefuseAvailability(this, contract.name);
      return { available: false, reason: refuse.reason, remediation: refuse.remediation };
    }
    return {
      available: false,
      reason: NOT_IMPLEMENTED,
      remediation: `pi-rea has not implemented ${contract.name} yet; parity/pi-rea/ tracks the gap.`,
    };
  }

  toolAvailability(): { readonly client_requirements: Record<string, readonly string[]>; readonly groups: readonly AvailabilityGroup[] } {
    const groups = new Map<string, { group: Omit<AvailabilityGroup, 'names'>; names: string[] }>();
    for (const contract of this.catalog.tools) {
      const status = this.availability(contract);
      const effects = EFFECT_NAMES.filter((effect) => contract.effects[effect] === true);
      const annotations = ANNOTATION_NAMES.filter(([hint]) => contract.annotations[hint]).map(([, name]) => name);
      const group = { surface: contract.surface, effects, annotations, ...status };
      const key = JSON.stringify([group.surface, effects, annotations, status.available, status.reason, status.remediation]);
      const existing = groups.get(key);
      if (existing === undefined) groups.set(key, { group, names: [contract.name] });
      else existing.names.push(contract.name);
    }
    return {
      client_requirements: this.clientRequirements(),
      groups: [...groups.values()]
        .map(({ group, names }) => ({ ...group, names: names.toSorted() }))
        .toSorted((left, right) => (left.surface === right.surface ? ((left.names[0] ?? '') < (right.names[0] ?? '') ? -1 : 1) : left.surface < right.surface ? -1 : 1)),
    };
  }

  private clientRequirements(): Record<string, readonly string[]> {
    const required = new Set<string>();
    const optional = new Set<string>();
    for (const tool of this.catalog.tools) {
      for (const name of stringList(tool.clientRequirements['required'])) required.add(name);
      for (const name of stringList(tool.clientRequirements['optional'])) optional.add(name);
    }
    const missing = (names: Set<string>): string[] => [...names].filter((name) => CLIENT_FEATURES[name] !== true).toSorted();
    return { required: [...required].toSorted(), optional: [...optional].toSorted(), missing_required: missing(required), missing_optional: missing(optional) };
  }

  report(): Record<string, unknown> {
    const availability = this.toolAvailability();
    return {
      open: this.open,
      cleanup_pending: false,
      capabilities: this.catalog.hostCapabilities.map((capability) => ({
        operation: capability.operation,
        available: false,
        reason: NOT_IMPLEMENTED,
        availability_code: NOT_IMPLEMENTED,
        effects: capability.effects,
        limitations: [HOST_CAPABILITY_LIMITATION],
      })),
      analysis_provider_binding: null,
      analysis_provider_candidates: this.catalog.providerCandidates.map((candidate) => ({
        provider: candidate.provider,
        availability: { status: 'unavailable', code: NOT_IMPLEMENTED, reason: PROVIDER_LIMITATION },
      })),
      analysis_run:
        this.#target !== undefined
          ? { run_id: this.#target.runId, process_lineage: { status: 'not_observed' }, lane: 'binary' }
          : this.#bundleResources !== undefined
            ? { run_id: this.#bundleResources.runId, process_lineage: { status: 'not_observed' }, lane: 'bundle-resources' }
            : null,
      analysis_activity: { status: 'not_observed', providers: [] },
      provider_operation_health: null,
      tool_availability: availability,
      client_features: { ...CLIENT_FEATURES },
      server_identity: this.serverIdentity(),
      runtime: { kind: 'pi-extension', name: this.runtime.name, version: this.runtime.version, cwd: this.runtime.cwd },
    };
  }

  private serverIdentity(): Record<string, unknown> {
    return {
      package: { name: SERVER_NAME, version: PI_REA_VERSION, root_path: this.serverPath, build_commit: null },
      server: { name: SERVER_NAME, version: PI_REA_VERSION, started_at: this.startedAt, command_path: null },
      sdk: { server: null, client_test: null, core: null },
      negotiated_protocol_version: null,
      client: { name: 'pi', version: null },
      skill: { name: 'reverse-engineer-anything', expected_version: null },
      catalog: {
        counts: {
          cli_commands: null,
          mcp_tools: this.catalog.counts.tools,
          mcp_prompts: PROMPT_COUNT,
          implemented_tools: this.catalog.counts.implemented,
        },
        digests: { tools_sha256: catalogDigest(this.catalog), prompts_sha256: null, combined_sha256: null },
      },
      protocol_features: { progress: false, cancellation: true, elicitation: false },
      alignment: {
        state: 'unknown',
        reasons: [],
        remediation: 'Supply expected package, catalog, or registration identity to compare the live server.',
      },
      target: this.#target?.identity ?? null,
      bundle_resources: this.#bundleResources
        ? {
            caller_path: this.#bundleResources.callerPath,
            canonical_path: this.#bundleResources.canonicalPath,
            info_plist_path: this.#bundleResources.infoPlistPath,
            layout: this.#bundleResources.layout,
            run_id: this.#bundleResources.runId,
          }
        : null,
    };
  }
}

const stringList = (value: unknown): string[] => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
