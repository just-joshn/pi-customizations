import { createServer } from 'node:http';

import { expect, onTestFinished, test } from 'vitest';
import { makeSandbox, runJson, script, toolEnds } from './harness.ts';

test.skipIf(process.platform !== 'darwin' && process.platform !== 'linux').for([
  { label: 'a readonly child can read HTTP with Node native fetch', environment: "NO_PROXY=''" },
  { label: 'a readonly child can use Node native fetch through the configured HTTP proxy', environment: "NO_PROXY='' no_proxy=''" },
])('$label', async ({ environment }, { signal }) => {
  const sandbox = makeSandbox();
  onTestFinished(() => sandbox.dispose());
  const server = createServer((_request, response) => response.end('NATIVE-NET-OK'));
  onTestFinished(() => {
    if (server.listening) return new Promise<void>((resolve, reject) => server.close((error) => (error === undefined ? resolve() : reject(error))));
    return undefined;
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen({ host: '127.0.0.1', port: 0, signal }, resolve);
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('The HTTP fixture has no TCP address.');
  const url = `http://127.0.0.1:${address.port}/`;
  await expect(fetch(url, { signal }).then((response) => response.text())).resolves.toBe('NATIVE-NET-OK');
  const program =
    'const info = () => JSON.stringify({ node: process.version, proxyFlag: process.env.NODE_USE_ENV_PROXY === "1", proxyPresent: Boolean(process.env.HTTP_PROXY), lowercaseProxyPresent: Boolean(process.env.http_proxy), noProxyPresent: Boolean(process.env.NO_PROXY), lowercaseNoProxyPresent: Boolean(process.env.no_proxy) }); fetch(process.argv[1], { signal: AbortSignal.timeout(10000) }).then(response => response.text()).then(text => console.log(text + "\\n" + info())).catch(error => { console.error(error); console.error(info()); process.exitCode = 1; });';
  const command = `${environment} ${JSON.stringify(process.execPath)} -e ${JSON.stringify(program)} ${url}`;
  const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'native fetch probe', readonly: true, prompt: script([{ tool: 'bash', args: { command } }]) } }]), ['--no-session']);
  const [result] = toolEnds(run.events, 'Task');
  expect(result?.isError, result?.text).toBe(false);
  expect(result?.text).toContain('[bash] NATIVE-NET-OK');
});
