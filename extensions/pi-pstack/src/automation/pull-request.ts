// A fix turn's result becomes a pull request here, and only here. The worker commits on its run branch and describes the
// pull request; the parent checks that the commits and the patched-build proof exist, then pushes the branch and opens the
// draft pull request (forge.ts). The status the operations message shows is what the parent established, never what the
// worker claimed: `Draft pull request opened` only once a pull request on the run branch is verified to be a draft.
import type { AutomationConfig } from '../../adapters/automation-events.ts';
import type { Forge } from './forge.ts';
import { actionIdFor, type EventKey, type RunId, untrustedText } from './model.ts';
import type { Verdict } from './proof.ts';
import type { TurnResult } from './repro-turns.ts';

const MAX_TITLE = 200;
const MAX_BODY = 20_000;

export const fixFailed = (reason: string): TurnResult => ({ corrected: false, status: 'Fix did not land', operations: `The fix did not land: ${reason}. No pull request was opened.` });

export interface LandHost {
  config: AutomationConfig;
  forge: Forge;
  /** The worker's record shows the patched build measured twice since `since`. */
  provePatched: (runId: RunId, since: Date) => Verdict;
}

/**
 * The outcome of a fix turn. Throws on a forge or git failure that a later pass may get past, so the caller retries; every
 * step reads current state first (the run branch's commits, the pull requests on it), so a retry after a crash adopts
 * what the failed attempt left.
 */
export async function landFix(host: LandHost, fix: { key: EventKey; runId: RunId; since: Date; projectRoot: string }, reported: TurnResult): Promise<TurnResult> {
  if (reported.status === 'Fix did not land') return reported;
  const title = untrustedText(reported.pullRequest?.title ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_TITLE);
  const body = untrustedText(reported.pullRequest?.body ?? '').trim().slice(0, MAX_BODY);
  if (host.forge.target === undefined) return fixFailed('repository.url is not a github.com repository, so the parent cannot open a draft pull request');
  const state = await host.forge.state(fix.projectRoot, fix.runId);
  if (state.ahead === 0) return fixFailed('the worker made no commit on its run branch');
  const proven = host.provePatched(fix.runId, fix.since);
  if (!proven.ok) return fixFailed(`there is no proof that the patched build was run twice (${proven.reason})`);
  const existing = (await host.forge.pullRequests(fix.runId)).some((pr) => pr.state === 'OPEN');
  if (!existing && (title === '' || body === '')) return fixFailed('the worker described no pull request (a title and a body)');
  const { pr, converted } = await host.forge.openDraft({ projectRoot: fix.projectRoot, runId: fix.runId, actionId: actionIdFor(host.config.name, fix.key, 'pull-request'), title, body });
  return { corrected: false, status: 'Draft pull request opened', operations: `Draft pull request: ${pr.url}${converted ? '\nThe worker had already opened it as ready for review, so the parent converted it to a draft.' : ''}` };
}
