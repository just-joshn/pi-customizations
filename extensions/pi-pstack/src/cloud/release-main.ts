// A detached cloud agent's wrapper runs this once the agent's process exits, with the wrapper's pid and the exit code:
// it stops the run's machine unless another live run uses it, then records the exit code.
import { renameSync, writeFileSync } from 'node:fs';

import { releaseMachine } from './machine.ts';

function required(name: string): string {
  const value = process.env[name];
  if (value === undefined || value === '') throw new Error(`${name} is not set.`);
  return value;
}

const [self = '', code = ''] = process.argv.slice(2);
const exit = required('PSTACK_EXIT');
await releaseMachine({ driver: 'container', container: required('PSTACK_MACHINE_CONTAINER'), path: required('PSTACK_MACHINE_PATH') }, required('PSTACK_LOCKS'), {
  self: Number(self),
  finish: () => {
    writeFileSync(`${exit}.tmp`, code);
    renameSync(`${exit}.tmp`, exit);
  },
});
