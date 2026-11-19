import { type Graph, type State, type Step, type Value, type Vars } from "../ir.ts";
import { parseValue } from "./value.ts";

const unescapeDot = (s: string) => {
  let i = s.indexOf("\\");
  if (i === -1) return s;
  let out = "";
  let from = 0;
  for (; i !== -1 && i + 1 < s.length; i = s.indexOf("\\", i)) {
    const c = s[i + 1];
    if (c === "\n" || c === "\r" || c === "\u2028" || c === "\u2029") {
      i++;
      continue;
    }
    out += s.slice(from, i) + (c === "n" ? "\n" : c);
    i += 2;
    from = i;
  }
  return out + s.slice(from);
};

const readPair = (part: string): [string, Value] => {
  const [, name, value] = /^(\w+)\s*=\s*([\s\S]*)$/.exec(part) ?? [];
  if (!name) throw new Error(`cannot read the TLC state line "${part}"`);
  return [name, parseValue(value)];
};

const CONJUNCT = "/\\ ";

export const parseState = (label: string): Vars =>
  Object.fromEntries(
    (label.startsWith(CONJUNCT) ? label.slice(CONJUNCT.length) : label)
      .split(`\n${CONJUNCT}`)
      .map(readPair),
  );

// A fresh string that shares no storage with the (possibly huge) line it was sliced from.
const unshared = (s: string) => Array.from(s).join("");

export type Lines = string | Iterable<string>;

export const linesOf = (input: Lines) => (typeof input === "string" ? input.split("\n") : input);

type DotItem =
  | { edge: [string, Step] }
  | { node: [string, State] };

const EDGE = /^(-?\d+) -> (-?\d+) \[label="([^"]*)"/;
const NODE = /^(-?\d+) \[label="((?:[^"\\]|\\.)*)"(,style = filled)?/;

const edgeItem = (edge: RegExpExecArray): DotItem => {
  const [from, to, action] = edge.slice(1).map(unshared);
  return { edge: [`${from} ${to} ${action}`, { from, to, action }] };
};

const nodeItem = (node: RegExpExecArray): DotItem => {
  const vars = parseState(unescapeDot(unshared(node[2])));
  return { node: [unshared(node[1]), { vars, start: !!node[3], breaks: [] }] };
};

function* dotItems(input: Lines): Generator<DotItem> {
  for (const line of linesOf(input)) {
    const edge = EDGE.exec(line);
    const node = edge ? null : NODE.exec(line);
    if (edge) yield edgeItem(edge);
    else if (node) yield nodeItem(node);
  }
}

export function parseDot(input: Lines): Graph {
  const items = [...dotItems(input)];
  const states = new Map<string, State>(items.flatMap((item) => ("node" in item ? [item.node] : [])));
  const steps = new Map<string, Step>(items.flatMap((item) => ("edge" in item ? [item.edge] : [])));
  for (const loose of steps.values())
    if (!states.has(loose.from) || !states.has(loose.to))
      throw new Error(
        `The TLC graph dump has a step ${loose.action} to or from a state that it does not list.`,
      );
  return { states, steps: [...steps.values()] };
}
