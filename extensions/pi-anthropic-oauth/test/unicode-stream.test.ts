import { expect } from 'vitest';
import { ask } from './support/context.ts';
import { test } from './support/fixtures.ts';
import { splitReply } from './support/messages-server.ts';
import { collect, textOf } from './support/run-stream.ts';
import { frames, textMessage } from './support/sse.ts';

const cases = [
  { name: 'a two-byte character', text: 'caf\u00e9', leadByte: 0xc3 },
  { name: 'a three-byte character', text: 'price \u20ac5', leadByte: 0xe2 },
  { name: 'an astral emoji', text: 'ok \u{1F642}!', leadByte: 0xf0 },
];

test.for(cases)('$name split across chunks arrives whole', async ({ text, leadByte }, { models, model, server }) => {
  const body = new TextEncoder().encode(frames(textMessage(text)));
  server.respond(splitReply(new TextDecoder().decode(body), body.indexOf(leadByte) + 1));
  const { message } = await collect(models.streamSimple(model, ask('hi')));
  expect(textOf(message)).toBe(text);
});
