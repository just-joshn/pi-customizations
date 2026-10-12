import type { ExtensionContext } from '@earendil-works/pi-coding-agent';

/** Print and JSON runs, including every subagent, exit once the agent settles. */
export const isOneShot = (mode: ExtensionContext['mode']): boolean => mode === 'print' || mode === 'json';
