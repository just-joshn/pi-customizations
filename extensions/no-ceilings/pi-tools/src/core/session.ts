import { homedir } from 'node:os';
import path from 'node:path';

import { minimatch } from 'minimatch';
import { SPILL_DIR } from '../constants.ts';
import type { Decision, Policy, RuleKind, ToolFailure } from '../types.ts';
import { analyzeShellCommand } from './command.ts';
import { type LoadedConfig, loadConfig, type PiToolsConfig } from './config.ts';
import { LayerError } from './errors.ts';
import { createIgnoreResolver, type IgnoreResolver } from './ignore.ts';
import { canonicalPath, displayPath, policySubjects } from './paths.ts';
import { decideMany, isInsideWorkspace, ruleMatches } from './policy.ts';
import { createReadFence, type ReadFence } from './read-fence.ts';

/** The subset of Pi's tool context the layer needs. Pi's own context satisfies it structurally. */
export interface LayerContext {
  readonly cwd: string;
  readonly hasUI?: boolean;
  readonly ui?: { confirm(title: string, message: string): Promise<boolean> };
  readonly isProjectTrusted?: () => boolean;
}

export interface LayerSession {
  readonly cwd: string;
  readonly home: string;
  readonly agentDir: string;
  readonly config: PiToolsConfig;
  readonly configErrors: readonly string[];
  readonly policy: Policy;
  readonly fence: ReadFence;
  readonly spillDir: string;
  /** Ignore rules for this workspace; replaced by `reloadIgnore`. */
  ignore: IgnoreResolver;
  reloadIgnore(): Promise<void>;
}

export interface SessionManagerOptions {
  readonly agentDir: string;
  readonly home?: string;
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** Project configuration loads only when this returns true. Defaults to trusted. */
  readonly isTrusted?: (ctx: LayerContext) => boolean;
  /** Called with configuration problems; never fatal. */
  readonly onConfigError?: (message: string) => void;
}

export interface SessionInit {
  readonly cwd: string;
  readonly agentDir: string;
  readonly home?: string;
  readonly projectTrusted: boolean;
  readonly env?: Readonly<Record<string, string | undefined>>;
}

/** Canonicalize the workspace roots so containment and rules see one spelling per path. */
async function canonicalPolicy(policy: Policy): Promise<Policy> {
  const roots = await Promise.all(policy.workspaceRoots.map((root) => canonicalPath(root)));
  return { ...policy, workspaceRoots: [...new Set(roots)] };
}

export async function createSession(options: SessionInit): Promise<LayerSession> {
  const home = options.home ?? homedir();
  const loaded: LoadedConfig = await loadConfig({
    cwd: options.cwd,
    home,
    agentDir: options.agentDir,
    projectTrusted: options.projectTrusted,
    ...(options.env === undefined ? {} : { env: options.env }),
  });
  const policy = await canonicalPolicy(loaded.policy);
  const ignore = await createIgnoreResolver({ roots: policy.workspaceRoots, fileNames: policy.ignoreFiles });
  const session: LayerSession = {
    cwd: options.cwd,
    home,
    agentDir: options.agentDir,
    config: loaded.config,
    configErrors: loaded.errors,
    policy,
    fence: createReadFence(),
    spillDir: path.join(options.cwd, SPILL_DIR),
    ignore,
    async reloadIgnore() {
      session.ignore = await createIgnoreResolver({ roots: policy.workspaceRoots, fileNames: policy.ignoreFiles });
    },
  };
  return session;
}

export interface SessionManager {
  get(ctx: LayerContext): Promise<LayerSession>;
  /** Force a rebuild, for example after the working directory changed. */
  refresh(ctx: LayerContext, projectTrusted: boolean): Promise<LayerSession>;
  peek(): LayerSession | undefined;
}

/** Caches one session per working directory, so tool calls do not reload configuration. */
export function createSessionManager(options: SessionManagerOptions): SessionManager {
  const sessions = new Map<string, LayerSession>();
  const pending = new Map<string, Promise<LayerSession>>();
  let current: LayerSession | undefined;
  const report = (message: string): void => options.onConfigError?.(message);

  const build = async (ctx: LayerContext, trusted: boolean): Promise<LayerSession> => {
    const session = await createSession({
      cwd: ctx.cwd,
      agentDir: options.agentDir,
      ...(options.home === undefined ? {} : { home: options.home }),
      projectTrusted: trusted,
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    const loaded = await loadConfig({
      cwd: ctx.cwd,
      home: session.home,
      agentDir: options.agentDir,
      projectTrusted: trusted,
      ...(options.env === undefined ? {} : { env: options.env }),
    });
    for (const error of loaded.errors) {
      report(error);
    }
    current = session;
    sessions.set(ctx.cwd, session);
    return session;
  };

  const trusted = (ctx: LayerContext): boolean => options.isTrusted?.(ctx) ?? true;

  return {
    async get(ctx) {
      const cached = sessions.get(ctx.cwd);
      if (cached !== undefined) {
        return cached;
      }
      const inFlight = pending.get(ctx.cwd);
      if (inFlight !== undefined) {
        return inFlight;
      }
      const promise = build(ctx, trusted(ctx)).finally(() => {
        pending.delete(ctx.cwd);
      });
      pending.set(ctx.cwd, promise);
      return promise;
    },
    async refresh(ctx, projectTrusted) {
      sessions.delete(ctx.cwd);
      current = undefined;
      return build(ctx, projectTrusted);
    },
    peek() {
      return current;
    },
  };
}

export interface GuardRequest {
  readonly kind: RuleKind;
  /** The path the caller named plus its canonical form. Rules are checked against every spelling. */
  readonly subjects: readonly string[];
  /** Short description of the action, used in the approval prompt. */
  readonly action: string;
  readonly ctx?: LayerContext;
}

function denial(failure: ToolFailure): LayerError {
  return new LayerError(failure);
}

/** Ask the user to approve a decision when the policy requires it and a UI exists. */
async function confirm(decision: Decision, action: string, subject: string, ctx?: LayerContext): Promise<boolean> {
  if (!ctx?.hasUI || !ctx.ui) {
    return false;
  }
  return ctx.ui.confirm(`Allow ${action}?`, `${subject}\n\n${decision.reason ?? ''}`.trim());
}

function failureFor(decision: Decision, kind: RuleKind, subjects: readonly string[], action: string, approved: boolean): LayerError {
  const subject = subjects[0] ?? '';
  const pathField = kind === 'exec' ? {} : { path: subject };
  if (decision.kind === 'deny') {
    return denial({ kind: 'permission_denied', message: decision.reason ?? 'Blocked by permissions configuration', ...pathField });
  }
  if (!approved) {
    return denial({ kind: 'rejected', message: decision.reason ?? `The ${action} call was not approved`, ...pathField });
  }
  return denial({ kind: 'permission_denied', message: 'Blocked by permissions configuration', ...pathField });
}

/**
 * Apply the policy to one call. Path rules see the named path and its canonical target, so a symlink
 * cannot reach a denied file and a canonical alias cannot escape the workspace.
 */
export async function guard(session: LayerSession, request: GuardRequest): Promise<void> {
  const decision = decideMany(session.policy, request.kind, request.subjects, { canPrompt: request.ctx?.hasUI === true });
  if (decision.kind === 'allow') {
    return;
  }
  if (decision.kind === 'deny') {
    throw failureFor(decision, request.kind, request.subjects, request.action, false);
  }
  const subject = request.kind === 'exec' ? (request.subjects[0] ?? '') : displayPath(request.ctx?.cwd ?? session.cwd, request.subjects[0] ?? '');
  const approved = await confirm(decision, request.action, subject, request.ctx);
  if (approved) {
    return;
  }
  throw failureFor(decision, request.kind, request.subjects, request.action, false);
}

/**
 * Gate a search root. Naming a directory explicitly lets the layer search it, so auto mode approves
 * rather than prompting. Deny rules and allowlist mode still apply to every spelling of the root.
 */
export async function guardSearch(session: LayerSession, subjects: readonly string[]): Promise<void> {
  const readRules = session.policy.rules.filter((rule) => rule.kind === 'read');
  for (const subject of subjects) {
    const denied = readRules.find((rule) => rule.action === 'deny' && ruleMatches(rule, subject, session.policy));
    if (denied) {
      throw denial({ kind: 'permission_denied', message: `Blocked by permissions configuration (rule: ${denied.pattern})`, path: subject });
    }
    if (session.policy.mode === 'allowlist' && !readRules.some((rule) => rule.action === 'allow' && ruleMatches(rule, subject, session.policy))) {
      throw denial({ kind: 'permission_denied', message: 'Blocked by permissions configuration: no allow rule matches this search root', path: subject });
    }
  }
  // A path inside the workspace that resolves outside it is a symlink out. `read` refuses that link,
  // so a search rooted at it must refuse too rather than hand back the directory behind it.
  const named = subjects[0];
  const canonical = subjects[subjects.length - 1];
  if (named !== undefined && canonical !== undefined) {
    // Compare the name's own directory, canonicalized, so a workspace spelled through a symlinked
    // parent still counts as inside while the searched path itself resolves out.
    const namedDirectory = await canonicalPath(path.dirname(named));
    const namedInside = isInsideWorkspace(session.policy, namedDirectory) || isInsideWorkspace(session.policy, named);
    if (namedInside && !isInsideWorkspace(session.policy, canonical)) {
      throw denial({ kind: 'permission_denied', message: 'This call reaches outside the workspace and no approval channel is available', path: named });
    }
  }
}

/**
 * Decide the exec rules over every analyzed spelling of a command. A deny rule blocks if any spelling
 * matches; allowlist mode requires an allow rule for every spelling, not just one segment.
 */
function decideExec(policy: Policy, segments: readonly string[]): Decision {
  const execRules = policy.rules.filter((rule) => rule.kind === 'exec');
  for (const segment of segments) {
    const denied = execRules.find((rule) => rule.action === 'deny' && ruleMatches(rule, segment, policy));
    if (denied) {
      return { kind: 'deny', reason: `Blocked by permissions configuration (rule: ${denied.pattern})`, rule: denied };
    }
  }
  if (policy.mode === 'allowlist') {
    const allAllowed = segments.every((segment) => execRules.some((rule) => rule.action === 'allow' && ruleMatches(rule, segment, policy)));
    if (!allAllowed) {
      return { kind: 'deny', reason: 'Blocked by permissions configuration: no allow rule matches this call' };
    }
  }
  return { kind: 'allow' };
}

/**
 * Gate a shell command. Exec rules see every analyzed spelling, every workspace boundary crossing is
 * checked against the current directory and each `cd` target in order, and a working directory outside
 * the workspace needs approval.
 */
export async function guardCommand(session: LayerSession, command: string, cwd: string, ctx?: LayerContext, home: string = session.home): Promise<void> {
  const canonicalCwd = await canonicalPath(cwd);
  const analysis = analyzeShellCommand(command, home);
  if (analysis.untrusted !== undefined) {
    throw denial({
      kind: 'permission_denied',
      message: `Blocked by permissions configuration: ${analysis.untrusted}. Run the equivalent command with literal words so the policy can see what runs.`,
    });
  }
  const segments = analysis.segments;
  const execDecision = decideExec(session.policy, segments);
  if (execDecision.kind === 'deny') {
    throw failureFor(execDecision, 'exec', segments, 'run command', false);
  }

  let approvalReason: string | undefined;
  for (const use of analysis.paths) {
    const named = path.resolve(canonicalCwd, use.path);
    const subjects = await policySubjects(named);
    const denied = session.policy.rules.find((rule) => (rule.kind === 'read' || rule.kind === 'write') && rule.action === 'deny' && subjects.some((subject) => ruleMatches(rule, subject, session.policy)));
    if (denied) {
      throw denial({ kind: 'permission_denied', message: `Blocked by permissions configuration (rule: ${denied.pattern})`, path: named });
    }
    if (!use.write) {
      continue;
    }
    const canonical = subjects[subjects.length - 1] ?? named;
    // /dev/null is a discard sink. It stays subject to deny rules above, but it is not an outside write.
    if (named === '/dev/null' || canonical === '/dev/null') {
      continue;
    }
    if (isInsideWorkspace(session.policy, canonical)) {
      continue;
    }
    const decision = decideMany(session.policy, 'write', subjects, { canPrompt: ctx?.hasUI === true });
    if (decision.kind === 'deny') {
      throw failureFor(decision, 'write', subjects, 'write outside the workspace', false);
    }
    if (decision.kind === 'approve') {
      approvalReason ??= decision.reason;
    }
  }

  const directories: string[] = [canonicalCwd];
  let current = canonicalCwd;
  for (const target of analysis.directories) {
    current = await canonicalPath(path.resolve(current, target));
    directories.push(current);
  }
  const outside = [...new Set(directories.filter((directory) => !isInsideWorkspace(session.policy, directory)))];
  for (const directory of outside) {
    const decision = decideMany(session.policy, 'write', [directory], { canPrompt: ctx?.hasUI === true });
    if (decision.kind === 'deny') {
      throw failureFor(decision, 'write', [directory], 'run a command outside the workspace', false);
    }
    if (decision.kind === 'approve') {
      approvalReason = decision.reason;
    }
  }
  if (approvalReason === undefined) {
    return;
  }
  const subject = outside.length === 0 ? command : `${command}\n\nworking directory: ${outside[0] ?? ''}`;
  const approved = await confirm({ kind: 'approve', reason: approvalReason }, 'run command', subject, ctx);
  if (!approved) {
    throw denial({ kind: 'rejected', message: approvalReason });
  }
}

/** URL text without credentials, so `https://user@host/` matches a rule written for `https://host/`. */
export function egressSubject(raw: string): string {
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return raw;
  }
}

/** Same path, or a continuation at a `/` boundary. A trailing slash does not create a new segment. */
function pathCovers(rulePath: string, subjectPath: string): boolean {
  const normalize = (value: string): string => (value.length > 1 ? value.replace(/\/+$/, '') : value).toLowerCase();
  const rule = normalize(rulePath);
  const subject = normalize(subjectPath);
  if (rule === '/' || rule === '') {
    return true;
  }
  return subject === rule || subject.startsWith(`${rule}/`);
}

/**
 * A rule with no glob that parses as a URL covers that origin and every path beneath it.
 * Scheme and host must match. A rule that names no port covers any port; a rule that names one
 * covers only that port. The subject's query and fragment are ignored. Returns undefined when
 * either side is not a URL, so wildcard rules stay on minimatch.
 */
function urlPrefixCovers(pattern: string, subject: string): boolean | undefined {
  let rule: URL;
  let target: URL;
  try {
    rule = new URL(pattern);
    target = new URL(subject);
  } catch {
    return undefined;
  }
  if (rule.protocol !== target.protocol || rule.hostname !== target.hostname) {
    return false;
  }
  if (rule.port !== '' && rule.port !== target.port) {
    return false;
  }
  return pathCovers(rule.pathname, target.pathname);
}

/**
 * Match a URL against a read rule pattern, ignoring embedded credentials. A rule that names a host or
 * a path prefix also covers every URL beneath it, the way a path rule covers a directory.
 */
function urlMatches(pattern: string, url: string): boolean {
  const subject = egressSubject(url);
  if (!/[*?]/.test(pattern)) {
    const covered = urlPrefixCovers(pattern, subject);
    if (covered !== undefined) {
      return covered;
    }
  }
  const patterns = new Set([pattern]);
  if (pattern.endsWith('/*')) {
    patterns.add(`${pattern.slice(0, -1)}**`);
  } else if (!/[*?]/.test(pattern)) {
    patterns.add(`${pattern.replace(/\/$/, '')}/**`);
  }
  if (pattern.endsWith('/')) {
    patterns.add(`${pattern}**`);
  }
  return [...patterns].some((candidate) => minimatch(subject, candidate, { dot: true, nocase: true }) || minimatch(subject.replace(/\/$/, ''), candidate, { dot: true, nocase: true }));
}

/**
 * Gate network egress. Read rules apply: a matching deny blocks, a matching allow passes, the default
 * mode asks once per request, and allowlist mode refuses anything unlisted.
 */
export async function guardEgress(session: LayerSession, url: string, ctx?: LayerContext): Promise<void> {
  const rules = session.policy.rules;
  const denied = rules.find((rule) => rule.kind === 'read' && rule.action === 'deny' && urlMatches(rule.pattern, url));
  if (denied) {
    throw denial({ kind: 'permission_denied', message: `Blocked by permissions configuration (rule: ${denied.pattern})` });
  }
  const allowed = rules.find((rule) => rule.kind === 'read' && rule.action === 'allow' && urlMatches(rule.pattern, url));
  if (allowed) {
    return;
  }
  if (session.policy.mode === 'unrestricted') {
    return;
  }
  if (session.policy.mode === 'allowlist') {
    throw denial({ kind: 'permission_denied', message: 'Blocked by permissions configuration: no allow rule matches this URL' });
  }
  const approved = await confirm({ kind: 'approve', reason: 'Network access needs approval' }, 'network access', url, ctx);
  if (!approved) {
    throw denial({ kind: 'rejected', message: 'This call was rejected: network access needs approval' });
  }
}

/** True when a path names one of the configured ignore files inside the workspace. */
export async function isProtectedIgnoreFile(session: LayerSession, target: string): Promise<boolean> {
  if (!session.policy.ignoreFiles.includes(path.basename(target))) {
    return false;
  }
  return isInsideWorkspace(session.policy, await canonicalPath(target));
}

/** Subjects for a path a tool is about to touch. */
export async function subjectsFor(target: string): Promise<string[]> {
  return policySubjects(target);
}

export { isInsideWorkspace };
