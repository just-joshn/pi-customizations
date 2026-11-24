/**
 * Wire types for the Agent Client Protocol (ACP) as the Antigravity CLI serves it.
 *
 * Every shape here was read from a live `agy acp --stdio` session on `agy` 1.5.15
 * or from the CLI's own JSON tag literals. Fields beyond what this extension reads
 * are omitted on purpose; unknown fields are ignored rather than rejected, because
 * the CLI adds them between releases.
 */

export type AcpId = number | string;

export interface AcpError {
  code: number;
  message: string;
  data?: unknown;
}

/** One JSON-RPC message the CLI may write. Discriminate with `hasId`. */
export interface AcpEnvelope {
  jsonrpc?: string;
  id?: AcpId;
  method?: string;
  params?: unknown;
  result?: unknown;
  error?: AcpError;
}

export interface AcpRequestMessage {
  jsonrpc: '2.0';
  id: AcpId;
  method: string;
  params?: unknown;
}

export type AcpResponseMessage = { jsonrpc: '2.0'; id: AcpId } & ({ result: unknown } | { error: AcpError });

/** A server-to-client request, such as `session/request_permission`. */
export interface AcpServerRequest extends AcpEnvelope {
  id: AcpId;
  method: string;
}

/** A server-to-client notification, such as `session/update`. Never carries an id. */
export interface AcpNotification extends Omit<AcpEnvelope, 'id'> {
  method: string;
}

export interface PromptCapabilities {
  image?: boolean;
  audio?: boolean;
  embeddedContext?: boolean;
}

export interface InitializeResult {
  protocolVersion?: number;
  agentCapabilities?: {
    loadSession?: boolean;
    promptCapabilities?: PromptCapabilities;
  };
  agentInfo?: { name?: string; version?: string };
  authMethods?: ReadonlyArray<{ id?: string; name?: string; description?: string }>;
}

export interface ConfigOptionChoice {
  value: string;
  name?: string;
  description?: string;
}

export interface ConfigOption {
  id: string;
  name?: string;
  category?: string;
  type?: string;
  currentValue?: string;
  options?: ReadonlyArray<ConfigOptionChoice>;
}

export interface AvailableModel {
  modelId: string;
  name?: string;
}

/**
 * The CLI's system-prompt append channel, advertised by `initialize` as
 * `_meta.antigravity.systemPrompt.append` and consumed by `session/new` as
 * `_meta.antigravity.systemPrompt.append`. Verified on 1.5.15: text sent this way
 * reaches the model as a system instruction.
 */
export interface SystemPromptAppend {
  append: string;
}

export interface SessionNewParams {
  cwd: string;
  mcpServers: readonly { name: string; command: string; args: readonly string[] }[];
  _meta?: { antigravity: { systemPrompt: SystemPromptAppend } };
}

/** `_meta.antigravity.tier` on `session/new`. */
export interface AntigravityTier {
  name?: string;
  id?: string;
  upgradeUri?: string;
}

export interface SessionNewResult {
  sessionId?: string;
  models?: { availableModels?: ReadonlyArray<AvailableModel>; currentModelId?: string };
  modes?: { currentModeId?: string; availableModes?: ReadonlyArray<{ id: string; name?: string }> };
  configOptions?: ReadonlyArray<ConfigOption>;
  _meta?: { antigravity?: { tier?: AntigravityTier } };
}

export interface SetConfigOptionResult {
  configOptions?: ReadonlyArray<ConfigOption>;
}

export type PromptStopReason = 'end_turn' | 'max_tokens' | 'max_turn_requests' | 'refusal' | 'cancelled' | (string & {});

export interface PromptResult {
  stopReason?: PromptStopReason;
}

export type ContentBlock = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string } | { type: string; [key: string]: unknown };

/** Tool-call detail shared by the `tool_call` session update and `request_permission`. */
export interface ToolCallInfo {
  toolCallId?: string;
  /** The CLI's canonical tool name. Observed on every live `tool_call` and permission request. */
  name?: string;
  title?: string;
  kind?: string;
  status?: string;
  content?: unknown;
  locations?: unknown;
  /** The arguments the model produced, in the CLI's own PascalCase field names. */
  rawInput?: unknown;
}

export type SessionUpdate =
  | { sessionUpdate: 'agent_message_chunk'; content?: ContentBlock }
  | { sessionUpdate: 'agent_thought_chunk'; content?: ContentBlock }
  | { sessionUpdate: 'user_message_chunk'; content?: ContentBlock }
  | ({ sessionUpdate: 'tool_call' } & ToolCallInfo)
  | ({ sessionUpdate: 'tool_call_update' } & ToolCallInfo)
  | { sessionUpdate: 'usage_update'; used?: number; size?: number }
  | { sessionUpdate: 'current_mode_update'; currentModeId?: string }
  | { sessionUpdate: 'available_commands_update'; availableCommands?: ReadonlyArray<{ name: string }> }
  | { sessionUpdate: 'session_info_update'; title?: string }
  | { sessionUpdate: string; [key: string]: unknown };

export interface SessionUpdateParams {
  sessionId?: string;
  update?: SessionUpdate;
}

export interface PermissionOption {
  optionId: string;
  name?: string;
  /** `allow_once`, `allow_always`, `reject_once`, or `reject_always`. */
  kind?: string;
}

export interface RequestPermissionParams {
  sessionId?: string;
  toolCall?: ToolCallInfo;
  options?: ReadonlyArray<PermissionOption>;
}

export type PermissionOutcome = { outcome: 'selected'; optionId: string } | { outcome: 'cancelled' };

export interface RequestPermissionResult {
  outcome?: PermissionOutcome;
}

/** Method names the CLI advertises. Only the ones this extension calls are listed. */
export const ACP_METHODS = {
  initialize: 'initialize',
  newSession: 'session/new',
  prompt: 'session/prompt',
  cancel: 'session/cancel',
  close: 'session/close',
  setConfigOption: 'session/set_config_option',
  setMode: 'session/set_mode',
  update: 'session/update',
  requestPermission: 'session/request_permission',
} as const;

export const CONFIG_MODEL = 'model';
export const CONFIG_THOUGHT_LEVEL = 'thought_level';

/** `initialize` or `session/new` answered with this until the CLI finishes its keyring read. */
export const AUTH_REQUIRED_CODE = -32_000;
