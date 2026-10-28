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
  export function inspectArtifact(args: {
    readonly bytes: Uint8Array;
    readonly subject: Record<string, unknown>;
    readonly integrityPolicy?: string;
  }): {
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
  export function analyzeJavaScriptApplication(args: {
    readonly source: unknown;
    readonly subject: Record<string, unknown>;
    readonly integrityPolicy?: string;
  }): Promise<Record<string, unknown>>;
}

declare module '*target-source.mjs' {
  export function openDirectorySource(path: string): Promise<unknown>;
  export function openAsarSource(bytes: Uint8Array): Promise<unknown>;
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

declare module '*gobinary.mjs' {
  export function readGoBuildInfo(bytes: Uint8Array): {
    readonly present: boolean;
    readonly go_version?: string;
    readonly modules: readonly unknown[];
    readonly build_settings: readonly unknown[];
    readonly limitations?: readonly string[];
    readonly [key: string]: unknown;
  };
}

declare module '*har.mjs' {
  export function readHarCapture(document: unknown): {
    readonly version: string;
    readonly records: readonly unknown[];
    readonly coverage: { readonly truncated: boolean; readonly [key: string]: unknown };
    readonly limitations?: readonly string[];
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
