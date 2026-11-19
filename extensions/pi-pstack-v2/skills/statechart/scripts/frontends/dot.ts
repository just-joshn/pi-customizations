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

const readPair = (part: string, parsed: Map<string, [string, Value]>) => {
  const known = parsed.get(part);
  if (known) return known;
  const [, name, value] = /^(\w+)\s*=\s*([\s\S]*)$/.exec(part) ?? [];
  if (!name) throw new Error(`cannot read the TLC state line "${part}"`);
  const pair: [string, Value] = [name, parseValue(value)];
  parsed.set(part, pair);
  return pair;
};

export const parseState = (label: string, parsed = new Map<string, [string, Value]>()): Vars =>
  Object.fromEntries(
    (label.startsWith("/\\ ") ? label.slice(3) : label)
      .split("\n/\\ ")
      .map((part) => readPair(part, parsed)),
  );

// A fresh string that shares no storage with the (possibly huge) line it was sliced from.
const unshared = (s: string) => Array.from(s).join("");

export type Lines = string | Iterable<string>;

export const linesOf = (input: Lines) => (typeof input === "string" ? input.split("\n") : input);

export function parseDot(input: Lines): Graph {
  const states = new Map<string, State>();
  const steps = new Map<string, Step>();
  const parsed = new Map<string, [string, Value]>();
  const owned = new Map<string, string>();
  const own = (s: string) => {
    let copy = owned.get(s);
    if (copy === undefined) owned.set((copy = unshared(s)), copy);
    return copy;
  };
  for (const line of linesOf(input)) {
    const edge = /^(-?\d+) -> (-?\d+) \[label="([^"]*)"/.exec(line);
    if (edge) {
      steps.set(edge.slice(1).join(" "), {
        from: own(edge[1]),
        to: own(edge[2]),
        action: own(edge[3]),
      });
      continue;
    }
    const node = /^(-?\d+) \[label="((?:[^"\\]|\\.)*)"(,style = filled)?/.exec(line);
    if (node)
      states.set(own(node[1]), {
        vars: parseState(unescapeDot(node[2]), parsed),
        start: !!node[3],
        breaks: [],
      });
  }
  for (const loose of steps.values())
    if (!states.has(loose.from) || !states.has(loose.to))
      throw new Error(
        `The TLC graph dump has a step ${loose.action} to or from a state that it does not list.`,
      );
  return { states, steps: [...steps.values()] };
}
