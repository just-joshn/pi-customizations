import { CHART_STATES, type ConfigSection, RERUN_STATES, type Spec } from "../ir.ts";

export function configText(sections: ConfigSection[], extra: string[]) {
  return [...sections.map((s) => `${s.key} ${s.tokens.join(" ")}`), ...extra].join("\n");
}

export const boundRun = (module: string) =>
  [
    `---- MODULE ChartBound ----`,
    `EXTENDS ${module}`,
    `ChartTLC == INSTANCE TLC`,
    `ChartNaturals == INSTANCE Naturals`,
    `ChartBound == ChartNaturals!<(ChartTLC!TLCGet("distinct"), ${RERUN_STATES})`,
    `====`,
  ].join("\n");

export function chartRun({ module, variables, invariants }: Spec, tag: string) {
  const every = invariants.map((name) => `(IF ~${name} THEN {"${name}"} ELSE {}) \\cup `);
  return [
    `---- MODULE ChartRun ----`,
    `EXTENDS ${module}`,
    `ChartTLC == INSTANCE TLC`,
    `ChartNaturals == INSTANCE Naturals`,
    `ChartBudget == ChartNaturals!<=(ChartTLC!TLCGet("distinct"), ${CHART_STATES})`,
    `ChartBroken == ${every.join("")}{}`,
    `ChartMark == ChartBroken = {} \\/ ChartTLC!PrintT(<<"${tag}", <<${variables.join(", ")}>>, ChartBroken>>)`,
    `====`,
  ].join("\n");
}
