import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';

const digest = (value) => createHash('sha256').update(value).digest('hex');

function validateWrite(policy, params) {
  const path = resolve(policy.cwd, params.path);
  const effect = policy.groups.flatMap((group) => group.effects).find((item) => item.path === path);
  if (policy.phase !== 'mutation' || path !== params.path || !effect || typeof params.content !== 'string') throw new Error('Doctor lease rejects this mutation target or operation');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path) throw new Error('Doctor lease rejects aliased mutation identity');
  if (digest(readFileSync(path)) !== effect.beforeSha256 || digest(params.content) !== effect.afterSha256) throw new Error('Doctor lease rejects an unapproved intermediate byte transition');
}

export async function registerDoctorNativeBoundary(pi, policy, sdk) {
  const { createReadTool, createWriteTool, createEditTool } = await import(sdk);
  const write = createWriteTool(policy.cwd);
  let claimed = new Set();
  pi.registerTool(createReadTool(policy.cwd));
  pi.registerTool({
    ...write,
    execute: async (...args) => {
      validateWrite(policy, args[1]);
      if (claimed.has(args[1].path)) throw new Error('Doctor lease already consumed this approved transition');
      claimed = new Set([...claimed, args[1].path]);
      return write.execute(...args);
    },
  });
  pi.registerTool({
    ...createEditTool(policy.cwd),
    execute: async () => {
      throw new Error('Doctor lease requires a native write of the exact approved byte transition');
    },
  });
  pi.on('tool_call', (event) => {
    if (!['read', 'write', 'edit'].includes(event.toolName)) return { block: true, reason: 'Doctor lease rejects shell and custom-tool execution' };
    if (policy.phase === 'report' && event.toolName !== 'read') return { block: true, reason: 'Doctor report lease rejects every mutation attempt' };
  });
}
