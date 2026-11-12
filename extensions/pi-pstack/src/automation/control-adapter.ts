// The control-adapter prerequisite of the reproduce automation, checked concretely. The pack's
// `references/control-adapter.md` says repro and fix work must fail closed when the control skill or the completed
// feature map is absent or incomplete. Which control capabilities the skill drives is the worker's judgment; code
// checks only what it can see: the feature map file and the control skill's presence.
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs';
import { relative, resolve } from 'node:path';

import type { Probe } from './model.ts';
import { resolveSkill, type SkillLocations } from './skills.ts';

export interface ControlConfig {
  skillName: string;
  featureMapPath: string;
}

const REQUIRED_SECTIONS = ['How a user gets there', 'How the control adapter drives it'];

/**
 * A feature map is valid when it sits inside the project and has at least one feature (a `###` heading) with no
 * unfilled `<placeholder>`, and each feature has the sections the control adapter reads before driving the app.
 * The unedited example fails: its template heading is a placeholder.
 */
export function featureMapProblem(projectRoot: string, featureMapPath: string): string | undefined {
  const root = realpathSync(resolve(projectRoot));
  const file = resolve(root, featureMapPath);
  if (relative(root, file).startsWith('..')) return 'the feature map is outside the project';
  if (!existsSync(file) || !statSync(file).isFile()) return `the feature map ${featureMapPath} does not exist`;
  if (relative(root, realpathSync(file)).startsWith('..')) return 'the feature map resolves outside the project';
  const sections = readFileSync(file, 'utf8').split(/^### /m).slice(1);
  if (sections.length === 0) return 'the feature map has no feature section';
  for (const section of sections) {
    const name = section.split('\n')[0]?.trim() ?? '';
    if (/<[^>]+>/.test(name)) return `the feature map still has the placeholder feature ${name}`;
    const missing = REQUIRED_SECTIONS.filter((title) => !new RegExp(`^#### ${title}`, 'm').test(section));
    if (missing.length > 0) return `feature ${name} lacks ${missing.join(' and ')}`;
  }
  return undefined;
}

/** The control skill is any skill the configuration names that Pi can load for this project, not only one this package ships. */
export function controlSkillProblem(skillName: string, locations: SkillLocations): string | undefined {
  const found = resolveSkill(skillName, locations);
  if (found.ok) return undefined;
  return found.problem.endsWith('is not a skill name') ? `control skill name ${found.problem}` : `control skill ${found.problem.replace(/^skill /, '')}`;
}

export function controlProbes(projectRoot: string, control: ControlConfig, locations: Omit<SkillLocations, 'projectRoot'> = {}): { controlAdapter: Probe; featureMap: Probe } {
  return {
    controlAdapter: async () => controlSkillProblem(control.skillName, { projectRoot, ...locations }) ?? true,
    featureMap: async () => featureMapProblem(projectRoot, control.featureMapPath) ?? true,
  };
}
