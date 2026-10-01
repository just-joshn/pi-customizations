import type { TObject } from 'typebox';

export type CiObservation = { head: string; state: 'pending' | 'success' | 'failure' | 'merged' | 'closed'; summary: string };
export type CiState = { state?: CiObservation['state']; head?: string; error?: string; notified?: string; report?: CiObservation };
export type CiInput = { pr: number; repo?: string; pollSeconds?: number; name?: string; prompt?: string; forge: 'github' | 'origin'; cwd: string; command?: string[] };
export declare const CiToolSchema: TObject;
export declare function parseCi(input: unknown): Required<Pick<CiInput, 'pr' | 'pollSeconds' | 'name' | 'prompt' | 'forge' | 'cwd'>> & CiInput;
export declare function ciLabel(ci: { repo?: string; forge: string; pr: number }): string;
export declare function checkCi(ci: CiInput): Promise<CiObservation>;
export declare function ciObservation(previous: CiState, observed: CiObservation): { ci: CiState; wake?: true };
export declare function wakeText(item: { receipt: { prompt: string; repo?: string; forge: string; pr: number }; ci?: CiState }): string;
