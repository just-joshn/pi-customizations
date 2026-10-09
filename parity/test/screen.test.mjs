import { expect, test } from 'vitest';
import { renderScreen } from '../recorder/screen.mjs';

const out = (seq, text) => ({ seq, kind: 'output', dataB64: Buffer.from(text).toString('base64') });

test('renders cursor movement and overwrites the way a terminal would', async () => {
  const events = [out(0, 'hello\r\nworld'), out(1, '\x1b[1;1HJ')];
  const screen = await renderScreen(events, { rows: 3, cols: 10 });
  expect(screen.lines).toEqual(['Jello', 'world', '']);
});

test('renders only events up to the requested seq and applies resize events', async () => {
  const events = [out(0, 'abcdef'), { seq: 1, kind: 'resize', rows: 3, cols: 3 }, out(2, '\r\nxyz')];
  const early = await renderScreen(events, { rows: 2, cols: 10, upToSeq: 0 });
  expect(early.lines[0]).toBe('abcdef');
  const late = await renderScreen(events, { rows: 2, cols: 10 });
  expect(late.cols).toBe(3);
  expect(late.lines.join('|')).toContain('xyz');
});
