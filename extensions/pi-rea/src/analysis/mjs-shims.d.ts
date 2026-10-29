declare module '*zip.mjs' {
  export const MAX_MEMBER_BYTES: number;
  export function crc32(buffer: Uint8Array): number;
  export function normalizeMemberPath(name: string): { readonly safe: boolean; readonly path: string; readonly reason: string | null };
  export function findEndOfCentralDirectory(bytes: Uint8Array): number;
  export function readZipDirectory(bytes: Uint8Array): {
    readonly entries: readonly {
      readonly logical_path: string;
      readonly safe_path: boolean;
      readonly unsafe_reason: string | null;
      readonly compression_method: number;
      readonly flags: number;
      readonly declared_crc32: number;
      readonly compressed_size: number;
      readonly uncompressed_size: number;
      readonly local_header_offset: number;
      readonly external_attributes: number;
      readonly is_directory: boolean;
      readonly nameLength: number;
      readonly extraLength: number;
      readonly commentLength: number;
    }[];
    readonly zip64: boolean;
    readonly comment: string;
    readonly coverage: Record<string, unknown>;
  };
  export function readZipMember(
    bytes: Uint8Array,
    entry: { readonly logical_path: string; readonly local_header_offset: number; readonly compressed_size: number; readonly compression_method: number; readonly declared_crc32: number; readonly uncompressed_size: number },
  ): { readonly bytes: Buffer; readonly crc32: number; readonly crc_ok: boolean };
  export class ZipError extends Error {
    readonly code: string;
    readonly offset: number | null;
    constructor(code: string, message: string, offset?: number | null);
  }
}

declare module '*artifact.mjs' {
  export function inspectArtifact(args: { readonly bytes: Uint8Array; readonly subject: Record<string, unknown>; readonly integrityPolicy?: string }): {
    readonly inventory: {
      readonly manifest: Record<string, unknown>;
      readonly nodes: readonly unknown[];
      readonly occurrences: readonly unknown[];
      readonly edges: readonly unknown[];
      readonly limitations: readonly string[];
      readonly [key: string]: unknown;
    };
    readonly zip_limitation: string;
  };
}

declare module '*javascript.mjs' {
  export const JS_LIMITATIONS: readonly string[];
  export function analyzeJavaScriptApplication(args: { readonly source: unknown; readonly subject: Record<string, unknown>; readonly integrityPolicy?: string }): Promise<Record<string, unknown>>;
}

declare module '*target-source.mjs' {
  export function openDirectorySource(path: string): Promise<unknown>;
  export function openAsarSource(bytes: Uint8Array): Promise<unknown>;
}

declare module '*canonical.mjs' {
  export function canonicalJson(value: unknown): string;
  export function sha256Hex(input: string): string;
  export function digestOf(input: string): string;
  export function evidenceId(request: { readonly operation: string; readonly parameters: Record<string, unknown>; readonly subjectSha256: string; readonly normalizedResult: unknown }): string;
  export function nodeId(prefix: string, parts: Record<string, unknown>): string;
  export function observationId(prefix: string, parts: Record<string, unknown>): string;
  export function unknownId(question: string): string;
  export function normalizeQuestion(question: string): string;
  export function artifactIdForContent(sha256: string): string;
  export function digestDirectory(root: string, entries: readonly unknown[]): Promise<string>;
}

declare module '*envelope.mjs' {
  export const PROVIDER: {
    readonly id: string;
    readonly name: string;
    readonly version: string;
  };
  export const CONFIDENCE: ReadonlySet<string>;
  export const OBSERVATION_CONFIDENCE: ReadonlySet<string>;
  export const AUTHORITY: ReadonlySet<string>;
  export const EVIDENCE_AUTHORITY: ReadonlySet<string>;
  export const STATE: {
    readonly observed: string;
    readonly inferred: string;
    readonly unknown: string;
  };
  export const COVERAGE_STATUS: ReadonlySet<string>;
  export const DEFAULT_EXTRACTOR: { readonly executable_sha256: string | null };
  export function coverage(request: { readonly status: string; readonly truncated?: boolean; readonly omittedCount?: number | null; readonly limits?: readonly unknown[] }): Record<string, unknown>;
  export function artifactRef(request: Record<string, unknown>): Record<string, unknown>;
  export function observation(request: Record<string, unknown>): Record<string, unknown>;
  export function createEnvelope(request: Record<string, unknown>): Record<string, unknown>;
  export function graphNode(request: Record<string, unknown>): Record<string, unknown>;
  export function edgeEvidence(request: Record<string, unknown>): Record<string, unknown>;
  export function graphEdge(request: Record<string, unknown>): Record<string, unknown>;
}

declare module '*javascript-ast-count.mjs' {
  export function countVisitedAstNodes(source: string, sourcePath: string): number;
}

declare module '*javascript-route-inventory.mjs' {
  export interface RouteInventory {
    readonly inventory_id: string;
    readonly source_manifest_sha256: string;
    readonly sources: readonly {
      readonly id: string;
      readonly key: string;
      readonly path: string;
      readonly url: string | null;
      readonly sha256: string;
      readonly container_sha256: string;
      readonly status: string;
      readonly next_app_context?: unknown;
      readonly reported_route_capacity: number | null;
      readonly reason: string | null;
      readonly base_path: string | null;
    }[];
    readonly routes: readonly unknown[];
    readonly occurrences: readonly unknown[];
    readonly unknowns: readonly unknown[];
    readonly coverage: {
      readonly scope: string;
      readonly source_parsing: string;
      readonly candidate_enumeration: string;
      readonly application_routes: string;
    };
    readonly statistics: {
      readonly sources_seen: number;
      readonly sources_retained: number;
      readonly route_patterns: number;
      readonly occurrences: number;
      readonly unanchored_literals_excluded: number;
    };
    readonly capacity: number | null;
    readonly limitations: readonly string[];
  }
  export function buildRouteInventory(inputs: readonly unknown[]): RouteInventory;
}

declare module '*javascript-semantic-graph.mjs' {
  interface SemanticGraph {
    readonly graph_id: string;
    readonly application_graph_id: string;
    readonly root_artifact_sha256: string;
    readonly nodes: readonly {
      readonly node_id: string;
      readonly kind: string;
      readonly identity: unknown;
      readonly [key: string]: unknown;
    }[];
    readonly relations: readonly unknown[];
    readonly coverage: {
      readonly families: readonly unknown[];
      readonly [key: string]: unknown;
    };
    readonly [key: string]: unknown;
  }
  export function semanticDigest(value: unknown): string;
  export function semanticNodeId(node: { readonly kind: string; readonly identity: unknown }): string;
  export function semanticGraphId(semanticWithoutId: unknown): string;
  export function assertSealed<T>(graph: T): T;
  export function projectMeasuredSemanticGraph(request: { readonly rootArtifactSha256: string }): SemanticGraph | null;
}

declare module '*gobinary.mjs' {
  export function readGoBuildInfo(bytes: Uint8Array): {
    readonly present: boolean;
    readonly go_version?: string | null;
    readonly modules: readonly unknown[];
    readonly build_settings: readonly {
      readonly key: string;
      readonly value: string;
    }[];
    readonly ranges: readonly {
      readonly field: string;
      readonly start: number;
      readonly end: number;
    }[];
    readonly build_info?: Record<string, unknown>;
    readonly limitations?: readonly string[];
    readonly [key: string]: unknown;
  };
}

declare module '*binary.mjs' {
  export function readBinaryLayout(bytes: Uint8Array): {
    readonly format: string;
    readonly architecture: string | null;
    readonly symbols: { readonly imports: readonly unknown[]; readonly exports: readonly unknown[] };
    readonly limitations?: readonly string[];
    readonly [key: string]: unknown;
  };
}

declare module '*har.mjs' {
  export function readHarCapture(
    document: unknown,
    options?: { readonly record_ordinals?: readonly number[] | undefined },
  ): {
    readonly version?: string;
    readonly format?: string;
    readonly records: readonly unknown[];
    readonly selected_ordinals: readonly number[];
    readonly sensitive_value_count: number;
    readonly coverage?: { readonly truncated: boolean; readonly [key: string]: unknown };
    readonly limitations: readonly string[];
    readonly [key: string]: unknown;
  };
}

declare module '*target.mjs' {
  export function describeSubject(
    path: string,
    options?: { readonly formatHint?: string },
  ): Promise<{
    readonly name: string;
    readonly digest: { readonly sha256: string };
    readonly format: string;
    readonly detected_format: string;
    readonly architecture: string | null;
    readonly local_path: string;
  }>;
}

declare module '*route.mjs' {
  export function routeByPath(path: string): Promise<{
    readonly name: string;
    readonly format: string;
    readonly kind: string;
    readonly operation: string | null;
    readonly [key: string]: unknown;
  }>;
}

declare module '*views.mjs' {
  export function buildView(
    record: Record<string, unknown>,
    request: Record<string, unknown>,
  ): Promise<{
    readonly operation: string;
    readonly predicate_type: string;
    readonly parameters: Record<string, unknown>;
    readonly normalized_result: Record<string, unknown>;
  }>;
}
