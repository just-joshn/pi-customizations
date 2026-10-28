import type { AgentToolResult, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

export type FamilyId = 'session-evidence' | 'static-inspectors' | 'native-session' | 'javascript-electron' | 'managed-dotnet' | 'frida' | 'offline-forensics' | 'android-mobile' | 'browser-web' | 'other';

export type ToolImplementation = 'kernel' | 'unavailable';

export type ToolExposure = 'direct' | 'deferred';

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface ToolContract {
  readonly name: string;
  readonly family: FamilyId;
  readonly description: string;
  readonly parameters: Record<string, unknown>;
  readonly annotations: ToolAnnotations;
  readonly effects: Readonly<Record<string, boolean>>;
  readonly surface: string;
  readonly implementation: ToolImplementation;
}

export interface ToolCatalog {
  readonly kind: 'pi-rea-tool-contracts';
  readonly provenance: {
    readonly interface: 'rea-agents@6.8.0';
    readonly oracle: 'parity/pi-rea/rea-6.8.0-tools-list.json';
    readonly tools_sha256: string;
    readonly note: string;
  };
  readonly counts: { readonly tools: 229; readonly kernel: number; readonly unavailable: number };
  readonly tools: readonly ToolContract[];
}

export interface KernelManifest {
  readonly version: 1;
  readonly kernelToolNames: readonly string[];
}

export interface OracleToolWire {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema?: Record<string, unknown>;
  readonly annotations?: Partial<ToolAnnotations>;
  readonly outputSchema?: unknown;
  readonly title?: string;
}

export function generateCatalog(_oracleTools: readonly OracleToolWire[], _kernel: KernelManifest, _families: Readonly<Record<FamilyId, readonly string[]>>): ToolCatalog {
  throw new Error('not implemented');
}

export function loadCatalog(_fromUrl?: URL): ToolCatalog {
  throw new Error('not implemented');
}

export function exposureFor(contract: ToolContract): ToolExposure {
  return contract.implementation === 'kernel' ? 'direct' : 'deferred';
}

export function catalogDigest(_catalog: ToolCatalog): string {
  throw new Error('not implemented');
}

export type Confidence = 'observed' | 'derived' | 'inferred';
export type Authority = 'shipped-artifact' | 'controlled-replay' | 'historical-reference' | 'external-service' | 'analyst-inference';

export interface ArtifactIdentity {
  readonly path: string;
  readonly format: string;
  readonly kind: string;
  readonly architecture: string | null;
  readonly sha256: string;
}

export interface TargetBinding {
  readonly identity: ArtifactIdentity;
  readonly openedAt: string;
  readonly runId: string;
}

export interface EvidenceRecord {
  readonly evidence_id: string;
  readonly subject: {
    readonly name: string;
    readonly digest: { readonly sha256: string };
    readonly format: string;
    readonly architecture: string | null;
    readonly local_path: string | null;
  } | null;
  readonly provider: { readonly id: string; readonly name: string; readonly version: string | null };
  readonly operation: string;
  readonly parameters: Record<string, unknown>;
  readonly normalized_result: unknown;
  readonly confidence: Confidence;
  readonly authority: Authority;
  readonly limitations: readonly string[];
  readonly locations: readonly Record<string, unknown>[];
  readonly evidence_links: readonly string[];
}

export interface UnknownRecord {
  readonly unknown_id: string;
  readonly question: string;
  readonly severity: string;
  readonly domain: string;
  readonly revision: number;
  readonly supporting_evidence_ids: readonly string[];
  readonly status: 'open' | 'resolved' | 'superseded';
}

export interface AvailabilityEntry {
  readonly name: string;
  readonly available: boolean;
  readonly reason: string | null;
  readonly remediation: string | null;
  readonly surface: string;
  readonly effects: Readonly<Record<string, boolean>>;
}

export interface BinarySessionReport {
  readonly open: boolean;
  readonly target: ArtifactIdentity | null;
  readonly tool_availability: readonly AvailabilityEntry[];
  readonly catalog: {
    readonly counts: { readonly mcp_tools: 229; readonly mcp_prompts: 6 };
    readonly digests: { readonly tools_sha256: string; readonly prompts_sha256: string };
  };
  readonly alignment: {
    readonly state: 'aligned' | 'drift' | 'unknown';
    readonly reasons: readonly string[];
  };
}

export interface ReaSession {
  readonly cwd: string;
  readonly startedAt: string;
  readonly catalog: ToolCatalog;
  readonly target: TargetBinding | undefined;
  openTarget(identity: ArtifactIdentity): TargetBinding;
  closeTarget(): void;
  retain(record: EvidenceRecord): void;
  listEvidence(): readonly EvidenceRecord[];
  recordUnknown(input: unknown): UnknownRecord;
  listUnknowns(): readonly UnknownRecord[];
  availability(contract: ToolContract): Pick<AvailabilityEntry, 'available' | 'reason' | 'remediation'>;
  report(): BinarySessionReport;
  statusLines(): string[];
  bundle(): {
    readonly artifacts: readonly unknown[];
    readonly records: readonly EvidenceRecord[];
    readonly unknowns: readonly UnknownRecord[];
    readonly providers: readonly unknown[];
  };
}

export interface SessionHolder {
  reset(cwd: string): ReaSession;
  current(): ReaSession;
  shutdown(): void;
}

export function createSessionHolder(): SessionHolder {
  throw new Error('not implemented');
}

export function createReaSession(_cwd: string, _catalog?: ToolCatalog): ReaSession {
  throw new Error('not implemented');
}

export interface ReaErrorPayload {
  readonly code: string;
  readonly category: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly remediation: { readonly action: string };
  readonly details?: Record<string, unknown>;
}

export class ReaError extends Error {
  readonly payload: ReaErrorPayload;
  constructor(payload: ReaErrorPayload) {
    super(payload.message);
    this.name = 'ReaError';
    this.payload = payload;
  }
}

export function capabilityUnavailable(message: string, details?: Record<string, unknown>): ReaError {
  void message;
  void details;
  throw new Error('not implemented');
}

export function operationResult(_payload: unknown): AgentToolResult<unknown> {
  throw new Error('not implemented');
}

export function evidenceResult(_record: EvidenceRecord): AgentToolResult<unknown> {
  throw new Error('not implemented');
}

export function errorResult(_error: unknown): AgentToolResult<unknown> {
  throw new Error('not implemented');
}

export interface ToolCallContext {
  readonly cwd: string;
  readonly signal?: AbortSignal;
}

export type ToolHandler = (session: ReaSession, params: unknown, ctx: ToolCallContext) => Promise<AgentToolResult<unknown>>;

export interface FamilyHandlers {
  readonly [toolName: string]: ToolHandler | undefined;
  readonly fallback: (name: string) => never;
}

export type HandlerTable = ReadonlyMap<string, ToolHandler>;

export function buildHandlerTable(_families: Readonly<Record<FamilyId, FamilyHandlers>>, _catalog: ToolCatalog): HandlerTable {
  throw new Error('not implemented');
}

export async function dispatchTool(_contract: ToolContract, _session: ReaSession, _params: unknown, _ctx: ToolCallContext, _handlers: HandlerTable): Promise<AgentToolResult<unknown>> {
  throw new Error('not implemented');
}

export const REA_NAMESPACE = {
  name: 'rea',
  aliases: ['pi-rea', 'rea-agents'] as const,
  description: 'REA reverse-engineering Evidence tools. Inspect shipped artifacts and keep every finding attached to Evidence.',
  instructions: '',
} as const;

export function registerAllTools(pi: ExtensionAPI, getSession: () => ReaSession): void {
  void pi;
  void getSession;
  throw new Error('not implemented');
}

export default function piRea(_pi: ExtensionAPI): void {
  throw new Error('not implemented');
}

export interface AnalyzerResult {
  readonly normalized_result: unknown;
  readonly limitations: readonly string[];
  readonly confidence: Confidence;
  readonly authority: Authority;
}

export async function runAbsorbedAnalyzer(_name: string, _session: ReaSession, _params: unknown, _analyze: (path: string) => Promise<AnalyzerResult>): Promise<AgentToolResult<unknown>> {
  throw new Error('not implemented');
}

export const REA_PROMPT_NAMES = ['investigate_feature', 'compare_application_versions', 'verify_reconstruction', 'trace_crash', 'audit_residual_unknowns', 'prepare_bounded_process_capture'] as const;

export type ReaPromptName = (typeof REA_PROMPT_NAMES)[number];

export function promptsDigest(_promptBodies: readonly string[]): string {
  throw new Error('not implemented');
}

export function verifyContractAgainstOracle(_catalog: ToolCatalog, _oracleTools: readonly OracleToolWire[]): { readonly ok: boolean; readonly diffs: readonly string[] } {
  throw new Error('not implemented');
}

export type _SketchPiContext = ExtensionContext;
