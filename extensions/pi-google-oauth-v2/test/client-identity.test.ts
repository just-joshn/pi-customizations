import { afterEach, expect, test, vi } from 'vitest';
import { ROUTE_STREAM } from './constants.ts';
import { startSession } from './session.ts';
import { collect } from './sse.ts';

const AGENT_PREFIX = 'antigravity/cli/';

afterEach(() => {
  vi.restoreAllMocks();
  vi.resetModules();
  vi.unstubAllGlobals();
});

/** Loads a fresh copy of the extension on a machine with the given platform and architecture, and returns the User-Agent it sends to Google. */
async function userAgentOn(platform: string, arch: string): Promise<string | undefined> {
  vi.spyOn(process, 'platform', 'get').mockReturnValue(platform as NodeJS.Platform);
  vi.spyOn(process, 'arch', 'get').mockReturnValue(arch as NodeJS.Architecture);
  vi.resetModules();
  const { default: fresh } = await import('../src/index.ts');
  const session = await startSession({ extension: fresh });
  await collect(await session.stream(session.model('gemini-3.8-flash'), [{ role: 'user', content: 'hi', timestamp: 1 }]));
  return session.google.requestsTo(ROUTE_STREAM)[0]?.headers['user-agent'];
}

test.for([
  ['darwin', 'arm64', 'darwin', 'arm64'],
  ['linux', 'x64', 'linux', 'amd64'],
  ['win32', 'x64', 'windows', 'amd64'],
])('a %s/%s machine identifies as os_type=%s arch=%s', async ([platform, arch, osType, wireArch]) => {
  expect(await userAgentOn(platform ?? '', arch ?? '')).toBe(`${AGENT_PREFIX}1.5.9 (aidev_client; os_type=${osType}; arch=${wireArch}; cl=1021519450; auth_method=consumer)`);
});

test('passes an unmapped platform and architecture through', async () => {
  expect(await userAgentOn('freebsd', 'riscv64')).toContain('os_type=freebsd; arch=riscv64;');
});
