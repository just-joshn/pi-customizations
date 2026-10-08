import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { join } from 'node:path';

import { createRpcSession } from '../lib/rpc.mjs';

const commands = {
  'git diff': [],
  'git diff HEAD': ['HEAD'],
  'git diff -- greeting.mjs': ['--', 'greeting.mjs'],
};
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;

function sourceSnapshot(cwd) {
  const files = [];
  let bytes = 0;
  let entries = 0;
  function visit(directory, prefix = '') {
    for (const name of readdirSync(directory).sort()) {
      const path = join(directory, name);
      const relative = prefix + name;
      const stat = lstatSync(path);
      if (++entries > 128) throw new Error('Source snapshot entry bound exceeded');
      if (relative === '.git' && stat.isDirectory()) continue;
      if (stat.isDirectory()) visit(path, `${relative}/`);
      else {
        bytes += stat.size;
        if (!stat.isFile() || files.length >= 64 || bytes > 1048576) throw new Error('Source snapshot is not a bounded regular-file tree');
        files.push({ path: relative, mode: stat.mode, size: stat.size, mtimeMs: stat.mtimeMs, ctimeMs: stat.ctimeMs, sha256: digest(readFileSync(path)) });
      }
    }
  }
  visit(cwd);
  return files;
}

export async function recordSimplifySession({ cleanup, root, packagePath }) {
  await cleanup.session.close();
  const token = randomBytes(32).toString('hex');
  const tokenPath = join(cleanup.out, 'recording-capability');
  const socketPath = join(root, 'simplify.sock');
  const extension = join(cleanup.out, 'simplify-recording.mjs');
  const wrapper = join(cleanup.out, 'recorded-pi');
  const configPath = join(cleanup.cwd, '.git/config');
  const seededConfig = readFileSync(configPath);
  const observations = [];
  let parentSessionId;
  let session;
  const sockets = new Set();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let data = '';
    socket.setTimeout(10000, () => socket.destroy());
    socket.on('error', () => {});
    socket.on('data', (chunk) => {
      data += chunk;
      if (data.length > 8192) return socket.destroy();
      if (!data.includes('\n')) return;
      socket.pause();
      try {
        const request = JSON.parse(data);
        if (request.token !== token || request.parentSessionId !== parentSessionId || typeof request.toolCallId !== 'string' || !Object.hasOwn(commands, request.command))
          throw new Error('Unauthenticated or unsupported recording operation');
        if (lstatSync(join(cleanup.cwd, '.git')).isSymbolicLink() || !readFileSync(configPath).equals(seededConfig)) throw new Error('Seeded Git configuration changed');
        const before = sourceSnapshot(cleanup.cwd);
        const argv = ['--no-pager', '-c', 'core.hooksPath=/dev/null', '-c', 'core.fsmonitor=false', '-c', 'diff.external=', 'diff', '--no-ext-diff', '--no-textconv', ...commands[request.command]];
        const stdout = execFileSync('/usr/bin/git', argv, {
          cwd: cleanup.cwd,
          env: { PATH: '/usr/bin:/bin', HOME: cleanup.cwd, LANG: 'C', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0' },
          encoding: 'utf8',
          timeout: 10000,
          maxBuffer: 1048576,
        });
        const after = sourceSnapshot(cleanup.cwd);
        if (JSON.stringify(before) !== JSON.stringify(after) || !readFileSync(configPath).equals(seededConfig)) throw new Error('Source or configuration changed during bounded Git operation');
        observations.push({
          toolCallId: request.toolCallId,
          complete: true,
          sourceEdit: false,
          execution: { executable: '/usr/bin/git', argv, code: 0, shell: false },
          sourceBefore: before,
          sourceAfter: after,
          seededConfigSha256: digest(seededConfig),
        });
        socket.end(`${JSON.stringify({ stdout })}\n`);
      } catch (error) {
        socket.end(`${JSON.stringify({ error: error.message })}\n`);
      }
    });
  });
  const close = async () => {
    try {
      await session?.close();
    } finally {
      for (const socket of sockets) socket.destroy();
      if (server.listening) await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
      rmSync(tokenPath, { force: true });
    }
  };
  try {
    await new Promise((resolve, reject) => {
      server.once('error', reject);
      server.listen(socketPath, resolve);
    });
    writeFileSync(tokenPath, token, { mode: 0o600 });
    writeFileSync(cleanup.profile, `${readFileSync(cleanup.profile, 'utf8')}\n(deny file-read-data (literal ${JSON.stringify(tokenPath)}))\n`);
    writeFileSync(wrapper, readFileSync(cleanup.wrapper, 'utf8').replace('#!/bin/sh\n', `#!/bin/sh\nexec 3<${quote(tokenPath)}\n`), { mode: 0o700 });
    writeFileSync(
      extension,
      `import { readFileSync, closeSync } from 'node:fs';
import { connect } from 'node:net';
import { createBashTool } from '@earendil-works/pi-coding-agent';
const token = readFileSync(3, 'utf8');
closeSync(3);
export default function(pi) {
  const original = createBashTool(${JSON.stringify(cleanup.cwd)});
  pi.registerTool({ ...original, execute: async (id, args, signal, onUpdate, ctx) => {
    if (!${JSON.stringify(Object.keys(commands))}.includes(args.command)) return original.execute(id, args, signal, onUpdate);
    const reply = await new Promise((resolve, reject) => {
      const socket = connect(${JSON.stringify(socketPath)});
      let data = '';
      socket.setTimeout(10000, () => socket.destroy(new Error('Recording deadline reached')));
      socket.on('error', reject);
      socket.on('connect', () => socket.write(JSON.stringify({ token, toolCallId: id, command: args.command, parentSessionId: ctx.sessionManager.getSessionId() }) + '\\n'));
      socket.on('data', (chunk) => { data += chunk; });
      socket.on('end', () => { try { resolve(JSON.parse(data)); } catch (error) { reject(error); } });
    });
    if (reply.error) throw new Error(reply.error);
    return { content: [{ type: 'text', text: reply.stdout || 'Empty diff' }], details: undefined };
  }});
}
`,
    );
    session = createRpcSession({
      packagePath,
      agentDir: cleanup.agentDir,
      cwd: cleanup.cwd,
      piBin: wrapper,
      env: cleanup.env,
      extraExtensions: [extension],
      persistSession: true,
      capturePath: join(cleanup.out, 'rpc.jsonl'),
      idleTimeoutMs: 120000,
    });
    const state = await session.state();
    rmSync(tokenPath, { force: true });
    parentSessionId = state.sessionId;
    return {
      session,
      state: { sessionId: state.sessionId, sessionFile: state.sessionFile },
      observations: () => structuredClone(observations),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
