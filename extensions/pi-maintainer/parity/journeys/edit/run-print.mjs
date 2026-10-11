import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertPiVersion, extensionArgs, journeyEnv, prepareWorkspace, readEdited, resolvePi, runPi, saveArtifact } from './host.mjs';

async function requestLog(logDir) {
  const names = (await readdir(logDir)).filter((name) => name.startsWith('requests-') && name.endsWith('.jsonl'));
  const chunks = await Promise.all(names.map((name) => readFile(join(logDir, name), 'utf8').catch(() => '')));
  return chunks
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function runPrintJourney() {
  const piBin = resolvePi();
  const version = assertPiVersion(piBin);
  const workspace = await prepareWorkspace({ format: 'whole', before: 'before-print\n' });
  try {
    const args = [...extensionArgs(), '--print', '--no-session', '--provider', 'maintainer-journey', '--model', 'recorder', '--', 'JOURNEY:wholefile'];
    const result = await runPi(piBin, args, { cwd: workspace.cwd, env: journeyEnv(workspace) });
    const after = await readEdited(workspace.cwd);
    const requests = await requestLog(workspace.logDir);
    assert.equal(result.code, 0, `print pi exit ${result.code}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.equal(after, 'after-print\n', `expected whole-file apply, got ${JSON.stringify(after)}`);
    assert.ok(requests.length >= 1, 'expected at least one scripted provider request');
    const artifact = {
      mode: 'print',
      pi: { bin: piBin, version },
      exitCode: result.code,
      before: 'before-print\n',
      after,
      prompt: 'JOURNEY:wholefile',
      format: 'whole',
      requests,
      stdout: result.stdout,
      stderr: result.stderr,
      verifiedAt: new Date().toISOString(),
    };
    const path = await saveArtifact('print.json', artifact);
    return { ...artifact, artifactPath: path };
  } finally {
    await workspace.cleanup();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await runPrintJourney();
  process.stdout.write(`ok print journey -> ${result.artifactPath}\n`);
}
