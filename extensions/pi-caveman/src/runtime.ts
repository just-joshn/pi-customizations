import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import upstreamRuntime from '#caveman-runtime';

// The marker and path that `caveman enable pi` writes (packages/cli/src/index.ts piNativeMutations).
const ENABLE_MARKER = 'caveman:native-pi';
const enabledExtension = (home: string): string => join(home, '.pi', 'agent', 'extensions', 'caveman-native.js');

export type RuntimeOwner = 'package' | 'caveman-wrap' | 'caveman-enable';

// `caveman wrap pi` and `caveman enable pi` each load their own copy of this runtime. Pi refuses a
// second `caveman_retrieve` registration and aborts startup, so the package yields to the CLI's copy.
export function runtimeOwner(env: NodeJS.ProcessEnv, home: string): RuntimeOwner {
  if (env['CAVEMAN_PI_HOOK_CMD']) return 'caveman-wrap';
  try {
    if (readFileSync(enabledExtension(home), 'utf8').includes(ENABLE_MARKER)) return 'caveman-enable';
  } catch {
    // No CLI-generated extension exists, so the package owns the runtime.
  }
  return 'package';
}

export function registerRuntime(pi: ExtensionAPI): RuntimeOwner {
  const owner = runtimeOwner(process.env, homedir());
  if (owner === 'package') upstreamRuntime(pi);
  return owner;
}
