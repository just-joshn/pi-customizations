import { execFileSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { attemptPrompt, checkInteraction, makeLocalSession } from '../helpers/resource-workflows-local.mjs';
import { reservePort, seedRecipe } from '../helpers/resource-workflows-recipes.mjs';

function stopOwnedServer(cwd) {
  const file = join(cwd, 'server.pid');
  if (!existsSync(file)) return 'No server PID was produced.';
  const pid = Number(readFileSync(file, 'utf8'));
  if (!Number.isSafeInteger(pid) || pid <= 1) return 'Invalid server PID.';
  try {
    const files = execFileSync('/usr/sbin/lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' });
    if (!files.split('\n').includes(`n${realpathSync(cwd)}`)) return 'PID cwd does not match the owned app. Not signalled.';
    process.kill(pid, 'SIGTERM');
    return `Stopped owned server ${pid}.`;
  } catch (error) {
    return `Server already exited or ownership unavailable. ${error.message}`;
  }
}

export default async function drive({ repoRoot, artifactDir, receipts }) {
  const attempts = [];
  for (const kind of ['cli', 'electron', 'library', 'playwright', 'server', 'tui']) {
    const root = mkdtempSync('/tmp/rw-');
    const out = join(artifactDir, kind);
    const port = await reservePort();
    const socket = join(root, 'terminal.sock');
    const fixture = makeLocalSession({ root, out, repoRoot, localPorts: ['server', 'playwright'].includes(kind) ? [port] : [] });
    let cleanup;
    try {
      seedRecipe(kind, fixture.cwd, port, socket);
      const error = await attemptPrompt(
        fixture.session,
        `/skill:run Run my ${kind} project at ${fixture.cwd} and try its main interaction. ${kind === 'tui' ? 'Open settings with s, capture the pane, then quit with q. Use only the tmux socket in the README.' : kind === 'server' ? 'Request the greeting route with Ada.' : 'Greet Ada.'} Use already-installed tools only. This project is offline. Do not download anything. Stop any processes you start.`,
      );
      const records = [...fixture.session.records];
      const outputObserved = checkInteraction(records, kind === 'tui' ? 'Settings enabled' : 'Hello Ada');
      const actualState =
        kind === 'tui'
          ? existsSync(join(fixture.cwd, 'interaction.txt')) && readFileSync(join(fixture.cwd, 'interaction.txt'), 'utf8') === 'Settings enabled'
          : kind === 'server'
            ? existsSync(join(fixture.cwd, 'requests.jsonl')) &&
              readFileSync(join(fixture.cwd, 'requests.jsonl'), 'utf8')
                .split('\n')
                .some((line) => line && JSON.parse(line).url === '/greet?name=Ada')
            : null;
      cleanup = stopOwnedServer(fixture.cwd);
      if (existsSync(socket)) {
        try {
          execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'pipe' });
        } catch (failure) {
          cleanup += ` Owned socket cleanup failed. ${failure.message}`;
        }
      }
      cpSync(fixture.cwd, join(out, 'workspace'), { recursive: true });
      const status = { kind, error, outputObserved, actualState, cleanup, capture: join(out, 'rpc.jsonl') };
      writeFileSync(join(out, 'attempt.json'), `${JSON.stringify(status, null, 2)}\n`);
      attempts.push(status);
    } finally {
      try {
        await fixture.session.close();
      } finally {
        stopOwnedServer(fixture.cwd);
        if (existsSync(socket)) {
          try {
            execFileSync('tmux', ['-S', socket, 'kill-server'], { stdio: 'pipe' });
          } catch {}
        }
        rmSync(root, { recursive: true, force: true });
      }
    }
  }
  mkdirSync(artifactDir, { recursive: true });
  const summary = join(artifactDir, 'summary.json');
  writeFileSync(summary, `${JSON.stringify(attempts, null, 2)}\n`);
  const expected = readFileSync(join(repoRoot, 'docs/user-perspective-testing/surfaces.tsv'), 'utf8')
    .split('\n')
    .find((line) => line.startsWith('RS-SKILL-2\t'))
    .split('\t')[6];
  receipts.write({
    surfaceId: 'RS-SKILL-2',
    package: 'skills',
    expected,
    observed: JSON.stringify(attempts),
    evidence: summary,
    verdict: attempts.some((attempt) => attempt.error) ? 'failed' : 'inconclusive',
    reason: 'Six genuine recipe attempts are preserved. GUI screenshots, actual browser interactions, launch ownership and cleanup must all be audited. Output text alone cannot verify the complete row.',
  });
}
