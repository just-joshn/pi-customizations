declare const OperationIdBrand: unique symbol;
export type OperationId = string & { readonly [OperationIdBrand]: void };

declare const EvidenceIdBrand: unique symbol;
export type EvidenceId = string & { readonly [EvidenceIdBrand]: void };

declare const UnknownIdBrand: unique symbol;
export type UnknownId = string & { readonly [UnknownIdBrand]: void };

declare const Sha256Brand: unique symbol;
export type Sha256 = string & { readonly [Sha256Brand]: void };

export type ImplementationStatus = 'kernel' | 'unavailable';
export type AvailabilityCode = 'not_implemented' | 'missing_prerequisite' | 'unsupported_host' | 'unsupported_format' | 'unsupported_target' | 'target_required';

export type Confidence = 'derived' | 'observed' | 'inferred' | 'unknown';
export type Authority = 'shipped-artifact' | 'runtime-observation' | 'user-supplied' | 'artifact-bytes' | 'ast-static-analysis' | 'static-relationship-inference' | 'toolchain-observation';

export interface SubjectDigest {
  readonly sha256: Sha256;
  readonly size_bytes: number;
}

export interface Subject {
  readonly local_path: string;
  readonly format: string;
  readonly digest: SubjectDigest;
  readonly architecture?: string | null;
}

export interface Coverage {
  readonly status: 'complete' | 'partial' | 'unavailable';
  readonly truncated: boolean;
  readonly omitted_count: number | null;
  readonly limits: readonly string[];
}

export interface EvidenceEnvelope {
  readonly evidence_id: EvidenceId;
  readonly subject: Subject;
  readonly provider: { readonly id: string; readonly name: string; readonly version: string };
  readonly predicate_type: string;
  readonly operation: OperationId;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly normalized_result: unknown;
  readonly confidence: Confidence;
  readonly authority: Authority;
  readonly limitations: readonly string[];
  readonly locations: readonly Readonly<Record<string, unknown>>[];
  readonly evidence_links: readonly EvidenceId[];
  readonly raw_result?: unknown;
  readonly analysis_profile?: unknown;
  readonly environment?: unknown;
}

export interface Effects {
  readonly mutates_artifact: boolean;
  readonly launches_process: boolean;
  readonly may_show_ui: boolean;
  readonly may_access_network: boolean;
  readonly may_write_filesystem: boolean;
  readonly changes_permissions: boolean;
  readonly requires_root: boolean;
}

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface ToolContract {
  readonly name: OperationId;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly annotations: ToolAnnotations;
  readonly effects: Effects;
  readonly surface: string;
  readonly implementation: ImplementationStatus;
  readonly availability_code?: AvailabilityCode;
  readonly unavailability_reason?: string;
  readonly cli_name?: string;
  readonly direct?: boolean;
}

export interface ToolCatalog {
  readonly kind: 'pi-rea-tool-contracts';
  readonly provenance: {
    readonly interface: string;
    readonly method: string;
    readonly capture_sha256: Sha256;
    readonly note: string;
  };
  readonly counts: { readonly tools: number; readonly implemented: number };
  readonly tools: readonly ToolContract[];
}

export interface StorePaths {
  readonly root: string;
  readonly session: string;
  readonly sessionDir: string;
  readonly evidenceDir: string;
  readonly unknownDir: string;
  readonly ledgerPath: string;
}

export interface LedgerEntry {
  readonly evidence_id: EvidenceId;
  readonly operation: OperationId;
  readonly predicate_type: string;
  readonly subject_sha256: Sha256 | null;
  readonly local_path: string | null;
  readonly created_at: string;
  readonly repeat_count: number;
}

export interface UnknownHead {
  readonly unknown_id: UnknownId;
  readonly revision: number;
  readonly status: 'unresolved' | 'resolved' | 'blocked' | 'not_applicable';
  readonly severity: 'low' | 'medium' | 'high';
  readonly domain: string;
  readonly question: string;
  readonly supporting_evidence_ids: readonly EvidenceId[];
  readonly contradicting_evidence_ids: readonly EvidenceId[];
  readonly resolution?: { readonly statement: string; readonly evidence_ids: readonly EvidenceId[] } | null;
}

export interface Store {
  readonly root: string;
  readonly session: string;
  retain(record: EvidenceEnvelope): Promise<EvidenceEnvelope & { repeat_count: number; deduplicated: boolean }>;
  get(id: EvidenceId): Promise<EvidenceEnvelope>;
  has(id: EvidenceId): Promise<boolean>;
  list(filter?: { operation?: OperationId; subjectSha256?: Sha256 }): Promise<readonly LedgerEntry[]>;
  ledger(): Promise<{ schema: string; session: string; records: readonly LedgerEntry[] }>;
  exportBundle(path: string, options?: { overwrite?: boolean; stable?: boolean }): Promise<{ path: string; recordCount: number; unknownCount: number }>;
  importBundle(path: string): Promise<{ path: string; imported: number; skipped: number; importedUnknowns: number }>;
  recordUnknown(input: Readonly<Record<string, unknown>>): Promise<{ head: UnknownHead }>;
  updateUnknown(id: UnknownId, expectedRevision: number, patch: Readonly<Record<string, unknown>>): Promise<{ head: UnknownHead }>;
  listUnknowns(filter?: Readonly<Record<string, string>>): Promise<readonly UnknownHead[]>;
  remove(): Promise<void>;
}

export function openStore(_opts: { dir: string; sessionId?: string | null }): Promise<Store> {
  throw new Error('not implemented');
}

export function defaultStoreDir(_cwd?: string): string {
  throw new Error('not implemented');
}

export type FlagShape = 'flag' | 'string' | 'number' | string;

export interface CommandContext {
  readonly positionals: readonly string[];
  readonly args: Readonly<Record<string, string | boolean | number>>;
  readonly store: Store | null;
  readonly cwd: string;
  readonly signal?: AbortSignal;
}

export interface CommandResult {
  readonly envelope?: EvidenceEnvelope | null;
  readonly result?: unknown;
  readonly plain?: string | null;
}

export interface CommandSpec {
  readonly name: string;
  readonly operation: OperationId;
  readonly summary: string;
  readonly needsStore: boolean;
  readonly flags: Readonly<Record<string, FlagShape>>;
  run(ctx: CommandContext): Promise<CommandResult>;
}

export function buildCommandTable(_catalog: ToolCatalog): Map<string, CommandSpec> {
  throw new Error('not implemented');
}

export interface ParsedArgv {
  readonly commandName: string | undefined;
  readonly positionals: readonly string[];
  readonly args: Readonly<Record<string, string | boolean | number>>;
}

export function parseArgv(_argv: readonly string[], _booleanFlags: ReadonlySet<string>): ParsedArgv {
  throw new Error('not implemented');
}

export async function runCommand(_input: { readonly argv: readonly string[]; readonly storeDir?: string; readonly cwd?: string; readonly signal?: AbortSignal }): Promise<CommandResult> {
  throw new Error('not implemented');
}

export async function invokeKernel(_input: { readonly operation: OperationId; readonly args: Readonly<Record<string, unknown>>; readonly storeRoot: string; readonly cwd?: string; readonly signal?: AbortSignal }): Promise<KernelOutcome> {
  throw new Error('not implemented');
}

export type KernelOutcome = { readonly ok: true; readonly payload: EvidenceEnvelope | unknown; readonly plain?: string } | { readonly ok: false; readonly error: ReaErrorEnvelope };

export interface ReaErrorEnvelope {
  readonly error: true;
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
}

export function errorEnvelope(_error: unknown): ReaErrorEnvelope {
  throw new Error('not implemented');
}

export interface FormatModule {
  readonly id: string;
  readonly detect: (bytes: Uint8Array) => boolean;
}

export function readBinaryLayout(_bytes: Uint8Array): unknown {
  throw new Error('not implemented');
}

export function inspectMacho(_bytes: Uint8Array): unknown {
  throw new Error('not implemented');
}

export function inspectPlist(_bytes: Uint8Array): unknown {
  throw new Error('not implemented');
}

export function inspectPeResources(_bytes: Uint8Array, _opts?: Readonly<Record<string, unknown>>): unknown {
  throw new Error('not implemented');
}

export function analyzeJavaScriptApplication(_input: { readonly source: unknown; readonly subject: Subject; readonly integrityPolicy: 'fail' | 'record-and-continue' }): Promise<unknown> {
  throw new Error('not implemented');
}

export function routeByPath(_path: string): Promise<{
  readonly target: string;
  readonly format: string;
  readonly kind: string;
  readonly operation: string | null;
  readonly supported: boolean;
  readonly subject: Subject;
}> {
  throw new Error('not implemented');
}

export function createEnvelope(_input: {
  readonly operation: OperationId;
  readonly predicateType: string;
  readonly subject: Subject;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly normalizedResult: unknown;
  readonly limitations: readonly string[];
  readonly confidence?: Confidence;
  readonly authority?: Authority;
  readonly locations?: readonly Readonly<Record<string, unknown>>[];
  readonly evidenceLinks?: readonly EvidenceId[];
}): EvidenceEnvelope {
  throw new Error('not implemented');
}

export interface CapabilityEntry {
  readonly operation: OperationId;
  readonly title: string;
  readonly available: boolean;
  readonly reason: string | null;
  readonly availability_code: AvailabilityCode | null;
  readonly effects: Effects;
  readonly limitations: readonly string[];
}

export function capabilityMatrix(
  _catalog: ToolCatalog,
  _opts?: { version?: string },
): {
  readonly open: boolean;
  readonly provider: { readonly id: string; readonly name: string; readonly version: string };
  readonly capabilities: readonly CapabilityEntry[];
} {
  throw new Error('not implemented');
}

export type PiRegisterTool = (tool: {
  readonly name: string;
  readonly label: string;
  readonly description: string;
  readonly parameters: unknown;
  readonly annotations: ToolAnnotations;
  readonly namespace: unknown;
  readonly exposure: 'direct' | 'deferred';
  readonly executionMode: 'sequential' | 'parallel';
  readonly promptGuidelines?: readonly string[];
  execute: (...args: never[]) => Promise<unknown>;
}) => void;

export interface AdapterDeps {
  readonly getStoreRoot: () => string;
  readonly catalog: ToolCatalog;
}

export function registerGeneratedTools(_pi: { registerTool: PiRegisterTool }, _deps: AdapterDeps): void {
  throw new Error('not implemented');
}

export function bindStore(_cwd: string): string {
  throw new Error('not implemented');
}

export function toPiToolResult(_outcome: KernelOutcome): {
  readonly content: unknown;
  readonly details: unknown;
  readonly structuredContent?: unknown;
  readonly isError?: boolean;
} {
  throw new Error('not implemented');
}

export function formatStatus(_payload: unknown): string {
  throw new Error('not implemented');
}

export function piRea(_pi: {
  on: (event: string, handler: (...args: never[]) => unknown) => void;
  registerTool: PiRegisterTool;
  registerCommand: (name: string, spec: { description: string; handler: (...args: never[]) => Promise<void> }) => void;
}): void {
  throw new Error('not implemented');
}

export function generateCatalog(_opts: { readonly catalogPath: string; readonly outDir: string }): {
  readonly tools: number;
  readonly direct: number;
  readonly deferred: number;
} {
  throw new Error('not implemented');
}

export function catalogDigest(_catalog?: ToolCatalog): Sha256 {
  throw new Error('not implemented');
}

export const MODULE_MAP_NOTE = 'see block comment above' as const;
