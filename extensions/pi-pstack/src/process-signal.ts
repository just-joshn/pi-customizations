function isGone(error: unknown): boolean {
  return error instanceof Error && 'code' in error && (error.code === 'ESRCH' || error.code === 'EPERM');
}

/**
 * Signal a process, or its group for a negative pid. A process that is already gone is the state the
 * caller wants, and macOS answers EPERM when the only member left is an unreaped zombie leader.
 * Any other failure is a real fault and propagates.
 */
export function signalProcess(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(pid, signal);
  } catch (error) {
    if (!isGone(error)) throw error;
  }
}
