import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { childIdentity } from './child-env.ts';

/** Print and JSON runs exit once the agent settles, and so does every subagent, an RPC child that its owner closes then. */
export const isOneShot = (mode: ExtensionContext['mode']): boolean => mode === 'print' || mode === 'json' || childIdentity.depth > 0;

/** Whether a user can answer a dialog. A subagent's owner dismisses every dialog, so a subagent has nobody to ask. */
export const canAsk = (ctx: Pick<ExtensionContext, 'hasUI'>): boolean => ctx.hasUI && childIdentity.depth === 0;
