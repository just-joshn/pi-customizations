import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

import { createAgentSession, DefaultResourceLoader, SessionManager } from '@earendil-works/pi-coding-agent';

const script = fileURLToPath(import.meta.url),
  root = resolve(dirname(script), '..');
const run = promisify(execFile);
const json = async (path) => JSON.parse(await readFile(path, 'utf8'));
const save = (path, value) => writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });

async function parent(directory, existing) {
  const config = await json(join(directory, 'config.json'));
  process.env.PI_CODING_AGENT_DIR = join(directory, 'agent');
  process.env.PI_PSTACK_EXECUTORS = join(directory, 'executors.json');
  process.env.PI_VM_SENTINEL = 'host-fixture-secret';
  const loader = new DefaultResourceLoader({
    cwd: config.executor.localRepository,
    agentDir: process.env.PI_CODING_AGENT_DIR,
    noSkills: true,
    noContextFiles: true,
    additionalExtensionPaths: [join(root, 'src/index.ts'), join(root, 'test/remote-vm-provider.ts')],
  });
  await loader.reload();
  assert.deepEqual(loader.getExtensions().errors, []);
  const manager = existing ? SessionManager.open(await readFile(join(directory, 'session-path'), 'utf8')) : SessionManager.create(config.executor.localRepository, join(directory, 'sessions'));
  const { session } = await createAgentSession({ cwd: config.executor.localRepository, agentDir: process.env.PI_CODING_AGENT_DIR, resourceLoader: loader, sessionManager: manager });
  await session.bindExtensions({ mode: 'print' });
  const model = session.extensionRunner
    .createContext()
    .modelRegistry.getAvailable()
    .find((item) => item.provider === 'remote-vm-test');
  assert.ok(model);
  await session.setModel(model);
  if (!existing) {
    await session.prompt('Initialize remote Task journey');
    await writeFile(join(directory, 'session-path'), manager.getSessionFile());
  }
  const call = async (name, params) => {
    const tool = loader
      .getExtensions()
      .extensions.flatMap((extension) => [...extension.tools.values()])
      .find((item) => item.definition.name === name);
    assert.ok(tool);
    const result = await tool.definition.execute(`vm-${name}`, params, undefined, undefined, session.extensionRunner.createToolContext(`vm-${name}`, undefined));
    return name === 'TaskMessage' ? result.details : JSON.parse(result.content.find((item) => item.type === 'text').text);
  };
  return {
    config,
    records: manager
      .getBranch()
      .filter((entry) => entry.type === 'custom' && entry.customType === 'pstack-task')
      .map((entry) => entry.data),
    call,
    close: async () => {
      await session.extensionRunner.emit({ type: 'session_shutdown', reason: 'quit' });
      session.dispose();
    },
  };
}

async function lifecycle(directory) {
  const { config, call, close } = await parent(directory, false);
  try {
    const prompt = `VM:probe ${JSON.stringify({ command: `set -e; test ! -e '${config.sentinel}'; test -z "$PI_VM_SENTINEL"; printf 'HOST_FILE_AND_CREDENTIAL_DENIED\\n'; cat /etc/machine-id; git rev-parse HEAD` })}`;
    const foreground = await call('Task', { prompt, environment: 'cloud', model: 'remote-vm-test/recorder', run_in_background: false });
    assert.equal(foreground.status, 'settled');
    assert.ok(JSON.parse(foreground.output).result.some((item) => item.type === 'text' && item.text.includes('HOST_FILE_AND_CREDENTIAL_DENIED')));
    assert.equal(foreground.placement.machineId, config.executor.machineId);
    const resumed = await call('Task', { prompt: 'resumed exact remote placement', resume: foreground.task_id, run_in_background: false });
    assert.equal(resumed.task_id, foreground.task_id);
    assert.equal(resumed.transcript, foreground.transcript);
    assert.deepEqual(resumed.placement, foreground.placement);
    const background = await call('Task', { prompt: 'VM:hold steer', environment: 'cloud', model: 'remote-vm-test/recorder' });
    assert.equal(background.status, 'running');
    const message = await call('TaskMessage', { task_id: background.task_id, message: 'steered VM child', mode: 'steer' });
    const output = await call('TaskOutput', { task_id: background.task_id, block: true });
    assert.equal(output.status, 'settled');
    assert.ok(output.output.includes('steered VM child'));
    const stopping = await call('Task', { prompt: 'VM:hold stop', environment: 'cloud', model: 'remote-vm-test/recorder' });
    const stopped = await call('TaskStop', { task_id: stopping.task_id });
    assert.notEqual(stopped.status, 'running');
    const surviving = await call('Task', { prompt: 'VM:hold survive', environment: 'cloud', model: 'remote-vm-test/recorder' });
    await save(join(directory, 'evidence.json'), { foreground, resumed, background, message, output, stopped, surviving, initiatingPid: process.pid });
  } finally {
    await close();
  }
}

async function recover(directory) {
  const prior = await json(join(directory, 'evidence.json'));
  assert.notEqual(prior.initiatingPid, process.pid);
  const { call, close } = await parent(directory, true);
  try {
    const recovered = await call('TaskOutput', { task_id: prior.surviving.task_id, block: true });
    assert.equal(recovered.status, 'settled');
    assert.equal(recovered.transcript, prior.surviving.transcript);
    await save(join(directory, 'evidence.json'), { ...prior, recovered, recoveringPid: process.pid });
  } finally {
    await close();
  }
}

async function cleanup(directory) {
  const { records, call, close } = await parent(directory, true);
  try {
    for (const record of new Map(records.map((item) => [item.id, item])).values()) {
      if (record.status === 'running') await call('TaskOutput', { task_id: record.id, block: true });
    }
  } finally {
    await close();
  }
}

async function main(configPath, outputPath) {
  if (!configPath || !outputPath) throw new Error('Usage: node test/remote-vm-journey.mjs EXECUTORS_JSON EVIDENCE_JSON (explicit preprovisioned VM; no service installation)');
  const [executor] = await json(resolve(configPath));
  assert.ok(executor);
  const directory = await mkdtemp(join(tmpdir(), 'pstack-vm-journey-'));
  await mkdir(join(directory, 'agent'));
  const sentinel = join(directory, 'host-only-file');
  await writeFile(sentinel, 'host-only fixture data');
  await save(join(directory, 'config.json'), { executor, sentinel });
  await save(join(directory, 'executors.json'), [executor]);
  for (const phase of ['lifecycle', 'recover']) await run(process.execPath, [script, '--stage', directory, phase], { timeout: 600000, maxBuffer: 8 * 1024 * 1024 });
  await save(resolve(outputPath), { verifiedAt: new Date().toISOString(), directory, ...(await json(join(directory, 'evidence.json'))) });
  process.stdout.write(`Remote Task VM journey passed: ${resolve(outputPath)}\n`);
}

if (process.argv[2] === '--stage') await { lifecycle, recover, cleanup }[process.argv[4]](process.argv[3]);
else await main(process.argv[2], process.argv[3]);
