// The Connect framing and the few protobuf fields Cursor's AgentService/Run uses, written
// independently of src/cursor/native/wire.ts so the peer does not reuse the code under test.

function varint(value) {
  let rest = BigInt(value);
  const bytes = [];
  while (rest > 127n) {
    bytes.push(Number((rest & 127n) | 128n));
    rest >>= 7n;
  }
  bytes.push(Number(rest));
  return Buffer.from(bytes);
}
const field = (number, payload) => Buffer.concat([varint((BigInt(number) << 3n) | 2n), varint(payload.length), payload]);
const text = (number, value) => field(number, Buffer.from(value));
const num = (number, value) => Buffer.concat([varint(BigInt(number) << 3n), varint(value)]);

function envelope(payload, flags = 0) {
  const head = Buffer.alloc(5);
  head[0] = flags;
  head.writeUInt32BE(payload.length, 1);
  return Buffer.concat([head, payload]);
}

// Frames the peer sends.
export const frames = {
  contextRequest: (execId) => envelope(field(2, Buffer.concat([text(1, execId), field(10, Buffer.alloc(0))]))),
  text: (value) => envelope(field(1, field(1, text(1, value)))),
  turnEnd: ({ input, output, cacheRead, cacheWrite }) => envelope(field(1, field(14, Buffer.concat([num(1, input), num(2, output), num(3, cacheRead), num(4, cacheWrite)])))),
  error: (body) => envelope(Buffer.from(JSON.stringify(body)), 2),
};

function readVarint(buf, offset) {
  let value = 0n;
  let shift = 0n;
  let at = offset;
  while (at < buf.length) {
    const byte = buf[at++];
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) break;
    shift += 7n;
  }
  return [value, at];
}

function fields(buf) {
  const out = [];
  let at = 0;
  while (at < buf.length) {
    const [key, next] = readVarint(buf, at);
    at = next;
    const number = Number(key >> 3n);
    const wire = Number(key & 7n);
    if (wire === 0) {
      const [value, after] = readVarint(buf, at);
      at = after;
      out.push({ number, value: Number(value) });
    } else if (wire === 2) {
      const [length, after] = readVarint(buf, at);
      out.push({ number, buf: buf.subarray(after, after + Number(length)) });
      at = after + Number(length);
    } else break;
  }
  return out;
}

// The bytes of a nested length-delimited field, following field numbers from the top.
export const pick = (buf, ...path) => path.reduce((current, number) => current && fields(current).find((f) => f.number === number)?.buf, buf);

// Splits a byte stream into frame payloads; `rest` is an incomplete trailing frame.
export function splitFrames(buf) {
  const payloads = [];
  let at = 0;
  while (at + 5 <= buf.length) {
    const length = buf.readUInt32BE(at + 1);
    if (at + 5 + length > buf.length) break;
    payloads.push(buf.subarray(at + 5, at + 5 + length));
    at += 5 + length;
  }
  return { payloads, rest: buf.subarray(at) };
}

// What the client's Run frame asks for.
export function readRunFrame(payload) {
  const run = pick(payload, 1);
  const user = pick(run, 2, 1, 1);
  return {
    prompt: pick(user, 1)?.toString('utf8') ?? null,
    mode: fields(user ?? Buffer.alloc(0)).find((f) => f.number === 4)?.value ?? null,
    modelId: pick(run, 9, 1)?.toString('utf8') ?? null,
    conversationId: pick(run, 5)?.toString('utf8') ?? null,
  };
}

// What the client's reply to a context request carries.
export const readContextReply = (payload) => ({ execId: pick(payload, 2, 1)?.toString('utf8') ?? null, hasResult: Boolean(pick(payload, 2, 10)) });
