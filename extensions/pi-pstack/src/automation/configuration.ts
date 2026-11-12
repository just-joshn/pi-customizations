import { readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { parse } from 'yaml';
import type { AutomationConfig } from '../../adapters/automation-events.ts';
import { isIdentifier, type BennyAutomationKind } from './model.ts';

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`invalid Benny ${name}`);
  return value as Record<string, unknown>;
}
function text(value: unknown, name: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`missing Benny ${name}`);
  return value;
}

export function loadBennyConfig(projectRoot: string, kind: BennyAutomationKind, path = join(projectRoot, '.pi/benny/configuration.yaml')): AutomationConfig {
  const raw = object(parse(readFileSync(path, 'utf8')), 'configuration');
  if (raw['schema_version'] !== 1) throw new Error('unsupported Benny schema_version');
  const sections = new Map(['automations', 'slack', 'repository', 'tracker', 'routing', 'control', 'verdict_markers', 'status_emoji', 'budgets', 'models'].map((key) => [key, object(raw[key], key)]));
  const section = (name: string) => sections.get(name)!;
  const name = text(section('automations')[`${kind}_name`], 'automation name');
  if (!isIdentifier(name)) throw new Error('invalid Benny automation name');
  const sourceChannelId = text(section('slack')['source_channel_id'], 'source channel');
  if (!/^[A-Z0-9_]{2,32}$/.test(sourceChannelId)) throw new Error('invalid Benny source channel');
  const triageIdentityUserId = text(section('slack')['triage_identity_user_id'], 'triage identity');
  for (const [group, fields] of Object.entries({ repository: ['url', 'default_branch'], tracker: ['type', 'adapter_skill_name', 'team', 'project', 'status'], control: ['skill_name', 'feature_map_path', 'environment'] })) {
    for (const field of fields) text(section(group)[field], `${group}.${field}`);
  }
  if (section('slack')['allow_source_root_posts'] !== false || section('slack')['allow_worker_slack_writes'] !== false || section('repository')['draft_only'] !== true) throw new Error('unsafe Benny write configuration');
  for (const marker of ['bug', 'performance', 'other']) if (section('verdict_markers')[marker] !== `[benny:${marker}]`) throw new Error('unsupported Benny verdict marker');
  const labels = object(section('tracker')['labels'], 'tracker.labels');
  for (const label of ['bug', 'performance', 'intake', 'needs_repro']) text(labels[label], `tracker.labels.${label}`);
  for (const model of ['triage', 'reproduce', 'code', 'media_review']) text(section('models')[model], `models.${model}`);
  for (const budget of ['poll_seconds', 'verdict_wait_minutes', 'triage_follow_up_minutes', 'triage_total_minutes', 'repro_minutes', 'rejection_window_minutes', 'fix_minutes', 'operations_follow_up_minutes']) {
    const value = section('budgets')[budget];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) throw new Error(`invalid Benny budget ${budget}`);
  }
  const configPath = relative(resolve(projectRoot), resolve(path));
  if (configPath.startsWith('..')) throw new Error('Benny configuration must be project-owned');
  return { name, kind, projectRoot: resolve(projectRoot), configPath, sourceChannelId, triageIdentityUserId, model: text(section('models')[kind], `models.${kind}`) };
}
