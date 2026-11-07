import { expect, test } from 'vitest';
import { hostUserArgs } from '../src/cloud/machine.ts';

test.for([
  { platform: 'linux', readonly: false, uid: 1000, gid: 1000, args: ['--user', '1000:1000', '--env', 'HOME=/tmp'] },
  { platform: 'linux', readonly: false, uid: 0, gid: 0, args: [] },
  { platform: 'darwin', readonly: false, uid: 501, gid: 20, args: [] },
  { platform: 'darwin', readonly: true, uid: 501, gid: 20, args: ['--user', '501:20', '--env', 'HOME=/tmp'] },
  { platform: 'linux', readonly: true, uid: 1000, gid: 1000, args: ['--user', '1000:1000', '--env', 'HOME=/tmp'] },
] as const)('a container machine on $platform as uid $uid (readonly $readonly) runs with $args', ({ platform, readonly, uid, gid, args }) => {
  expect(hostUserArgs(readonly, platform, uid, gid)).toEqual(args);
});
