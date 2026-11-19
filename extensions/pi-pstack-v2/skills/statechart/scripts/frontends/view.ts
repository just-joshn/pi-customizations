import { type CheckedView, checked, list, type Value, type Vars } from "../ir.ts";

type Json = boolean | number | string | Json[] | { [key: string]: Json };

const project = (v: Exclude<Extract<Value, object>, { kind: "model" }>): Json => {
  if (v.kind === "interval")
    return Array.from({ length: Math.max(v.hi - v.lo + 1, 0) }, (_, k) => v.lo + k);
  if (v.kind === "set") return v.members.map(json);
  return Object.fromEntries(
    v.keys.map((key, i): [string, Json] => {
      const k = json(key);
      return [typeof k === "object" ? JSON.stringify(k) : String(k), json(v.values[i])];
    }),
  );
};

export const json = (v: Value): Json => {
  if (typeof v !== "object") return v;
  if (v.kind === "model") return v.name;
  return project(v);
};

const jsonVars = (vars: Vars) =>
  Object.fromEntries(Object.entries(vars).map(([name, v]): [string, Json] => [name, json(v)]));

const THEME_COLORS = ["blue", "orange", "purple", "yellow", "teal", "tan", "pink"];

const isFunction = (v: unknown): v is (...args: unknown[]) => unknown => typeof v === "function";

const isPlainObject = (v: unknown): v is { [key: string]: unknown } => {
  if (typeof v !== "object" || v === null) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
};

const isString = (v: unknown) => typeof v === "string";

const VIEW_EXPORTS = ["state", "step", "group", "colors", "title"];

type Inspect = (value: unknown, options: { breakLength: number }) => string;

const literalOf = (inspect: Inspect) => (v: unknown) =>
  typeof v === "string" ? JSON.stringify(v) : inspect(v, { breakLength: Infinity });

type Pick<T> = { value: T | undefined; wrong: string[] };

const pick = <T>(
  view: { readonly [name: string]: unknown },
  name: string,
  kind: string,
  fits: (v: unknown) => v is T,
): Pick<T> => {
  const v = view[name];
  if (v === undefined || fits(v)) return { value: v, wrong: [] };
  return { value: undefined, wrong: [`${name} must be ${kind}`] };
};

/** Reads each exported field, collecting a complaint for every one of the wrong kind. */
const pickFields = (view: { readonly [name: string]: unknown }) => {
  const state = pick(view, "state", "a function", isFunction);
  const step = pick(view, "step", "a function", isFunction);
  const group = pick(view, "group", "a function", isFunction);
  const exported = pick(view, "colors", "a plain object", isPlainObject);
  const title = pick(view, "title", "a string", isString);
  const wrong = [state, step, group, exported, title].flatMap((p) => p.wrong);
  if (wrong.length) throw new Error(`The view's ${list(wrong)}.`);
  return {
    state: state.value,
    step: step.value,
    group: group.value,
    exported: exported.value,
    title: title.value,
  };
};

const readColors = (
  exported: { [key: string]: unknown } | undefined,
  literal: (v: unknown) => string,
) => {
  const entries = Object.entries(exported ?? {});
  const isColor = ([, color]: [string, unknown]) =>
    typeof color === "string" && THEME_COLORS.includes(color);
  const bad = entries
    .filter((e) => !isColor(e))
    .map(([name, color]) => `${JSON.stringify(name)} the color ${literal(color)}`);
  if (bad.length)
    throw new Error(
      `The view's colors give ${list(bad)}. Give each group ${list(THEME_COLORS, "or")}.`,
    );
  return {
    __proto__: null,
    ...Object.fromEntries(entries.filter(isColor).map(([name, color]) => [name, String(color)])),
  } as unknown as { [group: string]: string };
};

const assertColored = (g: unknown, colors: object, literal: (v: unknown) => string) => {
  if (g !== undefined && !Object.hasOwn(colors, typeof g === "symbol" ? g : String(g)))
    throw new Error(
      `The view's group() returned ${literal(g)}, which colors does not name. Give each group a color in colors.`,
    );
  return g;
};

export function checkView(
  view: { readonly [name: string]: unknown },
  inspect: Inspect,
): CheckedView {
  const literal = literalOf(inspect);
  const extra = Object.keys(view).filter((name) => !VIEW_EXPORTS.includes(name));
  if (extra.length)
    throw new Error(
      `The view exports ${list(extra)}, which the command does not read. Export only ${list(VIEW_EXPORTS)}.`,
    );
  const { state, step, group, exported, title } = pickFields(view);
  if (group !== undefined && exported === undefined)
    throw new Error("The view exports group() but no colors. Give each group a color in colors.");
  const colors = readColors(exported, literal);
  const named = group && ((vars: Vars) => assertColored(group(jsonVars(vars)), colors, literal));
  return {
    state: state && ((vars: Vars) => state(jsonVars(vars))),
    step:
      step &&
      ((action: string, from: Vars, to: Vars) => step(action, jsonVars(from), jsonVars(to))),
    group: named,
    colors,
    title,
    [checked]: true,
  };
}
