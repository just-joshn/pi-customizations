import { expect, test } from 'vitest';
import { hostUserArgs } from '../src/cloud/machine.ts';

test.for([
  { platform: 'linux', uid: 1000, gid: 1000, args: ['--user', '1000:1000', '--env', 'HOME=/tmp'] },
  { platform: 'linux', uid: 0, gid: 0, args: [] },
  { platform: 'darwin', uid: 501, gid: 20, args: [] },
] as const)('a container machine on $platform as uid $uid runs with $args', ({ platform, uid, gid, args }) => {
  expect(hostUserArgs(platform, uid, gid)).toEqual(args);
});
