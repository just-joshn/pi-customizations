
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

export type EvidenceId = string & { readonly __brand: "EvidenceId" };

export type UnknownId = string & { readonly __brand: "UnknownId" };

export type AbsolutePath = string & { readonly __brand: "AbsolutePath" };

export type McpServerName = "rea";

export type Confidence = "observed" | "derived" | "inferred";
export type Authority =
  | "shipped-artifact"
  | "controlled-replay"
  | "historical-reference"
  | "external-service"
  | "analyst-inference";

export type ToolImplementation = "kernel" | "analyzer" | "unavailable";

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly destructiveHint: boolean;
  readonly idempotentHint: boolean;
  readonly openWorldHint: boolean;
}

export interface ToolContract {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Record<string, unknown>;
  readonly outputSchema?: Record<string, unknown>;
  readonly annotations: ToolAnnotations;
  readonly implementation: ToolImplementation;
}

export interface PromptArgument {
  readonly name: string;
  readonly required: boolean;
  readonly description?: string;
}

export interface PromptContract {
  readonly name: string;
  readonly description: string;
  readonly arguments: readonly PromptArgument[];
}

export interface ToolCatalog {
  readonly kind: "pi-rea-tool-contracts";
  readonly oracle: {
    readonly release: "6.8.0";
    readonly tools_sha256: string;
    readonly prompts_sha256: string;
    readonly combined_sha256: string;
  };
  readonly counts: { readonly tools: 229; readonly prompts: 6; readonly implemented: number };
  readonly tools: readonly ToolContract[];
  readonly prompts: readonly PromptContract[];
}

export interface ArtifactIdentity {
  readonly path: AbsolutePath;
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
  readonly evidence_id: EvidenceId;
  readonly subject: {
    readonly name: string;
    readonly digest: { readonly sha256: string };
    readonly format: string;
    readonly architecture: string | null;
    readonly local_path: string | null;
  } | null;
  readonly provider: { readonly id: string; readonly name: string; readonly version: string | null };
  readonly analysis_profile: Record<string, unknown> | null;
  readonly predicate_type: "rea.analysis" | "rea.residual-unknown-mutation";
  readonly operation: string;
  readonly parameters: Record<string, unknown>;
  readonly raw_result: unknown;
  readonly normalized_result: unknown;
  readonly confidence: Confidence;
  readonly authority: Authority;
  readonly environment: Record<string, unknown> | null;
  readonly limitations: readonly string[];
  readonly locations: readonly Record<string, unknown>[];
  readonly evidence_links: readonly string[];
}

export interface EvidenceBundle {
  readonly artifacts: readonly unknown[];
  readonly captures: readonly unknown[];
  readonly environments: readonly unknown[];
  readonly providers: readonly unknown[];
  readonly records: readonly EvidenceRecord[];
  readonly scenarios: readonly unknown[];
  readonly unknowns: readonly Record<string, unknown>[];
}

export type SessionPhase =
  | { readonly kind: "closed" }
  | { readonly kind: "open"; readonly target: TargetBinding };

export interface AvailabilityEntry {
  readonly names: readonly string[];
  readonly available: boolean;
  readonly reason: string | null;
  readonly remediation: string | null;
  readonly surface: string;
}

export interface BinarySessionReport {
  readonly open: boolean;
  readonly cleanup_pending: boolean;
  readonly tool_availability: {
    readonly client_requirements: Record<string, unknown>;
    readonly groups: readonly AvailabilityEntry[];
  };
  readonly server_identity: {
    readonly package: { readonly name: "pi-rea"; readonly version: string; readonly root_path: string };
    readonly server: { readonly name: McpServerName; readonly version: string; readonly started_at: string };
    readonly catalog: ToolCatalog["oracle"] & { readonly counts: ToolCatalog["counts"] };
    readonly skill: { readonly name: "reverse-engineer-anything"; readonly expected_version: string };
  };
  readonly [key: string]: unknown;
}

export type ReaErrorCode =
  | "invalid_request"
  | "capability_unavailable"
  | "unsupported_target"
  | "target_unavailable"
  | "provider_unavailable"
  | "resource_constraint"
  | "cancelled"
  | "evidence_integrity_mismatch"
  | "configuration_invalid"
  | "execution_failure"
  | "revision_conflict"
  | "timeout";

export interface ReaErrorPayload {
  readonly code: ReaErrorCode;
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
    this.name = "ReaError";
    this.payload = payload;
  }
}

export type ToolOutcome =
  | { readonly kind: "operation"; readonly result: unknown }
  | { readonly kind: "evidence"; readonly record: EvidenceRecord }
  | { readonly kind: "error"; readonly error: ReaError };

export const REA_MCP_SERVER_NAME: McpServerName = "rea";

export const KERNEL_TOOL_EXPOSURE: Readonly<Record<string, "direct">> = {
  binary_session: "direct",
  open_binary: "direct",
  close_binary: "direct",
  get_evidence_bundle: "direct",
  export_evidence_bundle: "direct",
  import_evidence_bundle: "direct",
  inspect_analysis_view: "direct",
  list_unknowns: "direct",
  record_unknown: "direct",
  update_unknown: "direct",
};

export interface HostPaths {
  readonly serverEntry: AbsolutePath;
  readonly packageRoot: AbsolutePath;
}

export function resolveHostPaths(fromImportMetaUrl: string): HostPaths {
  void fromImportMetaUrl;
  throw new Error("not implemented");
}

export function registerReaMcpServer(pi: ExtensionAPI, paths?: HostPaths): void {
  void pi;
  void paths;
  throw new Error("not implemented");
}

export function registerReaCommand(pi: ExtensionAPI): void {
  void pi;
  throw new Error("not implemented");
}

export default function piRea(pi: ExtensionAPI): void {
  registerReaMcpServer(pi);
  registerReaCommand(pi);
}

export interface McpRuntimeOptions {
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  readonly catalog?: ToolCatalog;
}

export interface McpRuntime {
  readonly session: ReaSession;
  readonly catalog: ToolCatalog;
  listenStdio(): Promise<void>;
}

export function createMcpRuntime(options: McpRuntimeOptions): Promise<McpRuntime> {
  void options;
  throw new Error("not implemented");
}

export function loadCatalog(): ToolCatalog {
  throw new Error("not implemented");
}

export interface ReaSession {
  readonly phase: SessionPhase;
  readonly evidence: EvidenceLedger;
  readonly unknowns: UnknownLedger;
  readonly startedAt: string;

  openTarget(identity: ArtifactIdentity): TargetBinding;
  closeTarget(): void;
  report(): BinarySessionReport;
  bundle(): EvidenceBundle;
}

export function createReaSession(input: {
  readonly cwd: string;
  readonly version: string;
  readonly packageRoot: string;
  readonly catalog: ToolCatalog;
}): ReaSession {
  void input;
  throw new Error("not implemented");
}

export interface EvidenceLedger {
  readonly size: number;
  append(draft: Omit<EvidenceRecord, "evidence_id">): EvidenceRecord;
  get(id: EvidenceId): EvidenceRecord | undefined;
  list(): readonly EvidenceRecord[];
  clear(): void;
  importBundle(bundle: EvidenceBundle): void;
}

export interface UnknownLedger {
  readonly revisionCount: number;
  list(): readonly Record<string, unknown>[];
  record(input: unknown): Record<string, unknown>;
  update(input: unknown): Record<string, unknown>;
  clear(): void;
}

export type ToolHandler = (
  session: ReaSession,
  args: Record<string, unknown>,
  context: { readonly cwd: string; readonly signal?: AbortSignal },
) => Promise<ToolOutcome>;

export type HandlerRegistry = ReadonlyMap<string, ToolHandler>;

export function buildHandlerRegistry(catalog: ToolCatalog): HandlerRegistry {
  void catalog;
  throw new Error("not implemented");
}

export async function dispatchTool(
  registry: HandlerRegistry,
  session: ReaSession,
  name: string,
  rawArgs: unknown,
  context: { readonly cwd: string; readonly signal?: AbortSignal },
): Promise<ToolOutcome> {
  void registry;
  void session;
  void name;
  void rawArgs;
  void context;
  throw new Error("not implemented");
}

export function renderPrompt(
  catalog: ToolCatalog,
  name: string,
  args: Record<string, string>,
): { readonly description: string; readonly messages: readonly { readonly role: "user" | "assistant"; readonly content: string }[] } {
  void catalog;
  void name;
  void args;
  throw new Error("not implemented");
}

export function toCallToolResult(outcome: ToolOutcome, budgetBytes: number): unknown {
  void outcome;
  void budgetBytes;
  throw new Error("not implemented");
}

export function parseAbsolutePath(raw: unknown, cwd: string): AbsolutePath {
  void raw;
  void cwd;
  throw new Error("not implemented");
}

export function responseBudgetBytes(env: NodeJS.ProcessEnv): number {
  void env;
  throw new Error("not implemented");
}

export interface AnalyzerModule {
  readonly openBinary: (session: ReaSession, path: AbsolutePath) => Promise<ToolOutcome>;
  readonly inspectMacho: (session: ReaSession) => Promise<ToolOutcome>;
  readonly inspectPeResources: (session: ReaSession, args: Record<string, unknown>) => Promise<ToolOutcome>;
  readonly inspectPlist: (session: ReaSession, args: Record<string, unknown>) => Promise<ToolOutcome>;
  readonly listArchitectures: (session: ReaSession) => Promise<ToolOutcome>;
}

export function loadSiblingAnalyzers(): AnalyzerModule {
  throw new Error("not implemented");
}

export interface SkillEngineAdapters {
  readonly analyzeJavascriptApplication: ToolHandler;
  readonly inspectArtifact: ToolHandler;
  readonly inspectBinaryLayout: ToolHandler;
  readonly inspectGoBinary: ToolHandler;
  readonly inspectWebNetworkCapture: ToolHandler;
}

export function loadSkillEngineAdapters(skillRoot: AbsolutePath): SkillEngineAdapters {
  void skillRoot;
  throw new Error("not implemented");
}

export function _lifecycleReminder(_ctx: ExtensionContext): void {
  void _ctx;
}
