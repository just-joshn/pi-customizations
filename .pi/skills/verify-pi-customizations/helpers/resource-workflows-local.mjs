import { execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

import { createRpcSession } from '../lib/rpc.mjs';

export function checkInteraction(records, expected) {
  return records.some((record) => record.type === 'tool_execution_end' && record.toolName === 'bash' && record.isError === false && record.result?.content?.some((part) => part.type === 'text' && part.text.includes(expected)));
}

const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
const filter = (path) => `(subpath ${JSON.stringify(realpathSync(resolve(path)))})`;

export function makeLocalSession({ root, out, repoRoot, packagePath = repoRoot, localPorts = [], answers = {}, deferSession = false, persistSession = false, sessionId }) {
  const agentDir = join(root, 'home', '.pi', 'agent');
  const cwd = join(root, 'workspace');
  const tmp = join(root, 'tmp');
  for (const path of [agentDir, cwd, tmp, out]) mkdirSync(path, { recursive: true });
  writeFileSync(
    join(agentDir, 'models.json'),
    JSON.stringify(
      {
        providers: {
          local: {
            baseUrl: 'http://127.0.0.1:50713/v1',
            api: 'openai-completions',
            apiKey: 'fixture-only-not-a-credential',
            models: [
              {
                id: 'default_model',
                name: 'Local Qwen',
                reasoning: false,
                input: ['text'],
                contextWindow: 65536,
                maxTokens: 8192,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
                samplingParams: { temperature: 0, chat_template_kwargs: { enable_thinking: false } },
              },
            ],
          },
        },
      },
      null,
      2,
    ),
  );
  writeFileSync(
    join(agentDir, 'settings.json'),
    JSON.stringify({ defaultProvider: 'local', defaultModel: 'default_model', defaultThinkingLevel: 'off', skills: [join(repoRoot, 'skills')], extensions: [], packages: [], cacheWarming: { enabled: false } }),
  );
  mkdirSync(join(agentDir, 'pstack'), { recursive: true });
  writeFileSync(
    join(agentDir, 'pstack', 'models.mdc'),
    '---\ndescription: Fixture local roles\nalwaysApply: true\n---\n' +
      [
        'feature, refactoring',
        'bug-fix',
        'perf-issue',
        'hillclimb',
        'judgment and prose',
        'hardest tasks',
        'how explorer',
        'how explainer',
        'why investigators',
        'why synthesizer',
        'reflect tooling',
        'reflect judgment, divergent, synthesizer',
        'arena runners',
        'arena cross-judge pool',
        'swarm workers',
        'architect runners',
        'interrogate reviewers',
      ]
        .map((role) => `${role}: inherit-parent\n`)
        .join(''),
  );
  const pi = execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim();
  const profile = join(out, 'boundary.sb');
  const home = homedir();
  const allowedReads = [repoRoot, join(home, '.pi/agent/install'), join(home, '.pi/agent/bin'), dirname(dirname(process.execPath)), '/Users/josh-desktop/src/personal/pi-customizations/extensions/pi-pstack'];
  writeFileSync(
    profile,
    `(version 1)\n(allow default)\n(deny network*)\n(allow network* (local unix-socket ${filter(root)}) (remote unix-socket ${filter(root)}))\n(allow network-outbound (remote ip "localhost:50713") ${localPorts.map((port) => `(remote ip "localhost:${port}")`).join(' ')})\n${localPorts.length ? `(allow network-bind ${localPorts.map((port) => `(local ip "localhost:${port}")`).join(' ')})\n(allow network-inbound ${localPorts.map((port) => `(local ip "localhost:${port}")`).join(' ')})` : ''}\n(deny file-read-data (require-all ${filter(home)} ${allowedReads.map((path) => `(require-not ${filter(path)})`).join(' ')}))\n(deny file-write*)\n(allow file-write* (require-all ${filter(root)} (require-not ${filter(out)})) (subpath "/dev"))\n`,
  );
  const wrapper = join(out, 'pi');
  writeFileSync(wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(profile)} ${quote(pi)} --provider local --model default_model --thinking off "$@"\n`, { mode: 0o700 });
  const env = {
    PATH: `${out}:${dirname(process.execPath)}:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin`,
    HOME: join(root, 'home'),
    TMPDIR: tmp,
    PI_OFFLINE: '1',
    HF_HUB_OFFLINE: '1',
    TRANSFORMERS_OFFLINE: '1',
    PI_SKIP_VERSION_CHECK: '1',
    PI_MANAGED_INSTALL_ROOT: '',
    XDG_CONFIG_HOME: join(root, 'home', '.config'),
    XDG_CACHE_HOME: join(root, 'home', '.cache'),
  };
  for (const key of Object.keys(process.env)) {
    if (/(?:KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|AUTH)/i.test(key) || /^(?:AWS_|GOOGLE_|AZURE_|PI_)/.test(key)) env[key] = '';
  }
  Object.assign(env, { PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' });
  const sessionOptions = { packagePath, agentDir, cwd, piBin: wrapper, env, answers, capturePath: join(out, 'rpc.jsonl'), persistSession, sessionId };
  const session = deferSession ? null : createRpcSession(sessionOptions);
  return { session, sessionOptions, cwd, agentDir, env, wrapper, profile, imagePath: pi };
}

export async function attemptPrompt(session, prompt) {
  try {
    await session.prompt(prompt);
    return null;
  } catch (error) {
    await session.close();
    return error.message;
  }
}
