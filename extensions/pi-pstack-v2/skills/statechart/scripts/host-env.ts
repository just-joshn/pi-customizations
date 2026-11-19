import { z } from "zod";

const optional = z.string().optional();

const HostEnv = z.object({ TLA2TOOLS: optional, JAVA: optional }).catchall(optional);

/** A copy of the process environment, validated as string variables that may be unset. */
export const hostEnv = (): NodeJS.ProcessEnv => HostEnv.parse(process.env);
