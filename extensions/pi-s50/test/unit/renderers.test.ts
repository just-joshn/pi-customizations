import { describe, expect, test } from 'vitest';
import { messageBody, S50_MESSAGE } from '../../src/renderers.ts';
import { loadFakePi } from '../support/fake-pi.ts';

describe('s50 message renderer', () => {
  test('factory registers a renderer for customType s50', () => {
    expect(typeof loadFakePi().renderer(S50_MESSAGE)).toBe('function');
  });

  test.for([
    { content: 'plain', expected: 'plain' },
    { content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }], expected: 'a\nb' },
    { content: [], expected: '' },
  ])('messageBody flattens $expected', ({ content, expected }) => {
    expect(messageBody(content)).toBe(expected);
  });
});
