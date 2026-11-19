import { type Rule, RERUN_STATES, ruleKey, type Outcome, type Stop, type Verdict } from "./ir.ts";
import { type Break, readVerdict } from "./frontends/verdict.ts";
import { type FileResult, messagesOf } from "./run-io.ts";
import { brokenRule, exitClass, names, PINNED_FLAGS, stopOf, tail } from "./run-tlc.ts";

export type States = { distinct: number; initial: number; complete: boolean; cut: boolean };

export type JavaRun = (name: string, main: string, args: string[]) => Promise<FileResult>;

export type JudgeContext = {
  specFile: string;
  module: string;
  all: Rule[];
  runJava: JavaRun;
  config: (name: string, extra: string[]) => string[];
};

type Judging = {
  groups: Rule[][];
  k: number;
  first: FileResult | undefined;
  stop: Stop | undefined;
  states: States;
  verdicts: ReadonlyMap<string, Verdict>;
};

type Verdicts = ReturnType<typeof readVerdict>;

const decide = (j: Judging, rules: Rule[], outcome: Outcome, r?: FileResult): Judging => ({
  ...j,
  verdicts: new Map([
    ...j.verdicts,
    ...rules.map((rule) => {
      const verdict: Verdict = { rule, outcome, messages: r && messagesOf(r.output) };
      return [ruleKey(rule), verdict] as const;
    }),
  ]),
});

const sectionsFor = (group: Rule[], bounded: boolean) => {
  const invariants = names(group, "invariant");
  const properties = names(group, "property");
  return [
    ...(invariants.length ? [`INVARIANT ${invariants.join(" ")}`] : []),
    ...(properties.length ? [`PROPERTY ${properties.join(" ")}`] : []),
    ...(bounded ? ["CONSTRAINT ChartBound"] : []),
  ];
};

const runGroup = (c: JudgeContext, j: Judging, group: Rule[], bounded: boolean) => {
  const name = `verdict-${j.k}`;
  return c.runJava(name, "tlc2.TLC", [
    "-tool",
    ...PINNED_FLAGS,
    ...(names(group, "deadlock").length ? [] : ["-deadlock"]),
    ...c.config(name, sectionsFor(group, bounded)),
    bounded ? "ChartBound" : c.module,
  ]);
};

type Outcomes = { group: Rule[]; r: FileResult; broke: Break | undefined; cut: boolean };

const splitProperties = (c: JudgeContext, j: Judging, { group, r }: Outcomes): Judging => {
  const pending = group.filter((rule) => rule.kind === "property").map((rule) => [rule]);
  const rest = group.filter((rule) => rule.kind !== "property" && !j.verdicts.has(ruleKey(rule)));
  if (pending.length === 1) return decide(j, pending[0], "broken", r);
  return { ...j, groups: [rest, ...pending, ...j.groups.slice(1)] };
};

const brokenProperty = (c: JudgeContext, j: Judging, o: Outcomes): Judging => {
  if (o.broke?.kind !== "temporal") return splitProperties(c, j, o);
  const holding = decide(
    j,
    o.group.filter((rule) => rule.kind !== "property"),
    "holds",
  );
  return splitProperties(c, { ...holding, states: { ...j.states, complete: true } }, o);
};

const settle = (c: JudgeContext, j: Judging, o: Outcomes): Judging => {
  const { group, r, broke, cut } = o;
  const rule = broke && brokenRule(group, broke);
  if (exitClass(r.status) === 2) return { ...j, stop: stopOf(r) };
  if (rule) return decide(j, [rule], "broken", r);
  if (cut && (r.status === 0 || broke?.kind === "temporal"))
    return { ...decide(j, group, "not checked"), states: { ...j.states, cut: true } };
  if (r.status === 0)
    return { ...decide(j, group, "holds"), states: { ...j.states, complete: true } };
  if (broke && names(group, "property").length) return brokenProperty(c, j, o);
  throw new Error(
    `TLC exited ${r.status} on ${c.specFile}, but its output names no rule that broke:\n${tail(r)}`,
  );
};

const judgeStep = async (c: JudgeContext, j: Judging): Promise<Judging> => {
  const group = j.groups[0].filter((rule) => !j.verdicts.has(ruleKey(rule)));
  if (j.first && !group.length) return { ...j, groups: j.groups.slice(1) };
  const bounded = j.first !== undefined && !j.states.complete;
  const r = await runGroup(c, j, group, bounded);
  const read: Verdicts = readVerdict(messagesOf(r.output));
  const seen: Judging = {
    ...j,
    k: j.k + 1,
    first: j.first ?? r,
    states: {
      ...j.states,
      distinct: Math.max(j.states.distinct, read.distinct),
      initial: Math.max(j.states.initial, read.initial),
    },
  };
  const cut = bounded && read.distinct >= RERUN_STATES;
  return settle(c, seen, { group, r, broke: read.broke, cut });
};

const judgeUntilDone = async (c: JudgeContext, j: Judging): Promise<Judging> =>
  j.groups.length && !j.stop ? judgeUntilDone(c, await judgeStep(c, j)) : j;

export async function judge(c: JudgeContext) {
  const start: Judging = {
    groups: [c.all],
    k: 1,
    first: undefined,
    stop: undefined,
    states: { distinct: 0, initial: 0, complete: false, cut: false },
    verdicts: new Map(),
  };
  const j = await judgeUntilDone(c, start);
  const left = c.all.filter((rule) => !j.verdicts.has(ruleKey(rule)));
  const { verdicts } = decide(j, left, "not checked");
  return { first: j.first as FileResult, stop: j.stop, states: j.states, verdicts };
}
