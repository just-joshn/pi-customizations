/** Shared types for the tool layer. */
import type { AgentToolResult } from '@earendil-works/pi-agent-core';

export type RuleKind = 'read' | 'write' | 'exec';
export type RuleAction = 'allow' | 'deny';

export interface PolicyRule {
  readonly kind: RuleKind;
  readonly action: RuleAction;
  /** Glob for read/write rules, command glob for exec rules. */
  readonly pattern: string;
}

/**
 * How strictly calls are gated.
 * - `unrestricted` applies deny rules only.
 * - `auto` also asks before reaching outside the workspace.
 * - `allowlist` permits only what an allow rule names.
 */
export type ApprovalMode = 'unrestricted' | 'auto' | 'allowlist';

export interface Policy {
  readonly mode: ApprovalMode;
  readonly rules: readonly PolicyRule[];
  readonly workspaceRoots: readonly string[];
  readonly ignoreFiles: readonly string[];
  /** Absolute paths of the ignore files that contributed rules. */
  readonly ignoreSources: readonly string[];
}

export type DecisionKind = 'allow' | 'deny' | 'approve';

export interface Decision {
  readonly kind: DecisionKind;
  readonly reason?: string;
  readonly rule?: PolicyRule;
}

export interface FileFingerprint {
  readonly sha256: string;
  readonly bytes: number;
}

export type ReadRecord = { readonly kind: 'content'; readonly fingerprint: FileFingerprint } | { readonly kind: 'absent' };

export interface FileMetadata {
  readonly path: string;
  readonly bytes: number;
  readonly lines: number;
  readonly mtimeMs: number;
  readonly sha256?: string;
}

export type FailureKind = 'error' | 'rejected' | 'permission_denied' | 'file_not_found' | 'not_file' | 'not_directory' | 'invalid_file' | 'file_busy' | 'no_space' | 'timeout' | 'stale' | 'invalid_arguments';

export interface ToolFailure {
  readonly kind: FailureKind;
  readonly path?: string;
  readonly message: string;
  /** Extra model-facing guidance appended after the message. */
  readonly hint?: string;
}

/** Structured content shape Pi accepts on a tool result. */
export type StructuredContent = AgentToolResult<unknown>['structuredContent'];

/** Model content block. Images are passed through to Pi unchanged. */
export type ContentBlock = { readonly type: 'text'; readonly text: string } | { readonly type: 'image'; readonly data: string; readonly mimeType: string };

export interface ToolOutcome<TDetails> {
  readonly content: readonly ContentBlock[];
  readonly details: TDetails;
  readonly structuredContent?: StructuredContent;
  readonly isError?: boolean;
}
