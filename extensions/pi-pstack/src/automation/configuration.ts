import { readFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import type { AutomationConfig } from '../../adapters/automation-events.ts';
import { isIdentifier, type BennyAutomationKind, type OperationsConfig, type TrackerConfig } from './model.ts';
import { REPO } from './tracker-github.ts';

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid Benny ${name}`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing Benny ${name}`);
  return value;
}

/** The configuration the automation serve process acts on, beyond the fields the adapter core reads. */
export interface BennyConfig extends AutomationConfig {
  /** `repository.url`, where a draft pull request is opened. */
  repositoryUrl: string;
  /** `repository.default_branch`, the base of a draft pull request. */
  defaultBranch: string;
  tracker: TrackerConfig;
  control: { skillName: string; featureMapPath: string };
}

const CHANNEL_ID = /^[A-Z0-9_]{2,32}$/;

export function loadBennyConfig(projectRoot: string, kind: BennyAutomationKind, path = join(projectRoot, '.pi/benny/configuration.yaml')): BennyConfig {
  const raw = object(parse(readFileSync(path, 'utf8')), 'configuration');
  if (raw['schema_version'] !== 1) throw new Error('unsupported Benny schema_version');
  const sections = new Map(['automations', 'slack', 'repository', 'tracker', 'routing', 'control', 'verdict_markers', 'status_emoji', 'budgets', 'models'].map((key) => [key, object(raw[key], key)]));
  const section = (name: string) => sections.get(name)!;
  const name = text(section('automations')[`${kind}_name`], 'automation name');
  if (!isIdentifier(name)) throw new Error('invalid Benny automation name');
  const sourceChannelId = text(section('slack')['source_channel_id'], 'source channel');
  if (!/^[A-Z0-9_]{2,32}$/.test(sourceChannelId)) throw new Error('invalid Benny source channel');
  const triageIdentityUserId = text(section('slack')['triage_identity_user_id'], 'triage identity');
  const trackerType = text(section('tracker')['type'], 'tracker.type');
  // GitHub Issues has no team, project, or status, and the adapter ships with the package. Any other tracker is a project-owned adapter skill.
  const trackerFields = trackerType === 'github' ? ['repo'] : ['adapter_skill_name', 'team', 'project', 'status'];
  for (const [group, fields] of Object.entries({ repository: ['url', 'default_branch'], tracker: trackerFields, control: ['skill_name', 'feature_map_path', 'environment'] })) {
    for (const field of fields) text(section(group)[field], `${group}.${field}`);
  }
  const artifactDirectory = text(section('control')['artifact_directory'], 'control.artifact_directory');
  if (!isAbsolute(artifactDirectory)) throw new Error('invalid Benny control.artifact_directory; expected an absolute path');
  const retention = section('control')['artifact_retention_hours'];
  if (typeof retention !== 'number' || !Number.isFinite(retention) || retention <= 0) throw new Error('invalid Benny control.artifact_retention_hours');
  if (trackerType === 'github' && !REPO.test(text(section('tracker')['repo'], 'tracker.repo'))) throw new Error('invalid Benny tracker.repo; expected owner/name');
  if (section('slack')['allow_source_root_posts'] !== false || section('slack')['allow_worker_slack_writes'] !== false || section('repository')['draft_only'] !== true) throw new Error('unsafe Benny write configuration');
  for (const marker of ['bug', 'performance', 'other']) if (section('verdict_markers')[marker] !== `[benny:${marker}]`) throw new Error('unsupported Benny verdict marker');
  const trackerAttribute = text(section('verdict_markers')['tracker_attribute'], 'verdict_markers.tracker_attribute');
  if (!/^[a-z][a-z_]{0,31}$/.test(trackerAttribute)) throw new Error('invalid Benny verdict_markers.tracker_attribute');
  const labels = object(section('tracker')['labels'], 'tracker.labels');
  for (const label of ['bug', 'performance', 'intake', 'needs_repro']) text(labels[label], `tracker.labels.${label}`);
  for (const model of ['triage', 'reproduce', 'code', 'media_review']) text(section('models')[model], `models.${model}`);
  for (const budget of ['poll_seconds', 'verdict_wait_minutes', 'triage_follow_up_minutes', 'triage_total_minutes', 'repro_minutes', 'rejection_window_minutes', 'fix_minutes', 'operations_follow_up_minutes']) {
    const value = section('budgets')[budget];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`invalid Benny budget ${budget}`);
  }
  const configPath = relative(resolve(projectRoot), resolve(path));
  if (configPath.startsWith('..')) throw new Error('Benny configuration must be project-owned');
  const tracker: TrackerConfig = {
    type: trackerType,
    ...(trackerType === 'github'
      ? { repo: text(section('tracker')['repo'], 'tracker.repo') }
      : {
          adapterSkillName: text(section('tracker')['adapter_skill_name'], 'tracker.adapter_skill_name'),
          team: text(section('tracker')['team'], 'tracker.team'),
          project: text(section('tracker')['project'], 'tracker.project'),
          status: text(section('tracker')['status'], 'tracker.status'),
        }),
    ...(typeof section('tracker')['source_link_title'] === 'string' ? { sourceLinkTitle: section('tracker')['source_link_title'] as string } : {}),
    labels: { bug: text(labels['bug'], 'tracker.labels.bug'), performance: text(labels['performance'], 'tracker.labels.performance'), intake: text(labels['intake'], 'tracker.labels.intake'), needsRepro: text(labels['needs_repro'], 'tracker.labels.needs_repro') },
  };
  const budgetOf = (name: string) => section('budgets')[name] as number;
  const budgets = kind === 'triage' ? { totalMinutes: budgetOf('triage_total_minutes'), followUpMinutes: budgetOf('triage_follow_up_minutes') } : { totalMinutes: budgetOf('repro_minutes'), followUpMinutes: budgetOf('operations_follow_up_minutes'), verdictWaitMinutes: budgetOf('verdict_wait_minutes'), rejectionWindowMinutes: budgetOf('rejection_window_minutes'), fixMinutes: budgetOf('fix_minutes') };
  // An empty operations_channel_id disables the operations thread. A channel is never the source channel: upstream forbids a root post there.
  const operationsChannel = section('slack')['operations_channel_id'];
  if (operationsChannel !== undefined && typeof operationsChannel !== 'string') throw new Error('invalid Benny slack.operations_channel_id');
  if (typeof operationsChannel === 'string' && operationsChannel.trim() !== '' && (!CHANNEL_ID.test(operationsChannel.trim()) || operationsChannel.trim() === sourceChannelId)) throw new Error('invalid Benny operations channel: slack.operations_channel_id must name a channel other than the source channel');
  const emoji = Object.fromEntries(Object.entries(section('status_emoji')).filter((entry): entry is [string, string] => typeof entry[1] === 'string'));
  const operations: OperationsConfig | undefined = typeof operationsChannel === 'string' && operationsChannel.trim() !== '' ? { channelId: operationsChannel.trim(), emoji } : undefined;
  const control = { skillName: text(section('control')['skill_name'], 'control.skill_name'), featureMapPath: text(section('control')['feature_map_path'], 'control.feature_map_path') };
  return { name, kind, projectRoot: resolve(projectRoot), configPath, sourceChannelId, triageIdentityUserId, trackerAttribute, artifactDirectory, artifactRetentionHours: retention, repositoryUrl: text(section('repository')['url'], 'repository.url'), defaultBranch: text(section('repository')['default_branch'], 'repository.default_branch'), model: text(section('models')[kind], `models.${kind}`), tracker, control, budgets, ...(operations === undefined ? {} : { operations }) };
}
