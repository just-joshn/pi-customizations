import { localShell } from '../../src/adapters/shell.ts';
import type { CliContext, Host } from '../../src/cli/commands.ts';
import { fixedClock } from './clock.ts';

export const NO_HOST: Host = { installedSkills: async () => [], capabilities: () => ({}) };

export function testContext(cwd: string, fetchText: CliContext['fetchText'] = () => Promise.reject(new Error('network disabled in tests')), host: Host = NO_HOST): CliContext {
  return { cwd, clock: fixedClock(), fetchText, shell: localShell(cwd, undefined), host };
}
