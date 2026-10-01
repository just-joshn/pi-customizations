import { spawn } from 'node:child_process';

export type ShellResult = Readonly<{ code: number; stdout: string; stderr: string }>;
export type ShellOptions = Readonly<{ cwd: string; input: string; env: NodeJS.ProcessEnv; timeoutMs: number }>;

export function runShellCommand(command: string, { cwd, input, env, timeoutMs }: ShellOptions): Promise<ShellResult> {
  return new Promise((resolveRun) => {
    const child = spawn('sh', ['-c', command], { cwd, env, stdio: ['pipe', 'pipe', 'pipe'], timeout: timeoutMs });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout.on('data', (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on('data', (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on('error', () => {});
    child.on('error', (error) => resolveRun({ code: 1, stdout: '', stderr: String(error) }));
    child.on('close', (code, signal) => {
      const text = Buffer.concat(stderr).toString('utf8');
      resolveRun({ code: code ?? 1, stdout: Buffer.concat(stdout).toString('utf8'), stderr: signal ? `${text}terminated by ${signal}` : text });
    });
    child.stdin.end(input);
  });
}
