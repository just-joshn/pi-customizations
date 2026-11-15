import { describe, expect, test } from 'vitest';
import { antigravityUserAgent } from './constants.ts';

describe('antigravityUserAgent', () => {
  test.for([
    ['darwin', 'arm64', 'darwin', 'arm64'],
    ['linux', 'x64', 'linux', 'amd64'],
    ['win32', 'x64', 'windows', 'amd64'],
  ])('maps %s/%s to os_type=%s arch=%s', ([platform, arch, osType, wireArch]) => {
    expect(antigravityUserAgent(platform, arch)).toBe(`antigravity/cli/1.5.9 (aidev_client; os_type=${osType}; arch=${wireArch}; cl=1021519450; auth_method=consumer)`);
  });

  test('passes an unmapped platform and architecture through', () => {
    expect(antigravityUserAgent('freebsd', 'riscv64')).toContain('os_type=freebsd; arch=riscv64;');
  });
});
