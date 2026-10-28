import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { catalogDigest, loadCatalog, type ToolCatalog, type ToolContract } from '../contract/catalog.ts';
import type { ArtifactIdentity } from '../targets/artifact-identity.ts';
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

export const NOT_IMPLEMENTED = 'not_implemented';
export const TARGET_REQUIRED = 'target_required';

export const HOST_CAPABILITY_LIMITATION = 'pi-rea has not implemented this host capability; parity/pi-rea/ records the gap.';
export const PROVIDER_LIMITATION = 'pi-rea has no deep-analysis provider bridge; parity/pi-rea/ records the scope boundary.';

const TARGET_REQUIRED_TOOLS = new Set<string>();

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

  availability(contract: ToolContract): {
    readonly available: boolean;
    readonly reason: string | null;
    readonly remediation: string | null;
  } {
    if (contract.implementation === 'unavailable') {
      return {
        available: false,
        reason: NOT_IMPLEMENTED,
        remediation: `pi-rea has not implemented ${contract.name} yet; parity/pi-rea/ tracks the gap.`,
      };
    }
    if (TARGET_REQUIRED_TOOLS.has(contract.name) && !this.open) {
      return { available: false, reason: TARGET_REQUIRED, remediation: 'Call open_binary with a supported local target.' };
    }
    return { available: true, reason: 'available', remediation: null };
  }

  report(): Record<string, unknown> {
    const availability = this.catalog.tools.map((contract) => {
      const status = this.availability(contract);
      return {
        name: contract.name,
        surface: contract.surface,
        client_requirements: contract.clientRequirements,
        effects: contract.effects,
        annotations: {
          read_only: contract.annotations.readOnlyHint,
          destructive: contract.annotations.destructiveHint,
          idempotent: contract.annotations.idempotentHint,
          open_world: contract.annotations.openWorldHint,
        },
        ...(contract.modes.length === 0 ? {} : { modes: contract.modes }),
        ...(contract.defaultModeAvailable === undefined ? {} : { default_mode_available: contract.defaultModeAvailable }),
        ...status,
      };
    });
    return {
      open: this.open,
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
      client_features: { elicitation_form: false, elicitation_url: false, roots: false, sampling: false },
      server_identity: this.serverIdentity(),
      runtime: { kind: 'pi-extension', name: this.runtime.name, version: this.runtime.version, cwd: this.runtime.cwd },
    };
  }

  private serverIdentity(): Record<string, unknown> {
    return {
      package: { name: SERVER_NAME, version: PI_REA_VERSION, build_commit: null },
      server: { name: SERVER_NAME, version: PI_REA_VERSION, started_at: this.startedAt },
      skill: { name: 'reverse-engineer-anything', expected_version: this.catalog.provenance.interface },
      catalog: {
        counts: { mcp_tools: this.catalog.counts.tools, implemented_tools: this.catalog.counts.implemented },
        digests: { tools_sha256: catalogDigest(this.catalog) },
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
