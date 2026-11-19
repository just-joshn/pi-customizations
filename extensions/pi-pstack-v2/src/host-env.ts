import { z } from 'zod';

const ProcessEnvSchema = z.object({}).catchall(z.string().optional());

/** The process environment, validated as string variables that may be unset. */
export const hostEnv = (): NodeJS.ProcessEnv => ProcessEnvSchema.parse(process.env);
