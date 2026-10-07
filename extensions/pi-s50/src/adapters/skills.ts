import type { Command } from '../orchestrator/command.ts';

export type SkillInput = { readonly phase: string; readonly objective: string };

export type SkillResult = { readonly skill: string; readonly summary: string; readonly commands: readonly Command[] };

export type SkillRuntime = { run(skill: string, input: SkillInput): Promise<SkillResult> };

export class FakeSkillRuntime implements SkillRuntime {
  readonly calls: { readonly skill: string; readonly input: SkillInput }[] = [];
  readonly #script: Map<string, SkillResult[]>;

  constructor(script: Readonly<Record<string, readonly SkillResult[]>>) {
    this.#script = new Map(Object.entries(script).map(([skill, results]) => [skill, [...results]]));
  }

  run(skill: string, input: SkillInput): Promise<SkillResult> {
    this.calls.push({ skill, input });
    const next = this.#script.get(skill)?.shift();
    if (next === undefined) return Promise.reject(new Error(`FakeSkillRuntime: no scripted result for ${skill}`));
    return Promise.resolve(next);
  }
}
