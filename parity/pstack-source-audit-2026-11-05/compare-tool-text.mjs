// Compares the tool text a live Cursor CLI session declared with the text real Pi declares for pi-pstack, over RPC so
// tools that need a person (SwitchMode) are present. Writes Cursor and Pi text to the ignored .audit tree and prints
// only similarity numbers.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const repo = resolve(root, '../..');
const pkg = join(repo, 'extensions/pi-pstack');
const live = join(repo, '.audit/pi-pstack-behavior-parity/cursor-evidence');
const out = join(repo, '.audit/pstack-source-audit-2026-11-05/tool-text');

function cursorTools() {
  const tools = new Map();
  for (const file of ['dynamic-tool-schemas.jsonl', 'task-schema.jsonl']) {
    const walk = (value) => {
      if (typeof value === 'string' && value.startsWith('{"tool":')) {
        const tool = JSON.parse(value);
        if (!tools.has(tool.tool)) tools.set(tool.tool, tool);
      } else if (value !== null && typeof value === 'object') for (const child of Object.values(value)) walk(child);
    };
    for (const line of readFileSync(join(live, file), 'utf8').trim().split('\n')) walk(JSON.parse(line));
  }
  return tools;
}

async function piTools(names) {
  const sandbox = mkdtempSync(join(tmpdir(), 'pstack-tool-text-'));
  const agentDir = join(sandbox, 'agent');
  const workDir = join(sandbox, 'work');
  mkdirSync(agentDir);
  mkdirSync(workDir);
  writeFileSync(join(agentDir, 'settings.json'), JSON.stringify({ packages: [pkg], extensions: [join(pkg, 'test/fixtures/scripted-model.ts'), join(pkg, 'test/fixtures/image-model.ts')], quietStartup: true }));
  const child = spawn('pi', ['--mode', 'rpc', '--offline', '--no-session', '--model', 'scripted/echo'], {
    cwd: workDir,
    env: { ...process.env, HOME: sandbox, PI_CODING_AGENT_DIR: agentDir, PI_OFFLINE: '1', PI_SKIP_VERSION_CHECK: '1' },
    stdio: ['pipe', 'pipe', 'inherit'],
  });
  const replies = [];
  let buffer = '';
  let settled;
  child.stdout.on('data', (chunk) => {
    buffer += chunk.toString('utf8');
    for (let index = buffer.indexOf('\n'); index !== -1; index = buffer.indexOf('\n')) {
      const event = JSON.parse(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
      if (event.type === 'message_end' && event.message.role === 'assistant') replies.push(event.message.content.map((part) => part.text ?? '').join(''));
      if (event.type === 'agent_settled') settled?.();
    }
  });
  const ask = (message) =>
    new Promise((resolveAsk) => {
      settled = resolveAsk;
      child.stdin.write(`${JSON.stringify({ type: 'prompt', message })}\n`);
    });
  try {
    const result = new Map();
    for (const name of names) {
      await ask(`describe\n@@tool-description ${name}`);
      const description = replies.at(-1);
      await ask(`schema\n@@tool-schema ${name}`);
      const schema = replies.at(-1);
      result.set(name, { description, parameters: schema === 'NO SUCH TOOL' ? undefined : JSON.parse(schema) });
    }
    return result;
  } finally {
    child.stdin.end();
    await new Promise((resolveExit) => child.once('close', resolveExit));
    rmSync(sandbox, { recursive: true, force: true });
  }
}

// Longest common subsequence over words: the share of Cursor's words Pi keeps in order.
function similarity(cursor, pi) {
  const a = cursor.split(/\s+/).filter(Boolean);
  const b = (pi ?? '').split(/\s+/).filter(Boolean);
  const previous = new Array(b.length + 1).fill(0);
  for (let i = 1; i <= a.length; i += 1) {
    let diagonal = 0;
    for (let j = 1; j <= b.length; j += 1) {
      const above = previous[j];
      previous[j] = a[i - 1] === b[j - 1] ? diagonal + 1 : Math.max(previous[j], previous[j - 1]);
      diagonal = above;
    }
  }
  const common = previous[b.length];
  return { cursorWords: a.length, piWords: b.length, keptOfCursor: Number((common / Math.max(1, a.length)).toFixed(3)), piFromCursor: Number((common / Math.max(1, b.length)).toFixed(3)) };
}

const cursor = cursorTools();
const names = ['Task', 'TodoWrite', 'SwitchMode', 'GenerateImage', 'AwaitShell'];
const pi = await piTools(names);
mkdirSync(out, { recursive: true });
const report = {};
for (const name of names) {
  const cursorTool = cursor.get(name);
  const piTool = pi.get(name);
  assert.ok(cursorTool !== undefined && piTool !== undefined, name);
  const parameters = {};
  for (const [parameter, schema] of Object.entries(cursorTool.inputSchema.properties ?? {})) {
    const piParameter = piTool.parameters?.properties?.[parameter];
    parameters[parameter] = piParameter === undefined ? 'missing in Pi' : similarity(schema.description ?? '', piParameter.description ?? '').keptOfCursor;
  }
  report[name] = {
    description: similarity(cursorTool.description, piTool.description),
    parameters,
    piOnlyParameters: Object.keys(piTool.parameters?.properties ?? {}).filter((parameter) => !(parameter in (cursorTool.inputSchema.properties ?? {}))),
  };
  writeFileSync(join(out, `${name}.cursor.json`), `${JSON.stringify(cursorTool, null, 2)}\n`);
  writeFileSync(join(out, `${name}.pi.json`), `${JSON.stringify(piTool, null, 2)}\n`);
}
writeFileSync(join(root, 'evidence/tool-text-similarity.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
