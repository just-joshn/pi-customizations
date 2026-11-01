import { readFileSync } from 'node:fs';

import { expect, test } from 'vitest';
import { attestBody, attestedBytes, CCH_PLACEHOLDER, cchDigest, xxh64 } from '../src/attestation.ts';

type Capture = { cch: string; body: string };
const captures: Capture[] = (JSON.parse(readFileSync(new URL('./fixtures/claude-cch-2.1.316.json', import.meta.url), 'utf8')) as { bodies: Capture[] }).bodies;

function unattested(capture: Capture): string {
  return capture.body.replace(`cch=${capture.cch}`, CCH_PLACEHOLDER);
}

test.for(captures.map((capture, index) => ({ index, capture })))('capture $index: the cch Claude Code 2.1.316 wrote is reproduced', ({ capture }) => {
  expect(attestBody(unattested(capture))).toBe(capture.body);
});

test('xxh64 matches the reference vectors', () => {
  expect(xxh64(Buffer.alloc(0), 0n)).toBe(0xef46db3751d8e999n);
  expect(xxh64(Buffer.from('abc'), 0n)).toBe(0x44bc2cf5ad770999n);
  expect(xxh64(Buffer.from('Nobody inspects the spammish repetition'), 0n)).toBe(0xfbcea83c8a378bf1n);
});

test('the model value, max_tokens, and the fallback fields are not hashed', () => {
  const base = '{"model":"a","system":[{"text":"cch=00000;"}],"max_tokens":8}';
  const other = '{"model":"zzzz","system":[{"text":"cch=00000;"}],"max_tokens":99999}';
  expect(cchDigest(Buffer.from(base))).toBe(cchDigest(Buffer.from(other)));
  const withFallbacks = '{"model":"a","fallbacks":[{"model":"b","x":"]"}],"system":[{"text":"cch=00000;"}],"fallback_credit_token":"tok","max_tokens":8}';
  expect(attestedBytes(Buffer.from(withFallbacks)).toString()).toBe('{"model":"","system":[{"text":"cch=00000;"}],}');
});

test('a changed message changes the digest', () => {
  const one = '{"model":"a","messages":[{"content":"x"}],"system":[{"text":"cch=00000;"}]}';
  const two = '{"model":"a","messages":[{"content":"y"}],"system":[{"text":"cch=00000;"}]}';
  expect(cchDigest(Buffer.from(one))).not.toBe(cchDigest(Buffer.from(two)));
});

test('a body without the placeholder near the system array is unchanged', () => {
  const far = `{"model":"a","system":[{"text":"${'x'.repeat(400)}cch=00000;"}]}`;
  expect(attestBody(far)).toBe(far);
  expect(attestBody('{"model":"a"}')).toBe('{"model":"a"}');
});
