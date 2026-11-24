/** Shared domain types. Wire types live in `acp/protocol.ts`. */

/** Reasoning levels the CLI accepts on `--effort` and `session/set_config_option`. */
export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export const EFFORTS: readonly Effort[] = ['low', 'medium', 'high', 'xhigh', 'max'];

/**
 * One model in the CLI's catalog.
 *
 * The CLI lists effort as part of the id (`gemini-3.8-flash-high`) while also
 * accepting the bare base id plus a separate `thought_level`. The pairs collapse
 * onto one entry per base id so Pi shows one model with thinking levels instead
 * of one model per effort.
 */
export interface CatalogEntry {
  /** Bare id the CLI accepts together with `thought_level`. */
  baseId: string;
  /** Display name with any effort suffix removed. */
  name: string;
  /** Effort levels the CLI offers for this model, as reported by its own config option. */
  efforts: readonly Effort[];
  /** Model ids the CLI advertised, in the order it advertised them. */
  variants: readonly string[];
}

/** What one `initialize` + `session/new` probe reports about the installation. */
export interface Discovery {
  /** `agentInfo.version`, or `"unknown"` when the CLI omits it. */
  version: string;
  /** `_meta.antigravity.tier`, when the CLI sends one. */
  tierName: string | undefined;
  /** Every chat model the session offered, in advertised order. */
  models: readonly CatalogEntry[];
}

/** A tool request the model made that Pi must execute instead of the CLI. */
export interface ToolBridgeCall {
  /** Pi tool name, when the CLI tool maps onto one Pi declared. */
  piTool: string;
  /** Arguments shaped for the Pi tool. */
  arguments: Record<string, unknown>;
  /** The CLI tool name that produced the request, for diagnostics. */
  agyTool: string;
  /** CLI-side call id, echoed into Pi's tool call id when present. */
  callId: string;
}
