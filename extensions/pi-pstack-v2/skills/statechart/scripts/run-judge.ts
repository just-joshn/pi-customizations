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
  verdicts: Map<string, Verdict>;
  runJava: JavaRun;
  config: (name: string, extra: string[]) => string[];
};

type Judging = {
  groups: Rule[][];
  k: number;
  first: FileResult | undefined;
  stop: Stop | undefined;
  states: States;
};

type Verdicts = ReturnType<typeof readVerdict>;

const decide = ({ verdicts }: JudgeContext, rule: Rule, outcome: Outcome, r?: FileResult) =>
  verdicts.set(ruleKey(rule), { rule, outcome, messages: r && messagesOf(r.output) });

const decideAll = (c: JudgeContext, rules: Rule[], outcome: Outcome) => {
  for (const rule of rules) decide(c, rule, outcome);
};

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
  const rest = group.filter((rule) => rule.kind !== "property" && !c.verdicts.has(ruleKey(rule)));
  if (pending.length === 1) {
    decide(c, pending[0][0], "broken", r);
    return j;
  }
  return { ...j, groups: [rest, ...pending, ...j.groups.slice(1)] };
};

const brokenProperty = (c: JudgeContext, j: Judging, o: Outcomes): Judging => {
  if (o.broke?.kind !== "temporal") return splitProperties(c, j, o);
  decideAll(
    c,
    o.group.filter((rule) => rule.kind !== "property"),
    "holds",
  );
  return splitProperties(c, { ...j, states: { ...j.states, complete: true } }, o);
};

const settle = (c: JudgeContext, j: Judging, o: Outcomes): Judging => {
  const { group, r, broke, cut } = o;
  const rule = broke && brokenRule(group, broke);
  if (exitClass(r.status) === 2) return { ...j, stop: stopOf(r) };
  if (rule) {
    decide(c, rule, "broken", r);
    return j;
  }
  if (cut && (r.status === 0 || broke?.kind === "temporal")) {
    decideAll(c, group, "not checked");
    return { ...j, states: { ...j.states, cut: true } };
  }
  if (r.status === 0) {
    decideAll(c, group, "holds");
    return { ...j, states: { ...j.states, complete: true } };
  }
  if (broke && names(group, "property").length) return brokenProperty(c, j, o);
  throw new Error(
    `TLC exited ${r.status} on ${c.specFile}, but its output names no rule that broke:\n${tail(r)}`,
  );
};

const judgeStep = async (c: JudgeContext, j: Judging): Promise<Judging> => {
  const group = j.groups[0].filter((rule) => !c.verdicts.has(ruleKey(rule)));
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

export async function judge(c: JudgeContext) {
  let j: Judging = {
    groups: [c.all],
    k: 1,
    first: undefined,
    stop: undefined,
    states: { distinct: 0, initial: 0, complete: false, cut: false },
  };
  while (j.groups.length && !j.stop) j = await judgeStep(c, j);
  decideAll(
    c,
    c.all.filter((rule) => !c.verdicts.has(ruleKey(rule))),
    "not checked",
  );
  return { first: j.first as FileResult, stop: j.stop, states: j.states };
}
