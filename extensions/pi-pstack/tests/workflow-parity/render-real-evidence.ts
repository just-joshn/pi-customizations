// node tests/workflow-parity/render-real-evidence.ts > docs/real-forge-evidence.md
// Renders the committed real-forge records (tests/workflow-parity/real-forge-evidence/*.json) as the evidence document.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type { RealRecord } from './lib/real-run.ts';

const dir = join(import.meta.dirname, 'real-forge-evidence');
const load = <T>(name: string): T => JSON.parse(readFileSync(join(dir, name), 'utf8')) as T;
const records = ['babysit-drive-real', 'shipping-real', 'opening-a-pr-real'].map((id) => load<RealRecord>(`${id}.json`));
const push = load<Record<string, string>>('container-push.json');
const cell = (text: string): string => text.replace(/\|/g, '\\|').replace(/\n/g, ' ');
const attempts = records.flatMap((record) => record.facts.prs.flatMap((pr) => pr.runs.map((run) => run.attempt))).reduce((sum, n) => sum + n, 0);

const out: string[] = [];
out.push('# Real-forge evidence', '');
out.push(`The PR families run against a real forge: branches and PRs in the throwaway repository ${records[0]?.facts.repo}, a push-triggered GitHub Actions check on every PR, and checkers that read the forge from the GitHub API. The scripted model drives the real \`pi\` binary. Nothing outside that repository was touched, and every run closed its PRs and deleted its branches. This file is generated: \`node --disable-warning=ExperimentalWarning tests/workflow-parity/render-real-evidence.ts > docs/real-forge-evidence.md\`.`, '');
out.push('Re-run with `PSTACK_REAL_FORGE=1 npx vitest run tests/workflow-parity/real-forge.test.ts -t "real forge live"` (set `PSTACK_REAL_FORGE_EVIDENCE_DIR=$PWD/tests/workflow-parity/real-forge-evidence` to replace the committed records), or one family with `node --disable-warning=ExperimentalWarning tests/workflow-parity/run-real-family.ts <family> --record`. The merge gate stays offline: it runs only the replay tests, which re-check the recorded GitHub facts with the same fact checks and the same fact-breaking negative cases.', '');
out.push(`Actions use of the recorded runs: ${attempts} job attempts (one job each, each a few seconds of work, billed as a minute), so at most ${attempts} billed minutes for the three runs.`, '');
for (const record of records) {
  const { facts } = record;
  out.push(`## ${record.family}`, '');
  out.push(`Recorded ${record.recordedAt}. The pi run took ${Math.round(record.piRunMs / 1000)} s. Trunk for the run: \`${facts.trunk}\`. Left on the forge after cleanup: ${record.cleanup.leftoverPrs.length} open PRs, ${record.cleanup.leftoverBranches.length} branches.`, '');
  out.push('| PR | URL | final state | head | check runs |', '| --- | --- | --- | --- | --- |');
  for (const pr of facts.prs) out.push(`| #${pr.number} | ${pr.url} | ${pr.merged ? 'merged' : pr.state} | \`${pr.headSha.slice(0, 8)}\` | ${cell(pr.checks.map((entry) => `${entry.name} ${entry.conclusion}`).join(', '))} |`);
  out.push('', '| Actions run | URL | attempts |', '| --- | --- | --- |');
  for (const pr of facts.prs) for (const run of pr.runs) out.push(`| PR #${pr.number} run ${run.id} | ${run.url} | ${run.attempts.map((attempt) => `${attempt.attempt}: ${attempt.conclusion}`).join(', ')} |`);
  if (facts.watch !== null) out.push('', `The real watch-pr over the final state: exit ${facts.watch.code}, verdicts ${facts.watch.kinds.join(', ')}.`);
  const merged = facts.prs.filter((pr) => pr.merged).map((pr) => `#${pr.number}`);
  out.push('', `Merged from the GitHub API: ${merged.length === 0 ? 'none' : merged.join(', ')}. Armed for auto-merge: ${facts.prs.filter((pr) => pr.autoMerge).map((pr) => `#${pr.number}`).join(', ') || 'none'}.`, '');
  out.push('### Checker table', '', '| verdict | check | evidence |', '| --- | --- | --- |');
  for (const result of record.results) out.push(`| ${result.verdict} | \`${result.id}\` | ${cell(result.evidence).slice(0, 260)} |`);
  out.push('', '### Negative cases', '', '| detected | case | failed checks |', '| --- | --- | --- |');
  for (const negative of record.negatives) out.push(`| ${negative.detected ? 'yes' : 'NO'} | ${cell(negative.name)} | ${cell(negative.failedChecks.join(', '))} |`);
  out.push('');
}
out.push('## Container push to github.com', '');
out.push(`A container worker (default image, \`capabilities.forge\`, token injected through \`PSTACK_CONTAINER_FORGE_TOKEN\`) cloned the private repository, committed, pushed \`${push['ref']}\` over https, and the GitHub API read back commit \`${push['apiSha']}\`, the one the worker made (author ${push['author']}). Test: \`tests/container/real-github.test.ts\`. The branch was deleted afterwards.`, '');
out.push('## What this does not prove', '');
out.push(
  '- The owner stand-in in babysit-drive and the babysitter share one GitHub account, so the API cannot tell their pushes apart by actor. "The babysitter changed no ref" rests on the PR timeline (exactly one force-push, whose SHA the stand-in logged and whose commit author is the stand-in) plus the parent\'s typed commands, which contain no push, rebase or retarget.',
  '- The review thread is posted by the same account, standing in for a review bot. Bugbot itself is not exercised.',
  '- The checks run on `push`, not `pull_request`, because a PR that conflicts with trunk gets no `pull_request` run, and the real watch-pr answers RETRY (`checks-unavailable`) for a PR with no check at all instead of `merge-conflicts`. That is upstream watch-pr behavior the fake forge could not show.',
  '- Merges land in a per-run trunk branch (`pf/<stamp>/shipping/trunk`), not in the sandbox repository\'s `main`, so a run leaves `main` untouched. GitHub\'s merge and `--match-head-commit` are real.',
  '- shipping-freshness (a chain rebase), shipping blocked by a missing engine or token, the merge queue, the Origin CLI and autopilot are not run against the real forge.',
  '- The verifier\'s identity on the PR is the shared account. Its distinctness from the PR owner is the worker id in the verdict and the commit author, not a second GitHub login.',
  '',
);
process.stdout.write(`${out.join('\n')}\n`);
