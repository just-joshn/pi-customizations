import { join } from 'node:path';

import { startRoutine } from '../scripts/routine-client.mjs';

const [directory, revision, root, packageRoot] = process.argv.slice(2);
const receipt = await startRoutine(directory, revision, {
  cwd: root,
  agentDir: join(root, 'agent'),
  args: ['--no-extensions', '--no-skills', '--no-prompt-templates', '-e', join(packageRoot, 'test/routine-provider.ts'), '--provider', 'journey-test', '--model', 'recorder', '--session-dir', join(directory, 'session')],
});
process.stdout.write(JSON.stringify(receipt));
