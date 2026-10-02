import { expect, test } from 'vitest';
import { hostVersionNotice } from '../src/host-version.ts';

test.for([
  { installed: '0.99.9', tested: '1.0.0', notice: 'pi-pstack was verified on Pi 1.0.0 or newer. This Pi is 0.99.9, so behavior is unverified.' },
  { installed: '0.98.9', tested: '1.0.0', notice: 'pi-pstack was verified on Pi 1.0.0 or newer. This Pi is 0.98.9, so behavior is unverified.' },
  { installed: '1.0.0', tested: '1.0.0', notice: undefined },
  { installed: '1.0.10', tested: '1.0.0', notice: undefined },
  { installed: '1.1.0', tested: '1.0.0', notice: undefined },
])('Pi $installed against tested $tested gives $notice', ({ installed, tested, notice }) => {
  expect(hostVersionNotice(installed, tested)).toBe(notice);
});

test('an unparseable host version is reported rather than assumed new enough', () => {
  expect(hostVersionNotice('dev', '1.0.0')).toBe('pi-pstack was verified on Pi 1.0.0 or newer. This Pi is dev, so behavior is unverified.');
});
