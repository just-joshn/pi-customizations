import { createHash } from 'node:crypto';

/** `<channel>:<root ts>`. The root coordinates never change while a case progresses, so they key every event of it. */
export type EventKey = string & { readonly __brand: 'EventKey' };
export type RunId = string & { readonly __brand: 'RunId' };
export type ActionId = string & { readonly __brand: 'ActionId' };

const IDENTIFIER = /^[a-z0-9][a-z0-9-]{0,39}$/;
const CHANNEL = /^[A-Z0-9]{2,32}$/;
const SLACK_TS = /^\d{1,12}\.\d{1,9}$/;

export function isIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

export interface AutomationEvent {
  key: EventKey;
  channel: string;
  rootTs: string;
  messageTs: string;
  user: string;
  text: string;
  files: { name: string; mimetype: string; permalink: string }[];
}

export type ParsedEvent = { ok: true; event: AutomationEvent } | { ok: false; reason: string };

const str = (value: unknown): string | undefined => (typeof value === 'string' ? value.trim() : undefined);

/**
 * The trigger shape Benny's prompts read: `source_channel_id`, `ts` (or the templates' `message_ts`), optional
 * `thread_ts`, `user`, `text`, `files`. The root is `thread_ts` when present, else `ts`. Anything that leaves the source
 * thread uncertain is refused.
 */
export function parseEvent(raw: unknown): ParsedEvent {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return { ok: false, reason: 'event is not a JSON object' };
  const body = raw as Record<string, unknown>;
  const channel = str(body['source_channel_id']);
  const ts = str(body['ts']);
  const messageTs = str(body['message_ts']);
  if (ts && messageTs && ts !== messageTs) return { ok: false, reason: 'ts and message_ts disagree' };
  const own = ts || messageTs;
  const thread = str(body['thread_ts']);
  if (!channel || !CHANNEL.test(channel)) return { ok: false, reason: 'missing or malformed source_channel_id' };
  if (!own || !SLACK_TS.test(own)) return { ok: false, reason: 'missing or malformed message ts' };
  if (thread && !SLACK_TS.test(thread)) return { ok: false, reason: 'malformed thread_ts' };
  const rootTs = thread || own;
  const files = Array.isArray(body['files']) ? body['files'] : [];
  return {
    ok: true,
    event: {
      key: `${channel}:${rootTs}` as EventKey,
      channel,
      rootTs,
      messageTs: own,
      user: str(body['user']) ?? '',
      text: typeof body['text'] === 'string' ? body['text'] : '',
      files: files
        .filter((file): file is Record<string, unknown> => typeof file === 'object' && file !== null)
        .map((file) => ({ name: str(file['name']) ?? '', mimetype: str(file['mimetype']) ?? '', permalink: str(file['permalink']) ?? '' })),
    },
  };
}

export type Prerequisite = 'tracker' | 'controlAdapter' | 'featureMap';
export type BennyAutomationKind = 'triage' | 'reproduce';
export type AutomationKind = BennyAutomationKind | 'routine';
export type Probe = () => Promise<boolean>;

const BENNY_MARKERS = ['[benny:bug]', '[benny:performance]', '[benny:other]'] as const;

/** What each Benny automation needs before it may act, which operational file it follows, and what its reply must carry. */
export const AUTOMATION_KINDS: Record<BennyAutomationKind, { operationalFile: string; requires: readonly Prerequisite[]; workspace: 'readonly' | 'worktree'; replyMarkers: readonly string[] | null }> = {
  triage: {
    operationalFile: '.pi/automations/benny/skills/triage-issue-reports/SKILL.md',
    requires: ['tracker'],
    workspace: 'readonly',
    replyMarkers: BENNY_MARKERS,
  },
  reproduce: {
    operationalFile: '.pi/automations/benny/skills/reproduce-and-fix-issues/SKILL.md',
    requires: ['tracker', 'controlAdapter', 'featureMap'],
    workspace: 'worktree',
    replyMarkers: null,
  },
};

/** Contract capability boundary for automation-dispatched workers. */
export const AUTOMATION_CAPABILITIES = { mcp: 'none', env: 'minimal', externalWrite: false } as const;

export const WORKER_ID = 'owner';

const shortHash = (...parts: string[]) => createHash('sha256').update(parts.join('\0')).digest('hex').slice(0, 16);

export function runIdFor(automation: string, key: EventKey): RunId {
  return `auto-${shortHash(automation, key)}` as RunId;
}

export function actionIdFor(automation: string, key: EventKey, purpose: string): ActionId {
  return `act-${shortHash(automation, key, purpose)}` as ActionId;
}

export interface ThreadReplyAction {
  id: ActionId;
  kind: 'thread-reply';
  channel: string;
  /** Always the root ts: a reply never becomes a root message. */
  threadTs: string;
  text: string;
}

export interface TrackerIntent {
  operation: 'create' | 'update' | 'comment';
  targetId?: string;
  title?: string;
  body: string;
}
export interface TrackerAction extends TrackerIntent {
  id: ActionId;
  kind: 'tracker';
  sourceUrl: string;
  /** Set by the parent from the verdict marker and configuration, never taken from the worker. Create only. */
  labels?: string[];
}
export type OutboxAction = ThreadReplyAction | TrackerAction;
/** The tracker section of the Benny configuration, as the parent adapter needs it. */
export interface TrackerConfig {
  type: string;
  /** `owner/name`, required by the GitHub adapter. */
  repo?: string;
  /** Any other tracker: the project-owned skill the parent's tracker worker loads, and the targets it resolves at runtime. */
  adapterSkillName?: string;
  team?: string;
  project?: string;
  status?: string;
  sourceLinkTitle?: string;
  labels: { bug: string; performance: string; intake: string; needsRepro: string };
}

/** The Slack permalink the parent computes from the immutable source coordinates. */
export const sourceUrlOf = (event: Pick<AutomationEvent, 'channel' | 'rootTs'>) => `https://slack.com/archives/${event.channel}/p${event.rootTs.replace('.', '')}`;

export type Classification = 'bug' | 'performance' | 'other';

/** The verdict category of a reply, read from its marker; a reply with none counts as `other`. */
export function classificationOf(reply: string): Classification {
  const found = /\[benny:(bug|performance|other)\]/.exec(reply)?.[1];
  return found === 'bug' || found === 'performance' ? found : 'other';
}

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Triage replies need a marker, and `other` is the one the repro automation never trusts, so a failure cannot start a repro. */
export function failureReply(kind: BennyAutomationKind, failure: string): string {
  const reason = oneLine(failure);
  return kind === 'triage' ? `Benny triage could not finish this report: ${reason}. No ticket was created.\n[benny:other]` : `Benny repro and fix could not finish: ${reason}. No pull request was opened.`;
}

export interface WorkerResult {
  text: string;
  tracker?: TrackerIntent;
}
export interface TrackerEligibility {
  classification: Classification;
  clearlyBroken: boolean;
  live: boolean;
  duplicate: 'none' | 'confident' | 'possible' | 'weak' | 'already-linked';
  duplicateId?: string;
  sourceVerified: boolean;
  targetResolved: boolean;
  canCompensate: boolean;
}
export function eligibleTrackerAction(intent: TrackerIntent, policy: TrackerEligibility): boolean {
  if (!['bug', 'performance'].includes(policy.classification) || !policy.live || !policy.sourceVerified || !policy.targetResolved || !intent.body?.trim()) return false;
  if (intent.operation === 'create') return policy.clearlyBroken && policy.duplicate === 'none' && policy.canCompensate && !!intent.title?.trim() && intent.targetId === undefined;
  return ['update', 'comment'].includes(intent.operation) && intent.title === undefined && policy.duplicate === 'confident' && !!policy.duplicateId && intent.targetId === policy.duplicateId;
}
