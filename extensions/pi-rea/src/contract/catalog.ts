import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

export type ToolImplementation = 'kernel' | 'unavailable';

export type ParameterSchema = Record<string, unknown>;

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface ToolContract {
  readonly name: string;
  readonly description: string;
  readonly parameters: ParameterSchema;
  readonly annotations: ToolAnnotations;
  readonly effects: Record<string, boolean>;
  readonly surface: string;
  readonly clientRequirements: Record<string, unknown>;
  readonly modes: readonly Record<string, unknown>[];
  readonly defaultModeAvailable?: boolean;
  readonly implementation: ToolImplementation;
}

export interface HostCapabilityFact {
  readonly operation: string;
  readonly effects: Record<string, boolean>;
}

export interface ProviderCandidateFact {
  readonly provider: { readonly id: string; readonly name: string; readonly version: string | null };
}

export interface ToolCatalog {
  readonly kind: 'pi-rea-tool-contracts';
  readonly provenance: {
    readonly interface: string;
    readonly method: string;
    readonly oracle?: string;
    readonly capture_sha256: string;
    readonly tools_sha256?: string;
    readonly note: string;
  };
  readonly counts: {
    readonly tools: number;
    readonly implemented: number;
    readonly kernel?: number;
    readonly unavailable?: number;
  };
  readonly hostCapabilities: readonly HostCapabilityFact[];
  readonly providerCandidates: readonly ProviderCandidateFact[];
  readonly tools: readonly ToolContract[];
}

const CONTRACT_URL = new URL('../../schemas/tool-contracts.json', import.meta.url);

let cached: ToolCatalog | undefined;

export const loadCatalog = (): ToolCatalog => {
  cached ??= JSON.parse(readFileSync(CONTRACT_URL, 'utf8')) as ToolCatalog;
  return cached;
};

export const catalogDigest = (catalog: ToolCatalog = loadCatalog()): string => createHash('sha256').update(JSON.stringify(catalog.tools)).digest('hex');
