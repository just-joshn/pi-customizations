import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

export type Pane = Readonly<{ id: string; session: string; window: string; close: () => Promise<void> }>;

function quote(path: string): string {
  return `'${path.replaceAll("'", `'\\''`)}'`;
}

/** Shows a teammate's streamed output in a split of the tmux window the parent runs in. Returns undefined outside tmux. */
export async function openPane(env: NodeJS.ProcessEnv, outputFile: string): Promise<Pane | undefined> {
  if (!env.TMUX) return undefined;
  try {
    const { stdout } = await run('tmux', ['split-window', '-d', '-h', '-P', '-F', '#{pane_id}\t#{session_name}\t#{window_name}', `tail -n +1 -f ${quote(outputFile)}`], { env });
    const [id, session, window] = stdout.trim().split('\t');
    if (!id || !session || !window) return undefined;
    return { id, session, window, close: () => run('tmux', ['kill-pane', '-t', id], { env }).then(() => undefined) };
  } catch {
    return undefined;
  }
}
