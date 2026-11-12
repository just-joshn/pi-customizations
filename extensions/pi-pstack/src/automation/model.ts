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
  files: { name: string; mimetype: string; permalink: string; size?: number; /** Slack's private download link. Only the parent follows it, with its own credential. */ downloadUrl?: string }[];
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
        .map((file) => {
          const link = str(file['url_private_download']) || str(file['url_private']);
          const size = file['size'];
          return { name: str(file['name']) ?? '', mimetype: str(file['mimetype']) ?? '', permalink: str(file['permalink']) ?? '', ...(typeof size === 'number' && Number.isFinite(size) && size >= 0 ? { size } : {}), ...(link ? { downloadUrl: link } : {}) };
        }),
    },
  };
}

export type Prerequisite = 'tracker' | 'controlAdapter' | 'featureMap';
export type BennyAutomationKind = 'triage' | 'reproduce';
export type AutomationKind = BennyAutomationKind | 'routine';
/** `true`: holds. `false`: could not be established. A string: it does not hold, and why. */
export type Probe = () => Promise<boolean | string>;

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
  /** Evidence files the parent staged for this reply. They go up with the one reply, so it stays one message. */
  attachments?: { path: string; name: string; mimetype: string }[];
  /** What the reply says when its files cannot be attached, for example `text` and a link to the operations thread. The reply never fails for want of its files. */
  textWithoutAttachments?: string;
}

export interface TrackerIntent {
  operation: 'create' | 'update' | 'comment';
  targetId?: string;
  title?: string;
  body: string;
}
export interface TrackerAction extends Omit<TrackerIntent, 'operation'> {
  id: ActionId;
  kind: 'tracker';
  /** `close` is the parent's compensation for an issue it created and could not announce. A worker's intent never carries it. */
  operation: TrackerIntent['operation'] | 'close';
  sourceUrl: string;
  /** Set by the parent from the verdict marker and configuration, never taken from the worker. Create only. */
  labels?: string[];
}
/** The operations status message: the one root post the repro workflow may make, in the operations channel only. */
export interface OpsRootAction {
  id: ActionId;
  kind: 'ops-root';
  channel: string;
  text: string;
}
/** Sets the text of the operations root message that action `rootId` posted. */
export interface OpsEditAction {
  id: ActionId;
  kind: 'ops-edit';
  channel: string;
  rootId: ActionId;
  text: string;
}
export type OutboxAction = ThreadReplyAction | TrackerAction | OpsRootAction | OpsEditAction;

/** The status strings of the repro workflow (vendor reproduce SKILL.md section 4), each with its `status_emoji` key. */
export const OPS_STATUSES = {
  Reproducing: 'reproducing',
  'Could not reproduce': 'could_not_reproduce',
  Blocked: 'blocked',
  Reproduced: 'reproduced',
  'Verifying existing fix': 'reproducing',
  'Attempting bounded fix': 'fixing',
  'Draft pull request opened': 'pull_request_opened',
  'Fix did not land': 'fix_failed',
} as const;
export type OpsStatus = keyof typeof OPS_STATUSES;
export const isOpsStatus = (value: unknown): value is OpsStatus => typeof value === 'string' && Object.hasOwn(OPS_STATUSES, value);

/** The operations channel and the configured plain Unicode status strings. An empty `operations_channel_id` means none. */
export interface OperationsConfig {
  channelId: string;
  emoji: Record<string, string>;
}

/** Short status text: the emoji and the status, then one short note, then the source link. A worker's note cannot carry markers or links of its own. */
export function opsText(operations: OperationsConfig, status: OpsStatus, sourceUrl: string, note?: string): string {
  const cleaned = untrustedText(note ?? '').replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return [`${operations.emoji[OPS_STATUSES[status]] ?? ''} ${status}`.trim(), ...(cleaned === '' ? [] : [cleaned]), sourceUrl].join('\n');
}
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

/** The start of a line that links a source: `Source:` after optional whitespace and quote or emphasis characters. */
const SOURCE_LINE = /^[\s>*_-]*source\s*:/i;

/**
 * Worker-supplied text a parent copies into an external system. It cannot carry an action marker or a `Source:` line,
 * so every `Source:` line a tracker holds was written by the parent or by a person, which is what `linksSource` trusts.
 */
export const untrustedText = (text: string) =>
  text
    .replace(/<!--\s*pstack-action:[^>]*-->/g, '')
    .split('\n')
    .filter((line) => !SOURCE_LINE.test(line))
    .join('\n');

/** Whether `text` has a `Source:` line naming exactly `url`, with or without Slack's `<url|label>` or angle brackets. */
export const linksSource = (text: string, url: string): boolean =>
  text.split('\n').some((line) => {
    const prefix = SOURCE_LINE.exec(line);
    const named = prefix === null ? undefined : line.slice(prefix[0].length).replace(/^[*_\s]+/, '').split(/\s+/)[0]?.replace(/^<|>$/g, '').split('|')[0];
    return named === url;
  });

/** The Slack permalink the parent computes from the immutable source coordinates. */
export const sourceUrlOf = (event: Pick<AutomationEvent, 'channel' | 'rootTs'>) => `https://slack.com/archives/${event.channel}/p${event.rootTs.replace('.', '')}`;

export type Classification = 'bug' | 'performance' | 'other';

/** The verdict category of a reply, read from its marker; a reply with none counts as `other`. */
export function classificationOf(reply: string): Classification {
  const found = /\[benny:(bug|performance|other)\]/.exec(reply)?.[1];
  return found === 'bug' || found === 'performance' ? found : 'other';
}

/** A link a verdict may carry: http or https, one token, no characters that end a Slack link or a marker line. */
export const isTrackerUrl = (value: string) => /^https?:\/\/[^\s<>\]|]{1,500}$/.test(value);

const MARKER_LINE = /^(\[benny:(?:bug|performance|other)\])(.*)$/;
const attributeOf = (attribute: string) => new RegExp(`\\s+${attribute}=\\S+`, 'g');

/** The tracker url in the marker line of a verdict (`[benny:bug] tracker=<url>`), when it is a link a verdict may carry. */
export function trackerUrlOf(verdict: string, attribute: string): string | undefined {
  const rest = MARKER_LINE.exec(verdict.trimEnd().split('\n').at(-1)?.trim() ?? '')?.[2] ?? '';
  const url = new RegExp(`\\s${attribute}=(\\S+)`).exec(rest)?.[1];
  return url !== undefined && isTrackerUrl(url) ? url : undefined;
}

/**
 * The verdict with the parent's tracker url in its marker line, and only that url: one the worker wrote is replaced,
 * and without a url the attribute is dropped, because only the parent knows which issue it wrote or updated. The
 * result is the same however often it is applied.
 */
export function withTrackerAttribute(verdict: string, attribute: string, url: string | undefined): string {
  const lines = verdict.trimEnd().split('\n');
  const marker = MARKER_LINE.exec(lines.at(-1)?.trim() ?? '');
  if (marker === null) return verdict;
  const line = `${marker[1]}${(marker[2] ?? '').replace(attributeOf(attribute), '').trimEnd()}${url === undefined || !isTrackerUrl(url) ? '' : ` ${attribute}=${url}`}`;
  return line === lines.at(-1) ? verdict : [...lines.slice(0, -1), line].join('\n');
}

const oneLine = (value: string) => value.replace(/\s+/g, ' ').trim().slice(0, 200);

/** Triage replies need a marker, and `other` is the one the repro automation never trusts, so a failure cannot start a repro. */
export function failureReply(kind: BennyAutomationKind, failure: string): string {
  const reason = oneLine(failure);
  return kind === 'triage' ? `Benny triage could not finish this report: ${reason}. No ticket was created.\n[benny:other]` : `Benny repro and fix could not finish: ${reason}. No pull request was opened.`;
}

export interface WorkerResult {
  text: string;
  /** Repro only: evidence files in the run's artifact directory the worker asks to have attached to the source reply. The parent decides which may be. */
  evidence?: string[];
  tracker?: TrackerIntent;
  /** Repro only: where the run ended, in the operations status strings. */
  status?: OpsStatus;
  /** Repro only: the concise reply for the operations thread. */
  operations?: string;
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
