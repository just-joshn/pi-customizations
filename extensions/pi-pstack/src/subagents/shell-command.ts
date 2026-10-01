import { spawn } from 'node:child_process';

export type ShellResult = Readonly<{ code: number; stdout: string; stderr: string }>;
export type ShellOptions = Readonly<{ cwd: string; input: string; env: NodeJS.ProcessEnv; timeoutMs: number }>;

const timeoutGraceMs = 100;

export function runShellCommand(command: string, { cwd, input, env, timeoutMs }: ShellOptions): Promise<ShellResult> {
  return new Promise((resolveRun) => {
    const child = spawn('sh', ['-c', command], { cwd, detached: true, env, stdio: ['pipe', 'pipe', 'pipe'] });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      signalGroup(child, 'SIGTERM');
      escalation = setTimeout(() => {
        signalGroup(child, 'SIGKILL');
        child.stdout.destroy();
        child.stderr.destroy();
        child.stdin.destroy();
        const text = Buffer.concat(stderr).toString('utf8');
        resolveRun({ code: 124, stdout: Buffer.concat(stdout).toString('utf8'), stderr: `${text}${text ? '\n' : ''}terminated by timeout` });
      }, timeoutGraceMs);
    }, timeoutMs);
    let escalation: NodeJS.Timeout | undefined;
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on('error', () => {});
    child.on('error', (error) => {
      if (timedOut) return;
      clearTimeout(timeout);
      if (escalation) clearTimeout(escalation);
      resolveRun({ code: 1, stdout: '', stderr: String(error) });
    });
    child.on('close', (code, signal) => {
      if (timedOut) return;
      clearTimeout(timeout);
      if (escalation) clearTimeout(escalation);
      const text = Buffer.concat(stderr).toString('utf8');
      resolveRun({
        code: code ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8'),
        stderr: signal ? `${text}terminated by ${signal}` : text,
      });
    });
    child.stdin.end(input);
  });
}

function signalGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  try {
    if (process.platform === 'win32' || child.pid === undefined) child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {}
}
