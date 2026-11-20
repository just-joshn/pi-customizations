export type ClientCall = { readonly options: Record<string, unknown>; readonly params: Record<string, unknown>; readonly signal: unknown };

let calls: readonly ClientCall[] = [];
let events: readonly unknown[] = [];
let options: Record<string, unknown> = {};

export const resetSdk = (): void => {
  calls = [];
  events = [];
};

export const setSdkEvents = (next: readonly unknown[]): void => {
  events = next;
};

export const getSdkEvents = (): readonly unknown[] => events;

export const recordClientOptions = (next: Record<string, unknown>): void => {
  options = next;
};

export const recordCall = (params: Record<string, unknown>, signal: unknown): void => {
  calls = [...calls, { options, params, signal }];
};

export const lastCall = (): ClientCall | undefined => calls.at(-1);
