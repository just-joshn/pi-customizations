import type { HostCapabilities } from '../domain/run.ts';

export type CapabilityInput = Partial<HostCapabilities>;

export function piHostCapabilities(input: CapabilityInput = {}): HostCapabilities {
  return {
    independentAgents: input.independentAgents ?? false,
    isolatedWorktrees: input.isolatedWorktrees ?? false,
    browserDriver: input.browserDriver ?? false,
    nativeAutomation: input.nativeAutomation ?? false,
    installedSkills: input.installedSkills ?? [],
  };
}
