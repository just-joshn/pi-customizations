import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import * as path from 'node:path';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '../..');
// The yaml package pi-pstack depends on, loaded by path: the parity scripts declare no dependencies of their own.
const YAML = createRequire(import.meta.url)(join(repo, 'extensions/pi-pstack/node_modules/yaml'));
const reference = process.env.PSTACK_REFERENCE_ROOT ?? '/home/josh/Documents/GitHub/plugins';
const RAW = '.audit/pstack-source-audit-2026-11-05/source';
const evidence = (id) => readFileSync(join(repo, RAW, `${id}.js`), 'utf8');
const hash = (text) => createHash('sha256').update(text).digest('hex');

// Cursor reads plugin agents with gray-matter. This subset parses the same YAML front matter with an independent parser.
function grayMatter(text) {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (match === null) return { data: {}, content: text };
  return { data: YAML.parse(match[1]) ?? {}, content: text.slice(match[0].length) };
}
class Message {
  constructor(fields) {
    Object.assign(this, fields);
  }
}
const cli = runInNewContext(`${evidence('cli-plugin-agent-parser')}\n${evidence('cli-plugin-agent-strip')}\n${evidence('cli-plugin-agent-convert')}\nconst loader = { ${evidence('cli-plugin-agent-loader')} };\n({ Wc, loader })`, {
  uc: { be: grayMatter },
  x: path,
  p: (identifier) => identifier.name,
  f: (identifier) => identifier.marketplace,
  h: (identifier) => `${identifier.marketplace}/${identifier.name}`,
  g: (identifier) => identifier.marketplace,
  Bs: {},
  Vr: { zz: Message, b$: { READONLY: 'readonly', DEFAULT: 'default' } },
});
// Hne and Wne are the composer model constants defined beside the captured definitions (main.js offset 1983820).
const desktop = runInNewContext(`${readFileSync(join(repo, RAW, 'desktop-agent-definitions.txt'), 'utf8')}\n({ build: Jle, custom: Ble, remind: Hle, subagentReminder: Nle })`, {
  $: new Proxy({}, { get: () => Message }),
  Hne: 'composer-2.5',
  Wne: 'composer-2.5-fast',
});
cli.loader.Bs = undefined;

async function loadPluginAgents(dir, plugin) {
  const files = readdirSync(dir)
    .filter((name) => name.endsWith('.md'))
    .toSorted();
  const agents = files.map((file) => cli.Wc({ content: readFileSync(join(dir, file), 'utf8'), relativePath: file })).filter((agent) => agent !== null);
  const context = {
    pluginsService: { getAllEnabledPlugins: async () => [{ identifier: { name: plugin, marketplace: 'cursor-public', source: 'cursor' }, installPath: dir, agents }] },
    getSettings: () => ({ importThirdPartyPlugins: true }),
  };
  const convert = runInNewContext(`${evidence('cli-plugin-agent-strip')}\n${evidence('cli-plugin-agent-convert')}\nBu`, {
    x: path,
    p: (identifier) => identifier.name,
    f: (identifier) => identifier.marketplace,
    h: (identifier) => `${identifier.marketplace}/${identifier.name}`,
    g: (identifier) => identifier.marketplace,
  });
  const load = runInNewContext(`({ ${evidence('cli-plugin-agent-loader')} }).load`, { Bs: { DuR: convert }, Vr: { zz: Message, b$: { READONLY: 'readonly', DEFAULT: 'default' } } });
  const records = await load.call(context, false);
  assert.equal(records.length, agents.length, `${dir}: every parsed agent loads`);
  return records.map((record) => {
    const config = desktop.remind(desktop.custom(record, false));
    return {
      type: record.name,
      file: path.relative(repo, record.fullPath),
      description: record.description,
      model: record.model,
      readonly: record.permissionMode === 'readonly',
      background: record.isBackground === true,
      tools: Array.from(record.tools),
      reminder: config.systemReminder({}),
    };
  });
}

const builtIns = desktop.build({ customSubagents: [], includeExploreSubagent: true, includeShellSubagent: true, includeBestOfNRunnerSubagent: false }).map((config) => ({
  type: config.subagent_type.type.case === 'unspecified' ? 'generalPurpose' : config.subagent_type.type.case,
  description: config.description,
  reminder: config.systemReminder({}),
}));
const piAgents = await loadPluginAgents(join(repo, 'extensions/pi-pstack/agents'), 'pi-pstack');
const referenceAgents = [...(await loadPluginAgents(join(reference, 'pstack/agents'), 'pstack')), ...(await loadPluginAgents(join(reference, 'cursor-team-kit/agents'), 'cursor-team-kit'))];
const sources = ['desktop-agent-definitions.txt', 'cli-plugin-agent-parser.js', 'cli-plugin-agent-strip.js', 'cli-plugin-agent-convert.js', 'cli-plugin-agent-loader.js'].map((file) => ({
  file: `${RAW}/${file}`,
  sha256: hash(readFileSync(join(repo, RAW, file))),
}));
const fixture = {
  source:
    'Executed Cursor CLI 2026.10.22-27dcf5f plugin-agent parser and loader, and Cursor desktop 3.27.22 agent definitions (Jle, Ble, Hle), on the agent files named below. Generated by parity/pstack-source-audit-2026-11-05/probe-agents.mjs.',
  sources,
  subagentReminder: desktop.subagentReminder,
  builtIns,
  agents: piAgents,
};
writeFileSync(join(repo, 'extensions/pi-pstack/test/fixtures/cursor-agent-definitions.json'), `${JSON.stringify(fixture, null, 2)}\n`);
writeFileSync(join(root, 'evidence/reference-agent-definitions.json'), `${JSON.stringify({ ...fixture, agents: referenceAgents }, null, 2)}\n`);
console.log(
  JSON.stringify(
    {
      builtIns: builtIns.map((agent) => agent.type),
      pi: piAgents.map(({ type, model, readonly, background }) => ({ type, model, readonly, background })),
      reference: referenceAgents.map(({ type, model, background }) => ({ type, model, background })),
    },
    null,
    2,
  ),
);
