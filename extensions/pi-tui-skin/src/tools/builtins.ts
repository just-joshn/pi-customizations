/**
 * Official built-in tool definitions, built the way Pi builds them.
 *
 * Pi registers the built-ins before extensions load, so a same-name
 * `pi.registerTool()` replaces the original wholesale. This module hands the
 * wrapper a definition to spread for its behavior-affecting metadata and to
 * delegate execution to. Pi builds its own with options read from settings, so
 * building ours without them silently drops the user's `shellPath`,
 * `shellCommandPrefix`, and `images.autoResize`.
 *
 * Definitions are built per call instead of cached, so a settings change
 * reaches the next tool call rather than freezing at load time.
 */

import {
  createBashToolDefinition,
  createEditToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition,
  createLsToolDefinition,
  createPowerShellToolDefinition,
  createReadToolDefinition,
  createWriteToolDefinition,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';

export type BuiltinName = 'read' | 'bash' | 'powershell' | 'edit' | 'write' | 'grep' | 'find' | 'ls';

let settingsFailureReported = false;

/** Settings-backed options. A settings failure falls back to Pi's defaults and reports once. */
function settingsManager(cwd: string): SettingsManager {
  try {
    return SettingsManager.create(cwd);
  } catch (error) {
    if (!settingsFailureReported) {
      settingsFailureReported = true;
      console.error('[tui-skin] falling back to default tool settings', error);
    }
    return SettingsManager.inMemory();
  }
}

function createBuiltins(cwd: string) {
  const settings = settingsManager(cwd);
  return {
    read: createReadToolDefinition(cwd, { autoResizeImages: settings.getImageAutoResize() }),
    bash: createBashToolDefinition(cwd, { commandPrefix: settings.getShellCommandPrefix(), shellPath: settings.getShellPath() }),
    powershell: createPowerShellToolDefinition(cwd),
    edit: createEditToolDefinition(cwd),
    write: createWriteToolDefinition(cwd),
    grep: createGrepToolDefinition(cwd),
    find: createFindToolDefinition(cwd),
    ls: createLsToolDefinition(cwd),
  };
}

export type Builtins = ReturnType<typeof createBuiltins>;

export function getBuiltins(cwd: string): Builtins {
  return createBuiltins(cwd);
}

export function getBuiltin<K extends BuiltinName>(cwd: string, name: K): Builtins[K] {
  return getBuiltins(cwd)[name];
}
