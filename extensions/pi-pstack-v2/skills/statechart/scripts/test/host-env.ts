import { z } from "zod";

const optional = z.string().optional();

const hostEnvSchema = z.looseObject({
  TLA2TOOLS: optional,
  JAVA: optional,
  STATECHART_JAVA: optional,
  STATECHART_UPDATE: optional,
  STATECHART_DIFFERENTIAL_SEED: optional,
  STATECHART_DIFFERENTIAL_RUNS: optional,
  XDG_CACHE_HOME: optional,
  STATECHART_RECORD: optional,
  STATECHART_REPLAY: optional,
  STATECHART_LOG: optional,
  STATECHART_PLAIN: optional,
});

// A fresh copy of the environment this process runs in. Unlisted variables pass through,
// so a child process that spreads it inherits exactly what process.env held.
export const hostEnv = () => hostEnvSchema.parse(process.env);
