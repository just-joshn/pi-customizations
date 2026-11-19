import type { Message, Part } from "../ir.ts";
import { linesOf, parseState } from "./dot.ts";

const START = /@!@!@STARTMSG (\d+):(\d+) @!@!@$/;
const END = /^@!@!@ENDMSG \d+ @!@!@$/;

const isCutMarker = (lastLine: string) => lastLine.startsWith("@!@!@");

// Drops the empty tail of the open chain, then returns the outermost message if it has a body.
function cutMessage(open: Message[]) {
  const stop = Math.max(
    open.findLastIndex((m, i) => i === 0 || m.body.length - (i < open.length - 1 ? 1 : 0) > 0),
    0,
  );
  const trimmed = open.slice(0, stop + 1).reduceRight<Message | undefined>((child, m, i) => {
    if (i === stop) return open.length - 1 > stop ? { ...m, body: m.body.slice(0, -1) } : m;
    return child && { ...m, body: [...m.body.slice(0, -1), child] };
  }, undefined);
  return trimmed?.body.length ? trimmed : undefined;
}

type Body = { part: Part; before: Body } | undefined;

type Frame = { header: Omit<Message, "body">; body: Body };

function* walkBody(body: Body) {
  for (let cell = body; cell; cell = cell.before) yield cell.part;
}

const bodyOf = (body: Body): Part[] => Array.from(walkBody(body)).toReversed();

const openFrame = (start: RegExpExecArray, line: string): Frame => ({
  header: {
    code: Number(start[1]),
    level: Number(start[2]),
    ...(start.index ? { beforeMarker: line.slice(0, start.index) } : {}),
  },
  body: undefined,
});

const messageOf = ({ header, body }: Frame): Message => ({ ...header, body: bodyOf(body) });

const withPart = (frame: Frame, part: Part): Frame => ({
  ...frame,
  body: { part, before: frame.body },
});

// Rebuilds the open chain as messages, each holding the one open inside it as its last part.
const openChain = (open: Frame[]) =>
  open.reduceRight<Message[]>((inner, frame) => {
    const child = inner.slice(0, 1);
    return [{ ...frame.header, body: [...bodyOf(frame.body), ...child] }, ...inner];
  }, []);

const closeFrame = (open: Frame[]) => {
  const done = messageOf(open[open.length - 1]);
  const parents = open.slice(0, -1);
  const parent = parents.at(-1);
  return {
    done,
    open: parent ? [...parents.slice(0, -1), withPart(parent, done)] : parents,
  };
};

const addLine = (open: Frame[], part: Part) => [
  ...open.slice(0, -1),
  withPart(open[open.length - 1], part),
];

export function* readMessages(tlcOut: string | Iterable<string>): Generator<Part> {
  const lines = linesOf(tlcOut)[Symbol.iterator]();
  let open: Frame[] = [];
  try {
    for (let next = lines.next(); !next.done;) {
      const line = next.value;
      next = lines.next();
      if (next.done && (!line || isCutMarker(line))) break;
      const start = START.exec(line);
      if (start) {
        open = [...open, openFrame(start, line)];
      } else if (END.test(line)) {
        if (!open.length) continue;
        const closed = closeFrame(open);
        open = closed.open;
        if (!open.length) yield closed.done;
      } else if (open.length) open = addLine(open, line);
      else yield line;
    }
  } finally {
    lines.return?.();
  }
  const cut = cutMessage(openChain(open));
  if (cut) yield cut;
}

export const textOf = ({ body }: Message) =>
  body.filter((part) => typeof part === "string").join("\n");

export const actionOf = (m: Message) => /^\d+: (?:Back to state: )?<([^\s>]+)/.exec(textOf(m))?.[1];

export const messageState = (m: Message) => {
  const lines = textOf(m).split("\n");
  const end = lines.findIndex((l, i) => i > 0 && !l.trim());
  return parseState(lines.slice(1, end === -1 ? lines.length : end).join("\n"));
};
