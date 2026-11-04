import { expect, test } from 'vitest';
import { imageFileName } from '../src/generate-image.ts';

const now = new Date('2026-11-03T12:00:00.000Z');

test.for([
  { requested: 'diagram.png', mimeType: 'image/png', index: 0, expected: 'diagram.png' },
  { requested: 'nested/dir/diagram.png', mimeType: 'image/png', index: 0, expected: 'diagram.png' },
  { requested: 'photo.png', mimeType: 'image/jpeg', index: 0, expected: 'photo.jpg' },
  { requested: 'set.webp', mimeType: 'image/webp', index: 2, expected: 'set-3.webp' },
  { requested: undefined, mimeType: 'image/png', index: 0, expected: 'image-2026-11-03T12-00-00-000Z.png' },
])('saves $requested ($mimeType, image $index) as $expected', ({ requested, mimeType, index, expected }) => {
  expect(imageFileName(requested, mimeType, index, now)).toBe(expected);
});
