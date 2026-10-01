import type { Static, TBoolean, TInteger, TObject, TOptional, TString } from 'typebox';

export declare const TimerSchema: TObject<{
  name: TString;
  prompt: TString;
  delaySeconds: TOptional<TInteger>;
  cron: TOptional<TString>;
  timezone: TOptional<TString>;
  runImmediately: TOptional<TBoolean>;
}>;
export type TimerInput = Static<typeof TimerSchema>;
export declare function parseTimer(input: unknown): TimerInput;
export declare function nextOccurrence(timer: TimerInput, after: number): number;
