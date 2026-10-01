import { expect, test } from 'vitest';
import { hostVersionNotice } from '../src/host-version.ts';

test.for([
  { installed: '0.99.1', tested: '0.99.2', notice: 'pi-pstack was verified on Pi 0.99.2 or newer. This Pi is 0.99.1, so behavior is unverified.' },
  { installed: '0.98.9', tested: '0.99.2', notice: 'pi-pstack was verified on Pi 0.99.2 or newer. This Pi is 0.98.9, so behavior is unverified.' },
  { installed: '0.99.2', tested: '0.99.2', notice: undefined },
  { installed: '0.99.10', tested: '0.99.2', notice: undefined },
  { installed: '1.0.0', tested: '0.99.2', notice: undefined },
])('Pi $installed against tested $tested gives $notice', ({ installed, tested, notice }) => {
  expect(hostVersionNotice(installed, tested)).toBe(notice);
});

test('an unparseable host version is reported rather than assumed new enough', () => {
  expect(hostVersionNotice('dev', '0.99.2')).toBe('pi-pstack was verified on Pi 0.99.2 or newer. This Pi is dev, so behavior is unverified.');
});
