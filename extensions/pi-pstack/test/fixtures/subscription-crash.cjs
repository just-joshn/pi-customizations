const fs = require('node:fs');
const { syncBuiltinESMExports } = require('node:module');
const rename = fs.renameSync;
fs.renameSync = function (from, to) {
  const registry = String(to).endsWith('/subscriptions.json');
  if (registry && process.env.PSTACK_TEST_CRASH === 'before') process.kill(process.pid, 'SIGKILL');
  const result = rename.call(this, from, to);
  if (registry && process.env.PSTACK_TEST_CRASH === 'after') process.kill(process.pid, 'SIGKILL');
  return result;
};
syncBuiltinESMExports();
