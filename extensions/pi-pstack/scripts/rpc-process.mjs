const requestDeadlineMs = 15000;
const shutdownDeadlineMs = 5000;

function sendCommand(child, requests, command, sequence, policy, getStderr, fail, failure, closed) {
  if (failure || closed) return Promise.reject(failure ?? closed);
  const id = `check-${sequence}`;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      requests.delete(id);
      reject(new Error(`RPC timed out: ${command.type}. ${getStderr()}`));
    }, policy.requestDeadlineMs);
    requests.set(id, { resolve, reject, timer });
    try {
      child.stdin.write(`${JSON.stringify({ id, ...command })}\n`, (error) => {
        if (error) fail(error);
      });
    } catch (error) {
      fail(error);
    }
  });
}

export function rpcProcess(child, policy = { requestDeadlineMs, shutdownDeadlineMs }) {
  const requests = new Map();
  const toolUpdates = [];
  let failure;
  let closed;
  let stderr = '';
  let sequence = 0;
  const fail = (error) => {
    failure ??= error;
    rejectPending(requests, failure);
  };
  const reader = readRecords((record) => receiveResponse(record, requests, toolUpdates), fail);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', reader.data);
  child.stdout.on('end', reader.end);
  child.stderr.on('data', (data) => {
    stderr += data.toString();
  });
  child.stdin.on('error', fail);
  child.on('error', fail);
  const ended = new Promise((resolve) =>
    child.once('close', (code, signal) => {
      closed = new Error(`Pi exited ${code ?? signal}: ${stderr}`);
      rejectPending(requests, failure ?? closed);
      resolve(code);
    }),
  );
  return {
    toolUpdates,
    send(command) {
      return sendCommand(child, requests, command, ++sequence, policy, () => stderr, fail, failure, closed);
    },
    get stderr() {
      return stderr;
    },
    async finish() {
      const code = await finish(child, ended, policy.shutdownDeadlineMs);
      if (failure) throw failure;
      return code;
    },
    async close() {
      if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
      await ended;
    },
  };
}

function rejectPending(requests, error) {
  for (const pending of requests.values()) {
    clearTimeout(pending.timer);
    pending.reject(error);
  }
  requests.clear();
}

function receiveResponse(record, requests, toolUpdates) {
  if (!record || typeof record !== 'object' || Array.isArray(record) || typeof record.type !== 'string') throw new Error('Invalid RPC record');
  if (record.type === 'extension_error') throw new Error(`RPC extension error: ${record.error}`);
  if (record.type === 'tool_execution_update') toolUpdates.push(record);
  if (record.type !== 'response') return;
  if (typeof record.success !== 'boolean' || (record.id !== undefined && typeof record.id !== 'string')) throw new Error('Invalid RPC response');
  const pending = requests.get(record.id);
  if (!pending) return;
  requests.delete(record.id);
  clearTimeout(pending.timer);
  if (record.success) pending.resolve(record.data);
  else pending.reject(new Error(record.error ?? 'RPC command failed'));
}

function readRecords(receive, fail) {
  let output = '';
  const data = (chunk) => {
    output += chunk;
    let boundary = output.indexOf('\n');
    while (boundary >= 0) {
      const line = output.slice(0, boundary).replace(/\r$/, '');
      output = output.slice(boundary + 1);
      if (line) {
        try {
          receive(JSON.parse(line));
        } catch (error) {
          fail(new Error(`Invalid RPC record: ${String(error)}`));
        }
      }
      boundary = output.indexOf('\n');
    }
  };
  return {
    data,
    end() {
      if (output) fail(new Error('Invalid RPC record: unterminated output'));
    },
  };
}

async function finish(child, ended, deadline) {
  child.stdin.end();
  const timer = setTimeout(() => child.kill('SIGKILL'), deadline);
  try {
    return await ended;
  } finally {
    clearTimeout(timer);
  }
}
