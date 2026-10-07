import type { RegistrySnapshot } from '../domain/registry.ts';
import type { InstalledSkill } from '../domain/run.ts';
import type { Phase } from '../domain/state.ts';

export type InvocationCheck = { readonly kind: 'allowed' } | { readonly kind: 'user_only'; readonly action: string } | { readonly kind: 'not_in_registry' } | { readonly kind: 'not_installed'; readonly install: string };

export function canModelInvoke(registry: RegistrySnapshot, skill: string, installed: readonly InstalledSkill[]): InvocationCheck {
  const locked = registry.skills.find((candidate) => candidate.name === skill);
  if (locked === undefined) return { kind: 'not_in_registry' };
  if (locked.invocationPolicy === 'user') return { kind: 'user_only', action: `/skill:${skill}` };
  if (!installed.some((candidate) => candidate.name === skill)) return { kind: 'not_installed', install: `npx skills add ${locked.source} --skill ${skill}` };
  return { kind: 'allowed' };
}

export function installedDrift(registry: RegistrySnapshot, installed: readonly InstalledSkill[]): readonly string[] {
  return installed.flatMap((skill) => {
    const locked = registry.skills.find((candidate) => candidate.name === skill.name);
    if (locked === undefined || skill.contentHash === null || skill.contentHash === locked.lock.contentHash) return [];
    return [`installed ${skill.name} (${skill.contentHash.slice(0, 19)}) differs from locked ${locked.source}${locked.lock.kind === 'git_commit' ? `@${locked.lock.commit.slice(0, 7)}` : ''}`];
  });
}

export type RouteCondition = 'always' | 'model_change' | 'react_stack' | 'web_ui' | 'browser_consumer';

export type RouteSkill = { readonly skill: string; readonly when: RouteCondition; readonly policy: 'model' | 'user' };

const ROUTE_SKILLS: { readonly [P in Phase]: readonly RouteSkill[] } = {
  START: [],
  PREFLIGHT: [],
  CLASSIFY: [],
  CLARIFY: [{ skill: 'grilling', when: 'always', policy: 'model' }],
  DIAGNOSE: [{ skill: 'diagnosing-bugs', when: 'always', policy: 'model' }],
  EXPLICIT_TRIAGE: [{ skill: 'triage', when: 'always', policy: 'user' }],
  EXPLICIT_ARCH_REVIEW: [{ skill: 'improve-codebase-architecture', when: 'always', policy: 'user' }],
  DOMAIN: [{ skill: 'domain-modeling', when: 'model_change', policy: 'model' }],
  ARCHITECT: [{ skill: 'codebase-design', when: 'always', policy: 'model' }],
  PROTOTYPE: [{ skill: 'prototype', when: 'always', policy: 'model' }],
  DESIGN: [
    { skill: 'frontend-design', when: 'always', policy: 'model' },
    { skill: 'vercel-react-best-practices', when: 'react_stack', policy: 'model' },
  ],
  CONFIRM_TDD_SEAMS: [{ skill: 'tdd', when: 'always', policy: 'model' }],
  BUILD_GRAPH: [],
  IMPLEMENT: [],
  INTEGRATE: [],
  REVIEW: [{ skill: 'web-design-guidelines', when: 'web_ui', policy: 'model' }],
  VERIFY: [{ skill: 'agent-browser', when: 'browser_consumer', policy: 'model' }],
  FREEZE_REVISION: [],
  REVERIFY_STALE: [],
  PR_READY: [],
};

export type RouteFacts = { readonly modelChange: boolean; readonly reactStack: boolean; readonly webUi: boolean; readonly browserConsumer: boolean };

export function routeSkills(phase: Phase, facts: RouteFacts): readonly string[] {
  return ROUTE_SKILLS[phase].filter((entry) => conditionHolds(entry.when, facts)).map((entry) => entry.skill);
}

function conditionHolds(condition: RouteCondition, facts: RouteFacts): boolean {
  switch (condition) {
    case 'always':
      return true;
    case 'model_change':
      return facts.modelChange;
    case 'react_stack':
      return facts.reactStack;
    case 'web_ui':
      return facts.webUi;
    case 'browser_consumer':
      return facts.browserConsumer;
    default: {
      const _exhaustive: never = condition;
      return _exhaustive;
    }
  }
}
