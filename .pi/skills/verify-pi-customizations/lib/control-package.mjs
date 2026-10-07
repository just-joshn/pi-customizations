import { cpSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const guardRegistration = {
  'write-gate': '      writeGateExtension(input.plan.writeGate),\n',
  'tool-policy': '      toolPolicyExtension({ definition: input.plan.definition, parentTools: input.parentTools, contextManagement: input.contextManagement }),\n',
};

/**
 * Copies the package with one guard factory registration removed from child-session.ts, so a drive can show the observed
 * outcome comes from that guard. The copy resolves dependencies through a symlink to the real package's node_modules.
 */
export function buildGuardControl(context, guard) {
  const line = guardRegistration[guard];
  if (!line) throw new Error(`Unknown guard control '${guard}'. Expected one of ${Object.keys(guardRegistration).join(', ')}`);
  const source = join(context.repoRoot, 'extensions/pi-pstack');
  const packagePath = join(context.scratchDir, `pi-pstack-no-${guard}`);
  rmSync(packagePath, { recursive: true, force: true });
  cpSync(source, packagePath, { recursive: true, filter: (path) => !path.includes('node_modules') });
  symlinkSync(join(source, 'node_modules'), join(packagePath, 'node_modules'), 'dir');
  const childSession = join(packagePath, 'src/subagents/child-session.ts');
  const original = readFileSync(childSession, 'utf8');
  if (!original.includes(line)) throw new Error(`The control source does not contain the ${guard} registration line`);
  writeFileSync(childSession, original.replace(line, ''));
  return { packagePath, removed: line.trim() };
}
