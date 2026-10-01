import { accessSync, constants, existsSync } from 'node:fs';
import { delimiter, join } from 'node:path';

export type PiCommand = Readonly<{ command: string; args: readonly string[] }>;

const scriptPattern = /\.(?:c|m)?js$/;

function launcher(path: string, execPath: string): PiCommand {
  return scriptPattern.test(path) ? { command: execPath, args: [path] } : { command: path, args: [] };
}

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function onPath(env: NodeJS.ProcessEnv): string | undefined {
  return (env.PATH ?? '')
    .split(delimiter)
    .filter(Boolean)
    .map((directory) => join(directory, 'pi'))
    .find(executable);
}

/** The pi that is running this extension wins, so a remote child matches its parent's installation. */
export function resolvePiCommand(env: NodeJS.ProcessEnv, argv1: string | undefined = process.argv[1], execPath: string = process.execPath): PiCommand | undefined {
  const configured = env.PSTACK_PI_COMMAND?.trim();
  if (configured) return launcher(configured, execPath);
  if (argv1 && scriptPattern.test(argv1) && existsSync(argv1)) return launcher(argv1, execPath);
  const found = onPath(env);
  return found ? launcher(found, execPath) : undefined;
}
