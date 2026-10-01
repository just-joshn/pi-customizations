import type { TUnsafe } from 'typebox';
export type RoutineInput = { name: string; prompt: string; fields: string[]; port?: number };
export type RoutineDefinition = RoutineInput & { port: number; trigger: { type: 'webhook' }; revision: string };
export const RoutineSchema: TUnsafe<RoutineInput>;
export function parseRoutine(input: unknown): RoutineDefinition;
export function webhookBody(body: string, fields: readonly string[]): Record<string, unknown>;
