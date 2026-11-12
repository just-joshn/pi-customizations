import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, expect, test } from 'vitest';
import { parse } from 'yaml';
import { loadBennyConfig } from '../../src/automation/configuration.ts';

const upstream = parse(readFileSync(resolve('vendor/upstream-pstack/automations/benny/templates/configuration.example.yaml'), 'utf8')) as Record<string, Record<string, unknown>>;
const shippedText = readFileSync(resolve('generated/automations/benny/templates/configuration.example.yaml'), 'utf8');
const shipped = parse(shippedText) as Record<string, Record<string, unknown>>;

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

test('the shipped configuration template keeps every upstream default and translates only Cursor terms', () => {
  const expected = structuredClone(upstream);
  const slack = expected['slack'] as Record<string, unknown>;
  slack['prefer_pi_pstack_slack_tools'] = slack['prefer_cursor_actions'];
  delete slack['prefer_cursor_actions'];
  (expected['routing'] as Record<string, unknown>)['map_path'] = '.pi/benny/routing.md';
  (expected['control'] as Record<string, unknown>)['feature_map_path'] = '.pi/benny/feature-map.md';
  expect(shipped).toEqual(expected);
});

test('the template defaults to a project-owned tracker adapter skill, with GitHub Issues as the additional type', () => {
  expect(shipped['tracker']).toMatchObject({ type: 'linear', adapter_skill_name: 'issue-tracker-adapter-placeholder', team: 'team-placeholder', project: 'project-placeholder', status: 'intake-status-placeholder' });
  expect(shipped['control']).toMatchObject({ skill_name: 'control-target-app' });
  expect(shipped['slack']).toMatchObject({ operations_channel_id: '', read_action: 'configured-slack-read-action', thread_post_action: 'configured-slack-thread-post-action', file_download_action: 'configured-slack-file-download-action', operations_edit_action: 'configured-slack-edit-action' });
  expect(shippedText).toMatch(/type: "github"[^\n]*\n[^\n]*repo/);
});

function load(text: string) {
  const dir = mkdtempSync(join(tmpdir(), 'benny-template-'));
  dirs.push(dir);
  const file = join(dir, 'configuration.yaml');
  writeFileSync(file, text);
  return loadBennyConfig(dir, 'triage', file);
}

test('the loader reads the template as shipped, with the adapter skill the project owns', () => {
  expect(load(shippedText).tracker).toMatchObject({ type: 'linear', adapterSkillName: 'issue-tracker-adapter-placeholder', team: 'team-placeholder', project: 'project-placeholder', status: 'intake-status-placeholder', sourceLinkTitle: 'Slack report' });
});

test('the GitHub tracker type loads without team, project, status, or an adapter skill', () => {
  const github = shippedText.replace(/  type: "linear"[\s\S]*?  status: "intake-status-placeholder"\n/, '  type: "github"\n  repo: "acme/app"\n  labels:\n    bug: "bug"\n    performance: "performance"\n    intake: "intake"\n    needs_repro: "needs-repro"\n');
  expect(load(github).tracker).toMatchObject({ type: 'github', repo: 'acme/app' });
});
