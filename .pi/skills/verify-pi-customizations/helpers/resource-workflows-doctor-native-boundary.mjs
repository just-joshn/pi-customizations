import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const digest = (value) => createHash('sha256').update(value).digest('hex');

function approvedEffect(policy, path) {
  const effect = policy.groups.flatMap((group) => group.effects).find((item) => item.path === path);
  if (policy.phase !== 'mutation' || typeof path !== 'string' || resolve(policy.cwd, path) !== path || !effect) throw new Error('Doctor lease rejects this mutation target or operation');
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || realpathSync(path) !== path) throw new Error('Doctor lease rejects aliased mutation identity');
  return effect;
}

function validateWrite(policy, params) {
  const effect = approvedEffect(policy, params.path);
  if (typeof params.content !== 'string') throw new Error('Doctor lease rejects this mutation target or operation');
  if (digest(readFileSync(params.path)) !== effect.beforeSha256 || digest(params.content) !== effect.afterSha256) throw new Error('Doctor lease rejects an unapproved intermediate byte transition');
}

export async function registerDoctorNativeBoundary(pi, policy, sdk) {
  const { createReadTool, createWriteTool, createEditTool } = await import(sdk);
  const write = createWriteTool(policy.cwd);
  let claimed = new Set();
  pi.registerTool(createReadTool(policy.cwd));
  pi.registerTool({
    ...write,
    execute: async (...args) => {
      if (/(?:^|\/)settings\.json$/.test(args[1].path)) throw new Error('Doctor settings changes require native edit');
      validateWrite(policy, args[1]);
      if (claimed.has(args[1].path)) throw new Error('Doctor lease already consumed this approved transition');
      claimed = new Set([...claimed, args[1].path]);
      return write.execute(...args);
    },
  });
  const edit = createEditTool(policy.cwd, {
    operations: {
      access: async (path) => { approvedEffect(policy, path); },
      readFile: async (path) => {
        approvedEffect(policy, path);
        return readFileSync(path);
      },
      writeFile: async (path, content) => {
        validateWrite(policy, { path, content });
        if (claimed.has(path)) throw new Error('Doctor lease already consumed this approved transition');
        claimed = new Set([...claimed, path]);
        writeFileSync(path, content, 'utf8');
      },
    },
  });
  pi.registerTool({
    ...edit,
    execute: async (...args) => {
      approvedEffect(policy, args[1].path);
      return edit.execute(...args);
    },
  });
  pi.on('tool_call', (event) => {
    if (!['read', 'write', 'edit'].includes(event.toolName)) return { block: true, reason: 'Doctor lease rejects shell and custom-tool execution' };
    if (policy.phase === 'report' && event.toolName !== 'read') return { block: true, reason: 'Doctor report lease rejects every mutation attempt' };
  });
}
