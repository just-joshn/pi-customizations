import { describe, expect, test } from 'vitest';
import { decode, decodeValue, EnvelopeReader, encode, encodeValue, frame, type Json, str } from '../src/cursor/proto.ts';

describe('google.protobuf.Value codec', () => {
  test.for<[string, Json]>([
    ['string', 'Paris'],
    ['number', 21.5],
    ['bool', true],
    ['null', null],
    ['list', [1, 'two', false]],
    ['JSON schema object', { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] }],
  ])('round-trips a %s', ([, value]) => {
    expect(decodeValue(encodeValue(value))).toStrictEqual(value);
  });
});

test('decodes nested messages written by encode', () => {
  const bytes = encode([
    [
      1,
      [
        [1, 'hello'],
        [2, 7],
      ],
    ],
    [5, 'conv-1'],
  ]);
  const outer = decode(bytes);
  const inner = decode(outer.bytes.get(1)?.[0] ?? new Uint8Array());
  expect(str(inner, 1)).toBe('hello');
  expect(inner.varints.get(2)).toStrictEqual([7n]);
  expect(str(outer, 5)).toBe('conv-1');
});

test('reassembles Connect envelopes split across chunks', () => {
  const a = frame(encode([[1, 'first']]));
  const b = frame(encode([[1, 'second']]));
  const joined = new Uint8Array([...a, ...b]);
  const reader = new EnvelopeReader();
  const got = [...reader.push(joined.subarray(0, 7)), ...reader.push(joined.subarray(7))];
  expect(got.map((e) => (e.end ? e.json : str(decode(e.payload), 1)))).toStrictEqual(['first', 'second']);
});

test('rejects a length-delimited field that runs past the buffer', () => {
  expect(() => decode(Uint8Array.of(0x0a, 0x05, 0x61))).toThrow('truncated protobuf field');
});

test('rejects a fixed64 field that runs past the buffer', () => {
  expect(() => decode(Uint8Array.of(0x09, 0x01, 0x02))).toThrow('truncated protobuf field');
});
