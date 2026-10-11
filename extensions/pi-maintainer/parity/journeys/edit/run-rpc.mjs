import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { rpcProcess } from '../../../../pi-pstack/scripts/rpc-process.mjs';
import { promptAndSettle } from '../../../../pi-pstack/scripts/rpc-turn.mjs';
import { assertPiVersion, extensionArgs, journeyEnv, prepareWorkspace, readEdited, resolvePi, saveArtifact, spawnPiRpc } from './host.mjs';

async function requestLog(logDir) {
  const names = (await readdir(logDir)).filter((name) => name.startsWith('requests-') && name.endsWith('.jsonl'));
  const chunks = await Promise.all(names.map((name) => readFile(join(logDir, name), 'utf8').catch(() => '')));
  return chunks
    .join('')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

export async function runRpcJourney() {
  const piBin = resolvePi();
  const version = assertPiVersion(piBin);
  const workspace = await prepareWorkspace({ format: 'diff', before: 'before-rpc\n' });
  const child = spawnPiRpc(piBin, [...extensionArgs(), '--mode', 'rpc', '--no-session', '--provider', 'maintainer-journey', '--model', 'recorder'], { cwd: workspace.cwd, env: journeyEnv(workspace) });
  let settlements = 0;
  const client = rpcProcess(child, {
    requestDeadlineMs: 180000,
    shutdownDeadlineMs: 15000,
    onRecord: (record) => {
      if (record.type === 'agent_settled') settlements += 1;
    },
  });
  try {
    const state = await client.send({ type: 'get_state' });
    assert.equal(state.model?.provider, 'pi-maintainer', `expected pi-maintainer/coder router after session_start, got ${state.model?.provider}/${state.model?.id}`);
    assert.equal(state.model?.id, 'coder', `expected pi-maintainer/coder router after session_start, got ${state.model?.provider}/${state.model?.id}`);
    await promptAndSettle(
      (command) => client.send(command),
      () => settlements,
      { type: 'prompt', message: 'JOURNEY:editblock' },
    );
    const after = await readEdited(workspace.cwd);
    const requests = await requestLog(workspace.logDir);
    assert.equal(after, 'after-rpc\n', `expected editblock apply, got ${JSON.stringify(after)}`);
    assert.ok(requests.length >= 1, 'expected at least one scripted provider request');
    const code = await client.finish();
    assert.equal(code, 0, `rpc pi exit ${code}\nstderr:\n${client.stderr}`);
    const artifact = {
      mode: 'rpc',
      pi: { bin: piBin, version },
      exitCode: code,
      before: 'before-rpc\n',
      after,
      prompt: 'JOURNEY:editblock',
      format: 'diff',
      requests,
      stderr: client.stderr,
      verifiedAt: new Date().toISOString(),
    };
    const path = await saveArtifact('rpc.json', artifact);
    return { ...artifact, artifactPath: path };
  } catch (error) {
    await client.close().catch(() => {});
    throw error;
  } finally {
    await workspace.cleanup();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const result = await runRpcJourney();
  process.stdout.write(`ok rpc journey -> ${result.artifactPath}\n`);
}
