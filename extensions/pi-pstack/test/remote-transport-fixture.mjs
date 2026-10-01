const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
const mode = process.argv[2];
if (mode === 'invalid') {
  process.stdout.write('not JSON');
  process.exit(0);
}
if (mode === 'error') {
  process.stdout.write(JSON.stringify({ success: false, error: 'Remote machine identity differs' }));
  process.exit(1);
}
function resultFor(request) {
  if (mode === 'environment') return { secret: process.env.PI_REMOTE_TEST_SECRET, request };
  if (request.operation === 'info') return { kind: 'ready', pid: 123, childPid: 456 };
  if (request.operation === 'activity') return { kind: 'running', invocation: 'test-invocation' };
  if (request.operation === 'snapshot' || request.operation === 'close') return null;
  if (request.operation === 'send') return { type: 'response', command: request.command.type, success: true, data: { invocation: request.invocation } };
}
process.stdout.write(JSON.stringify({ success: true, result: resultFor(request) }));
