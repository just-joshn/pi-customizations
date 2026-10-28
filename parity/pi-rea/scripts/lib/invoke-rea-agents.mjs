import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

const REA_PKG = 'rea-agents@6.8.0';

const resolveNpx = () => {
  const which = spawnSync('which', ['npx'], { encoding: 'utf8' });
  if (which.status === 0 && which.stdout.trim() !== '') return which.stdout.trim();
  const besideNode = join(dirname(process.execPath), 'npx');
  if (existsSync(besideNode)) return besideNode;
  const mise = `${process.env.HOME ?? ''}/.local/share/mise/installs/node/lts/bin/npx`;
  if (existsSync(mise)) return mise;
  return 'npx';
};

const NPX = resolveNpx();

const oracleEnv = (options = {}) => {
  const pathParts = [dirname(NPX), dirname(process.execPath), process.env.PATH].filter(Boolean);
  return {
    ...process.env,
    PATH: pathParts.join(':'),
    npm_config_loglevel: 'error',
    ...(options.env ?? {}),
  };
};

export const invokeReaAgentsCli = (args, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(NPX, ['-y', REA_PKG, ...args, '--format', 'json', '--full-output'], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: oracleEnv(options),
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      const trimmed = stdout.trim();
      if (trimmed === '') {
        reject(new Error(`rea-agents exited ${code} with empty stdout. stderr=${stderr.slice(0, 2000)}`));
        return;
      }
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch (error) {
        reject(new Error(`rea-agents stdout was not JSON (${error.message}). head=${trimmed.slice(0, 400)}`));
        return;
      }
      resolve({ exitCode: code ?? 1, parsed, stderr });
    });
  });

export const classifyOracle = (parsed) => {
  if (parsed && typeof parsed === 'object' && parsed.ok === true && parsed.data !== undefined) {
    return { kind: 'evidence', body: parsed.data, meta: parsed.meta ?? null };
  }
  if (parsed && typeof parsed === 'object' && parsed.ok === false && parsed.error !== undefined) {
    return { kind: 'error', body: parsed.error, meta: parsed.meta ?? null };
  }
  if (parsed && typeof parsed === 'object' && parsed.ok === false && parsed.data !== undefined) {
    return { kind: 'error', body: parsed.data, meta: parsed.meta ?? null };
  }
  if (parsed && typeof parsed === 'object' && typeof parsed.code === 'string') {
    return { kind: 'error', body: parsed, meta: null };
  }
  return { kind: 'error', body: { code: 'execution_failure', category: 'execution_failure', message: 'unclassified oracle output', retryable: false, remediation: { action: 'inspect raw' }, details: { parsed } }, meta: null };
};

const unwrapMcpErrorBody = (parsed, fallbackText) => {
  if (parsed && typeof parsed === 'object' && parsed.error && typeof parsed.error === 'object' && typeof parsed.error.code === 'string') {
    return parsed.error;
  }
  if (parsed && typeof parsed === 'object' && typeof parsed.code === 'string') return parsed;
  return {
    code: 'execution_failure',
    category: 'execution_failure',
    message: typeof fallbackText === 'string' ? fallbackText : 'mcp error',
    retryable: false,
    remediation: { action: 'inspect' },
  };
};

const classifyMcpToolResponse = (response, stderr = '') => {
  const result = response?.result;
  if (result?.isError) {
    const text = result.content?.[0]?.text;
    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
    return { kind: 'error', body: unwrapMcpErrorBody(parsed, text), raw: response, stderr };
  }
  const structured = result?.structuredContent !== undefined ? result.structuredContent : JSON.parse(result.content[0].text);
  if (structured && typeof structured === 'object' && typeof structured.evidence_id === 'string') {
    return { kind: 'evidence', body: structured, raw: response, stderr };
  }
  return { kind: 'configuration', body: structured, raw: response, stderr };
};

export const invokeReaAgentsMcp = (toolName, args, options = {}) => invokeReaAgentsMcpSession([[toolName, args ?? {}]], options).then((results) => results[0]);

export const invokeReaAgentsMcpSession = (calls, options = {}) =>
  new Promise((resolve, reject) => {
    const child = spawn(NPX, ['-y', REA_PKG, '--mcp'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: oracleEnv(options),
    });
    let buffer = '';
    const pending = new Map();
    let stderr = '';
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });
    child.stdout.on('data', (chunk) => {
      buffer += chunk.toString();
      let index = buffer.indexOf('\n');
      while (index >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (line !== '') {
          try {
            const message = JSON.parse(line);
            if (message.id !== undefined && pending.has(message.id)) {
              pending.get(message.id)(message);
              pending.delete(message.id);
            }
          } catch {}
        }
        index = buffer.indexOf('\n');
      }
    });
    const call = (id, method, params) =>
      new Promise((res) => {
        pending.set(id, res);
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      });

    (async () => {
      try {
        await call(1, 'initialize', {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'pi-rea-differential', version: '0.1.0' },
        });
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);
        const results = [];
        let id = 2;
        for (const [toolName, args] of calls) {
          const response = await call(id, 'tools/call', { name: toolName, arguments: args ?? {} });
          id += 1;
          results.push(classifyMcpToolResponse(response, stderr));
        }
        child.kill('SIGTERM');
        resolve(results);
      } catch (error) {
        child.kill('SIGTERM');
        reject(error);
      }
    })().catch(reject);
  });
