import { homedir } from 'node:os';
import path from 'node:path';

import { minimatch } from 'minimatch';
import type { ApprovalMode, Decision, Policy, PolicyRule, RuleAction, RuleKind } from '../types.ts';

export type { Policy };

import { expandHome, isInside, relativeTo, toPosix } from './paths.ts';

export interface PolicyInit {
  readonly cwd: string;
  readonly home?: string;
  readonly mode?: ApprovalMode;
  readonly rules?: readonly PolicyRule[];
  readonly workspaceRoots?: readonly string[];
  readonly ignoreFiles?: readonly string[];
  readonly ignoreSources?: readonly string[];
}

export const DEFAULT_MODE: ApprovalMode = 'auto';

/**
 * Build the immutable policy value a session runs under.
 * Relative workspace roots resolve against the working directory; `~` still expands to home.
 */
export function createPolicy(init: PolicyInit): Policy {
  const home = init.home ?? homedir();
  const configured = init.workspaceRoots && init.workspaceRoots.length > 0 ? init.workspaceRoots : ['.'];
  const roots = configured.map((root) => path.resolve(init.cwd, expandHome(root, home)));
  return {
    mode: init.mode ?? DEFAULT_MODE,
    rules: init.rules ?? [],
    workspaceRoots: roots,
    ignoreFiles: init.ignoreFiles ?? [],
    ignoreSources: init.ignoreSources ?? [],
  };
}

/** A path counts as inside the workspace when any configured root contains it. */
export function isInsideWorkspace(policy: Policy, target: string): boolean {
  return policy.workspaceRoots.some((root) => isInside(root, target));
}

/** Command glob: `*` matches any characters, including `/` and spaces, because commands are not paths. */
function commandMatches(pattern: string, command: string): boolean {
  const normalized = command.trim().replace(/\s+/g, ' ');
  const source = pattern
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.');
  return new RegExp(`^${source}$`).test(normalized);
}

/** Does a rule apply to the subject? Path rules match absolute and workspace-relative forms. */
export function ruleMatches(rule: PolicyRule, subject: string, policy: Policy): boolean {
  const options = { dot: true, nocase: process.platform === 'darwin', matchBase: !rule.pattern.includes('/') };
  if (rule.kind === 'exec') {
    return commandMatches(rule.pattern, subject);
  }
  const absolute = toPosix(path.resolve(subject));
  if (minimatch(absolute, rule.pattern, options)) {
    return true;
  }
  // A pattern that names a directory also allows everything beneath it.
  const withDescendants = `${rule.pattern.replace(/\/$/, '')}/**`;
  if (minimatch(absolute, withDescendants, options)) {
    return true;
  }
  return policy.workspaceRoots.some((root) => {
    const relative = relativeTo(root, absolute);
    return minimatch(relative, rule.pattern, options) || minimatch(relative, withDescendants, options);
  });
}

function findRule(policy: Policy, kind: RuleKind, subject: string, action: RuleAction): PolicyRule | undefined {
  return policy.rules.find((rule) => rule.kind === kind && rule.action === action && ruleMatches(rule, subject, policy));
}

export interface DecideOptions {
  /** True when the caller can ask the user, and an approval prompt is meaningful. */
  readonly canPrompt: boolean;
}

/**
 * Decide one call over every spelling of its subject. Deny rules apply to each spelling; containment
 * uses the last spelling, which callers set to the canonical path. Allow rules and deny rules see the
 * named path too, so a rule that names a symlink still applies.
 */
export function decideMany(policy: Policy, kind: RuleKind, subjects: readonly string[], options: DecideOptions): Decision {
  let allowed: PolicyRule | undefined;
  for (const subject of subjects) {
    const denied = findRule(policy, kind, subject, 'deny');
    if (denied) {
      return { kind: 'deny', reason: `Blocked by permissions configuration (rule: ${denied.pattern})`, rule: denied };
    }
    allowed ??= findRule(policy, kind, subject, 'allow');
  }
  // In allowlist mode an allow rule must name the canonical target, so a rule written for a symlink
  // cannot authorize a different file behind it.
  if (allowed && policy.mode === 'allowlist' && kind !== 'exec') {
    const canonical = subjects[subjects.length - 1] ?? '';
    const canonicalRule = findRule(policy, kind, canonical, 'allow');
    if (!canonicalRule) {
      allowed = undefined;
    } else {
      allowed = canonicalRule;
    }
  }
  if (allowed) {
    return { kind: 'allow', rule: allowed };
  }
  if (policy.mode === 'allowlist') {
    return { kind: 'deny', reason: 'Blocked by permissions configuration: no allow rule matches this call' };
  }
  if (policy.mode === 'unrestricted') {
    return { kind: 'allow' };
  }
  const containmentTarget = subjects[subjects.length - 1] ?? '';
  if (kind === 'exec' || isInsideWorkspace(policy, containmentTarget)) {
    return { kind: 'allow' };
  }
  if (options.canPrompt) {
    return { kind: 'approve', reason: 'This call reaches outside the workspace and needs approval' };
  }
  return { kind: 'deny', reason: 'This call reaches outside the workspace and no approval channel is available' };
}

/** Decide one call for a single subject, expected to be canonical. */
export function decide(policy: Policy, kind: RuleKind, subject: string, options: DecideOptions): Decision {
  return decideMany(policy, kind, [subject], options);
}

/** Is this path inside a directory the policy forbids searching? */
export function isSearchBlocked(policy: Policy, target: string): boolean {
  return decide(policy, 'read', target, { canPrompt: false }).kind === 'deny';
}
