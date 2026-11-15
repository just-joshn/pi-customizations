import { execFileSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { join } from 'node:path';

export const SANDBOX_ENV = 'PSTACK_V2_SANDBOXED';

// Files in the Pi agent directory that would let a sandboxed process change what a later, unsandboxed Pi loads.
const PROTECTED_AGENT_FILES = ['settings.json', 'trust.json', 'mcp.json', 'models.json', 'keybindings.json', 'AGENTS.md', 'SYSTEM.md', 'APPEND_SYSTEM.md'];
const PROTECTED_AGENT_DIRS = ['extensions', 'skills', 'prompts', 'themes', 'bin', 'install', 'npm', 'git'];

export interface SandboxPolicy {
  writable: string[];
  agentDir: string;
}

const real = (path: string): string => (existsSync(path) ? realpathSync(path) : path);
const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const quote = (text: string): string => JSON.stringify(text);

export function seatbeltProfile(policy: SandboxPolicy): string {
  const agent = real(policy.agentDir);
  const writable = policy.writable.map((path) => `(subpath ${quote(real(path))})`).join(' ');
  return [
    '(version 1)',
    '(allow default)',
    '(deny file-write*)',
    `(allow file-write* (literal "/dev/null") (regex #"^/dev/tty") (regex #"^/dev/fd/") (subpath "/private/tmp") (subpath "/private/var/folders") ${writable})`,
    `(allow file-write* (regex #"^${escapeRegex(agent)}/[^/]+$") (regex #"^${escapeRegex(agent)}/[^/]+\\.lock(/|$)"))`,
    `(deny file-write* ${PROTECTED_AGENT_FILES.map((name) => `(literal ${quote(join(agent, name))})`).join(' ')})`,
  ].join('\n');
}

export function bwrapArgs(policy: SandboxPolicy): string[] {
  const args = ['--ro-bind', '/', '/', '--dev', '/dev', '--proc', '/proc', '--bind', '/tmp', '/tmp'];
  for (const path of [...policy.writable, policy.agentDir].filter(existsSync)) args.push('--bind', path, path);
  for (const name of [...PROTECTED_AGENT_FILES, ...PROTECTED_AGENT_DIRS]) {
    const path = join(policy.agentDir, name);
    if (existsSync(path)) args.push('--ro-bind', path, path);
  }
  return [...args, '--die-with-parent', '--'];
}

function onPath(binary: string): boolean {
  try {
    execFileSync('/bin/sh', ['-c', `command -v ${binary}`], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/**
 * Wraps argv so it runs with writes limited to the policy. A process that is already inside a pstack sandbox
 * inherits it, because macOS refuses to apply a second Seatbelt profile.
 */
export function sandboxed(argv: string[], policy: SandboxPolicy, platform: NodeJS.Platform = process.platform, env: NodeJS.ProcessEnv = process.env): string[] {
  if (env[SANDBOX_ENV] === '1') return argv;
  if (platform === 'darwin' && onPath('sandbox-exec')) return ['sandbox-exec', '-p', seatbeltProfile(policy), ...argv];
  if (platform === 'linux' && onPath('bwrap')) return ['bwrap', ...bwrapArgs(policy), ...argv];
  throw new Error(`pstack runs every job in a sandbox and found none on ${platform}. Install bubblewrap (bwrap) on Linux or WSL2, or use macOS, where Seatbelt (sandbox-exec) is built in.`);
}
