# Real-forge evidence

The PR families run against a real forge: branches and PRs in the throwaway repository just-joshn/pstack-parity-sandbox, a push-triggered GitHub Actions check on every PR, and checkers that read the forge from the GitHub API. The scripted model drives the real `pi` binary. Nothing outside that repository was touched, and every run closed its PRs and deleted its branches. This file is generated: `node --disable-warning=ExperimentalWarning tests/workflow-parity/render-real-evidence.ts > docs/real-forge-evidence.md`.

Re-run with `PSTACK_REAL_FORGE=1 npx vitest run tests/workflow-parity/real-forge.test.ts -t "real forge live"` (set `PSTACK_REAL_FORGE_EVIDENCE_DIR=$PWD/tests/workflow-parity/real-forge-evidence` to replace the committed records), or one family with `node --disable-warning=ExperimentalWarning tests/workflow-parity/run-real-family.ts <family> --record`. The merge gate stays offline: it runs only the replay tests, which re-check the recorded GitHub facts with the same fact checks and the same fact-breaking negative cases.

Actions use of the recorded runs: 8 job attempts (one job each, each a few seconds of work, billed as a minute), so at most 8 billed minutes for the three runs.

## babysit-drive-real

Recorded 2026-11-12T12:25:58.777Z. The pi run took 117 s. Trunk for the run: `pf/mwdirr4d/babysit-drive/trunk`. Left on the forge after cleanup: 0 open PRs, 0 branches.

| PR | URL | final state | head | check runs |
| --- | --- | --- | --- | --- |
| #14 | https://github.com/just-joshn/pstack-parity-sandbox/pull/14 | open | `7ac2b2bb` | build success |

| Actions run | URL | attempts |
| --- | --- | --- |
| PR #14 run 43217569107 | https://github.com/just-joshn/pstack-parity-sandbox/actions/runs/43217569107 | 1: failure, 2: success |
| PR #14 run 43217521291 | https://github.com/just-joshn/pstack-parity-sandbox/actions/runs/43217521291 | 1: failure |

The real watch-pr over the final state: exit 0, verdicts READY, single, passed, allowed.

Merged from the GitHub API: none. Armed for auto-merge: none.

### Checker table

| verdict | check | evidence |
| --- | --- | --- |
| PASS | `slash.poteto-mode` | first user message routes to generated/skills/poteto-mode/SKILL.md |
| PASS | `reads.babysit.poteto-mode-and-playbook` | poteto-mode and the playbook were opened |
| PASS | `todo.babysit.run-from-playbook` | run babysit-drive-real: playbook=babysit revision=a5539b15a3d5 |
| PASS | `todo.babysit.steps-verbatim-in-order` | 9 steps match the playbook text in order |
| PASS | `todo.babysit.initial-states-open` | 9 steps open in the first snapshot |
| PASS | `todo.babysit.every-step-resolved` | 9 steps, all resolved |
| PASS | `todo.babysit.done-steps-proven` | 9 done steps, every cited receipt re-verifies |
| PASS | `todo.babysit.skips-explained` | skips: none |
| PASS | `todo.babysit.resolved-in-order` | resolution order over 12 snapshots follows the source order |
| PASS | `todo.babysit.parent-sole-writer` | 4 workers, none touched TODO.md |
| PASS | `real.babysit.mode-declared-from-the-request` | request routes to drive; TODO.md declares drive at 10, before the first poll at 14 |
| PASS | `real.babysit.forge-resolved-once-gh-fallback-recorded` | resolved once at 12 before the first forge call at 22; recorded gh |
| PASS | `real.babysit.watchers-are-watch-pr-workers-on-the-real-pr` | 4 watchers, each watch-pr on just-joshn/pstack-parity-sandbox PR 14 |
| PASS | `real.babysit.verdicts-arrive-conflicts-then-threads-then-ci` | watch-pr exits 2, 3, 4, 0 |
| PASS | `real.babysit.one-watcher-live-at-a-time-and-the-parent-ran-no-poll-loop` | 4 watchers, strictly sequential, the last ended READY, no sleep loop but the owner wait |
| PASS | `real.babysit.parent-typed-no-topology-change` | no mutating git or retarget command typed |
| PASS | `real.babysit.fresh-build-came-after-the-log-and-the-base-check-and-was-whole-run` | log read at 86 and base checked at 88, then one whole-run rerun at 90 |
| PASS | `real.babysit.review-text-is-data-and-triage-is-grounded` | code lookup 14 before the reply 15; no comment text in a command; decision row dismiss the duplicate-clamp thread |
| PASS | `real.babysit.parent-typed-no-merge` | no merge command typed |
| PASS | `real.babysit.reply-is-merge-ready-not-merged` | merge-ready, not merged, Shipping |
| PASS | `real.babysit.no-tool-errors` | 64 tool calls, none failed |
| PASS | `real.babysit.the-conflict-was-real-and-reported-before-anything-else` | mergeable_state was dirty at the start; report 2026-11-12T12:24:11Z, owner force-push 2026-11-12T12:24:15Z, reply 2026-11-12T12:24:28Z, fresh build 2026-11-12T12:24:38Z |
| PASS | `real.babysit.the-owner-rebased-and-the-babysitter-changed-no-ref` | one force-push, the owner's (7ac2b2bb, author owner-12); base pf/mwdirr4d/babysit-drive/trunk unchanged; trunk tip is the conflicting commit |
| PASS | `real.babysit.the-review-thread-was-triaged-on-the-pr` | 1 thread on src/cart.js, 2 comments, reply cites src/cart.js, resolved |
| PASS | `real.babysit.a-flake-got-exactly-one-fresh-build-from-a-real-failure` | run 43217569107: attempt 1 failure, attempt 2 success; 1 run at the head |
| PASS | `real.babysit.the-pr-is-merge-ready-on-github` | open, clean, 1 check(s) success, threads resolved; watch-pr exit 0 READY, single, passed, allowed |
| PASS | `real.babysit.never-merges-because-checks-are-green` | 1 PR(s) open, none merged or armed; trunk at its base |

### Negative cases

| detected | case | failed checks |
| --- | --- | --- |
| yes | a step was left open | todo.babysit.every-step-resolved |
| yes | a step is done with no receipt id | todo.babysit.done-steps-proven |
| yes | a step cites a receipt that was never recorded | todo.babysit.done-steps-proven |
| yes | the artifact changed after the receipt hashed it | todo.babysit.done-steps-proven |
| yes | a step was skipped with no reason | todo.babysit.skips-explained |
| yes | steps were resolved out of order | todo.babysit.resolved-in-order |
| yes | a playbook step was deleted from TODO.md | todo.babysit.steps-verbatim-in-order |
| yes | the babysitter merged because every check was green | real.babysit.the-pr-is-merge-ready-on-github, real.babysit.never-merges-because-checks-are-green |
| yes | the babysitter armed auto-merge | real.babysit.never-merges-because-checks-are-green |
| yes | the babysitter force-pushed the branch as well | real.babysit.the-owner-rebased-and-the-babysitter-changed-no-ref |
| yes | the babysitter retargeted the PR | real.babysit.the-owner-rebased-and-the-babysitter-changed-no-ref |
| yes | a second fresh build was requested | real.babysit.a-flake-got-exactly-one-fresh-build-from-a-real-failure |
| yes | the check never failed, so there was nothing to rerun | real.babysit.a-flake-got-exactly-one-fresh-build-from-a-real-failure |
| yes | the thread was left unresolved | real.babysit.the-review-thread-was-triaged-on-the-pr, real.babysit.the-pr-is-merge-ready-on-github |
| yes | the reply never cited the code | real.babysit.the-conflict-was-real-and-reported-before-anything-else, real.babysit.the-review-thread-was-triaged-on-the-pr |
| yes | a check is still red at the end | real.babysit.the-pr-is-merge-ready-on-github |
| yes | the real watch-pr did not answer READY | real.babysit.the-pr-is-merge-ready-on-github |
| yes | the conflict was never reported to the owner | real.babysit.the-conflict-was-real-and-reported-before-anything-else |
| yes | the PR never conflicted | real.babysit.the-conflict-was-real-and-reported-before-anything-else |
| yes | someone else pushed after the owner | real.babysit.the-owner-rebased-and-the-babysitter-changed-no-ref, real.babysit.a-flake-got-exactly-one-fresh-build-from-a-real-failure |
| yes | the babysitter rebased in the checkout | real.babysit.parent-typed-no-topology-change |
| yes | the babysitter typed a merge | real.babysit.parent-typed-no-merge |
| yes | the parent polled with its own sleep loop | real.babysit.one-watcher-live-at-a-time-and-the-parent-ran-no-poll-loop |
| yes | comment text was interpolated into a shell command | real.babysit.review-text-is-data-and-triage-is-grounded |
| yes | the forge was never resolved before the first call | real.babysit.forge-resolved-once-gh-fallback-recorded |
| yes | the reply claims a merge | real.babysit.reply-is-merge-ready-not-merged |

## shipping-real

Recorded 2026-11-12T12:26:53.304Z. The pi run took 35 s. Trunk for the run: `pf/mwdirr4g/shipping/trunk`. Left on the forge after cleanup: 0 open PRs, 0 branches.

| PR | URL | final state | head | check runs |
| --- | --- | --- | --- | --- |
| #15 | https://github.com/just-joshn/pstack-parity-sandbox/pull/15 | merged | `95b709e3` | build success |
| #16 | https://github.com/just-joshn/pstack-parity-sandbox/pull/16 | open | `219defbc` | build success |
| #17 | https://github.com/just-joshn/pstack-parity-sandbox/pull/17 | open | `9c670c9e` | build success |

| Actions run | URL | attempts |
| --- | --- | --- |
| PR #15 run 43217855611 | https://github.com/just-joshn/pstack-parity-sandbox/actions/runs/43217855611 | 1: success |
| PR #16 run 43217857799 | https://github.com/just-joshn/pstack-parity-sandbox/actions/runs/43217857799 | 1: success |
| PR #17 run 43217864021 | https://github.com/just-joshn/pstack-parity-sandbox/actions/runs/43217864021 | 1: success |

Merged from the GitHub API: #15. Armed for auto-merge: none.

### Checker table

| verdict | check | evidence |
| --- | --- | --- |
| PASS | `slash.poteto-mode` | first user message routes to generated/skills/poteto-mode/SKILL.md |
| PASS | `reads.shipping.poteto-mode-and-playbook` | poteto-mode and the playbook were opened |
| PASS | `reads.shipping.named-skills` | parent opened control-ui, control-cli |
| PASS | `todo.shipping.run-from-playbook` | run ship-stack-real: playbook=shipping revision=a5539b15a3d5 |
| PASS | `todo.shipping.steps-verbatim-in-order` | 6 steps match the playbook text in order |
| PASS | `todo.shipping.initial-states-open` | 6 steps open in the first snapshot |
| PASS | `todo.shipping.every-step-resolved` | 6 steps, all resolved |
| PASS | `todo.shipping.done-steps-proven` | 6 done steps, every cited receipt re-verifies |
| PASS | `todo.shipping.skips-explained` | skips: none |
| PASS | `todo.shipping.resolved-in-order` | resolution order over 8 snapshots follows the source order |
| PASS | `todo.shipping.parent-sole-writer` | 4 workers, none touched TODO.md |
| PASS | `real.ship.forge-resolved-once-gh-fallback-recorded` | resolved once at 12 before the first forge call at 16; recorded gh |
| PASS | `real.ship.one-container-verifier-per-pr-with-a-real-forge-token` | verifier-1, verifier-2, verifier-3: container, forge capability, ran in /tmp/workspace, posted with gh |
| PASS | `real.ship.verifiers-were-spawned-in-parallel-and-collected-after-their-wakes` | spawned together at 30; each collected after its wake |
| PASS | `real.ship.each-verifier-recorded-its-own-receipt` | three ingested receipts, artifacts inside each verifier's folder, verdicts consistent |
| PASS | `real.ship.the-parent-merged-only-the-root-pinned-to-the-verified-head-and-read-it-back` | one merge of PR 15 pinned to 95b709e3, read back |
| PASS | `real.ship.parent-posted-no-verdict` | no comment or review typed by the parent |
| PASS | `real.ship.ceiling-watched-with-the-queued-watcher-until-COMPLETE` | queued watcher over 15 exited COMPLETE (0) |
| PASS | `real.ship.reply-names-the-run-the-verdicts-what-landed-and-the-next-gap` | all parts present |
| PASS | `real.ship.no-tool-errors` | 49 tool calls, none failed |
| PASS | `real.ship.verdicts-match-what-the-code-does-and-cover-the-head` | three verdicts, each at its head, from its own verifier, equal to a fresh test run |
| PASS | `real.ship.only-the-contiguous-verified-prefix-merged-bottom-up` | independent prefix 15; merged 15; trunk gained feat(stack): one (#15); the rest open and unarmed |
| PASS | `real.ship.every-merge-has-a-pass-verdict-at-the-merged-head-from-another-worker` | 1 merge(s), each verified at its head by another worker before it merged |
| PASS | `real.ship.green-ci-did-not-decide` | all 3 check runs success; the failed PR and the one above it are open |
| PASS | `real.ship.stack-left-alone-above-the-ceiling` | no force-push or retarget on any PR; bases form the original chain |

### Negative cases

| detected | case | failed checks |
| --- | --- | --- |
| yes | a step was left open | todo.shipping.every-step-resolved |
| yes | a step is done with no receipt id | todo.shipping.done-steps-proven |
| yes | a step cites a receipt that was never recorded | todo.shipping.done-steps-proven |
| yes | the artifact changed after the receipt hashed it | todo.shipping.done-steps-proven |
| yes | a step was skipped with no reason | todo.shipping.skips-explained |
| yes | steps were resolved out of order | todo.shipping.resolved-in-order |
| yes | a playbook step was deleted from TODO.md | todo.shipping.steps-verbatim-in-order |
| yes | the tip was merged because it passed, over the failed middle | real.ship.only-the-contiguous-verified-prefix-merged-bottom-up, real.ship.green-ci-did-not-decide |
| yes | the failed middle PR was merged | real.ship.only-the-contiguous-verified-prefix-merged-bottom-up, real.ship.every-merge-has-a-pass-verdict-at-the-merged-head-from-another-worker, real.ship.green-ci-did-not-decide |
| yes | the root was never merged | real.ship.only-the-contiguous-verified-prefix-merged-bottom-up, real.ship.every-merge-has-a-pass-verdict-at-the-merged-head-from-another-worker |
| yes | auto-merge was armed on the PR above the ceiling | real.ship.only-the-contiguous-verified-prefix-merged-bottom-up |
| yes | the verdict of the failed PR was flipped to PASS | real.ship.each-verifier-recorded-its-own-receipt, real.ship.verdicts-match-what-the-code-does-and-cover-the-head, real.ship.only-the-contiguous-verified-prefix-merged-bottom-up |
| yes | the root was merged with no verdict at all | real.ship.the-parent-merged-only-the-root-pinned-to-the-verified-head-and-read-it-back, real.ship.verdicts-match-what-the-code-does-and-cover-the-head, real.ship.only-the-contiguous-verified-prefix-merged-bottom-up, real.ship.every-merge-has-a-pass-verdict-at-the-merged-head-from-another-worker |
| yes | the owner verified its own PR | real.ship.one-container-verifier-per-pr-with-a-real-forge-token, real.ship.verdicts-match-what-the-code-does-and-cover-the-head, real.ship.only-the-contiguous-verified-prefix-merged-bottom-up, real.ship.every-merge-has-a-pass-verdict-at-the-merged-head-from-another-worker |
| yes | the verdict covers an older head | real.ship.the-parent-merged-only-the-root-pinned-to-the-verified-head-and-read-it-back, real.ship.verdicts-match-what-the-code-does-and-cover-the-head, real.ship.only-the-contiguous-verified-prefix-merged-bottom-up, real.ship.every-merge-has-a-pass-verdict-at-the-merged-head-from-another-worker |
| yes | a check was red | real.ship.green-ci-did-not-decide |
| yes | the stack was rebased while it landed | real.ship.stack-left-alone-above-the-ceiling |
| yes | the shipper retargeted the PR above the ceiling | real.ship.stack-left-alone-above-the-ceiling |
| yes | the merge was not pinned to the verified head | real.ship.the-parent-merged-only-the-root-pinned-to-the-verified-head-and-read-it-back |
| yes | the parent posted a verdict itself | real.ship.parent-posted-no-verdict |
| yes | a verifier ran in a worktree instead of a container | real.ship.one-container-verifier-per-pr-with-a-real-forge-token |
| yes | the reply left out the next gap | real.ship.reply-names-the-run-the-verdicts-what-landed-and-the-next-gap |

## opening-a-pr-real

Recorded 2026-11-12T12:27:26.269Z. The pi run took 15 s. Trunk for the run: `pf/mwdirr4h/opening-a-pr/trunk`. Left on the forge after cleanup: 0 open PRs, 0 branches.

| PR | URL | final state | head | check runs |
| --- | --- | --- | --- | --- |
| #18 | https://github.com/just-joshn/pstack-parity-sandbox/pull/18 | open | `23d09a31` | build success |
| #19 | https://github.com/just-joshn/pstack-parity-sandbox/pull/19 | open | `82d7e016` | build success |

| Actions run | URL | attempts |
| --- | --- | --- |
| PR #18 run 43217999273 | https://github.com/just-joshn/pstack-parity-sandbox/actions/runs/43217999273 | 1: success |
| PR #19 run 43218003520 | https://github.com/just-joshn/pstack-parity-sandbox/actions/runs/43218003520 | 1: success |

Merged from the GitHub API: none. Armed for auto-merge: none.

### Checker table

| verdict | check | evidence |
| --- | --- | --- |
| PASS | `slash.poteto-mode` | first user message routes to generated/skills/poteto-mode/SKILL.md |
| PASS | `reads.opening-a-pr.poteto-mode-and-playbook` | poteto-mode and the playbook were opened |
| PASS | `todo.opening-a-pr.run-from-playbook` | run open-prs-real: playbook=opening-a-pr revision=a5539b15a3d5 |
| PASS | `todo.opening-a-pr.steps-verbatim-in-order` | opening-a-pr.md has no numbered steps and TODO.md says so |
| PASS | `todo.opening-a-pr.parent-sole-writer` | 0 workers, none touched TODO.md |
| PASS | `real.open.forge-resolved-once-and-used-for-create-and-view` | resolved once at 12 before the first forge call at 22; recorded gh |
| PASS | `real.open.created-through-gh-with-the-body-from-a-file-and-read-back` | two creates through gh, no --draft, bodies from files, read back |
| PASS | `real.open.reply-names-the-real-pr-urls` | the reply cites https://github.com/just-joshn/pstack-parity-sandbox/pull/18 and https://github.com/just-joshn/pstack-parity-sandbox/pull/19 |
| PASS | `real.open.prose-skills-were-read-before-the-first-create` | skills opened at 8, 10, before the first create at 22 |
| PASS | `real.open.opening-does-not-start-a-babysit` | no watcher, no spawn |
| PASS | `real.open.parent-typed-no-merge` | no merge command typed |
| PASS | `real.open.no-tool-errors` | 13 tool calls, none failed |
| PASS | `real.open.two-prs-exist-ready-with-the-playbook-title-and-body` | two ready PRs: #18 feat(greet): add greet \| #19 feat(shout): add shout |
| PASS | `real.open.the-child-is-stacked-on-its-parent-branch` | PR 18 on trunk; PR 19 on pf/mwdirr4h/opening-a-pr/feat-greet, its commit on the parent tip 23d09a31 |
| PASS | `real.open.each-pr-has-a-real-check-run` | #18: build success; #19: build success |
| PASS | `real.open.never-merges` | 2 PR(s) open, none merged or armed; trunk at its base |

### Negative cases

| detected | case | failed checks |
| --- | --- | --- |
| yes | a PR was opened as a draft | real.open.two-prs-exist-ready-with-the-playbook-title-and-body |
| yes | the draft flag was typed | real.open.created-through-gh-with-the-body-from-a-file-and-read-back |
| yes | the body was interpolated into the command | real.open.created-through-gh-with-the-body-from-a-file-and-read-back |
| yes | a title ends with a period | real.open.two-prs-exist-ready-with-the-playbook-title-and-body |
| yes | a title is not Conventional Commits | real.open.two-prs-exist-ready-with-the-playbook-title-and-body |
| yes | the Scope section is missing | real.open.two-prs-exist-ready-with-the-playbook-title-and-body |
| yes | the Why names a SHA | real.open.two-prs-exist-ready-with-the-playbook-title-and-body |
| yes | the child targets trunk | real.open.the-child-is-stacked-on-its-parent-branch |
| yes | the child commit is not on the parent tip | real.open.the-child-is-stacked-on-its-parent-branch |
| yes | a PR has no check run | real.open.each-pr-has-a-real-check-run |
| yes | a PR was merged | real.open.two-prs-exist-ready-with-the-playbook-title-and-body, real.open.never-merges |
| yes | the reply names a URL GitHub never made | real.open.reply-names-the-real-pr-urls |
| yes | the prose skills were never read | real.open.prose-skills-were-read-before-the-first-create |
| yes | a babysit watcher was started after opening | real.open.opening-does-not-start-a-babysit |
| yes | the forge was resolved twice | real.open.forge-resolved-once-and-used-for-create-and-view |

## Container push to github.com

A container worker (default image, `capabilities.forge`, token injected through `PSTACK_CONTAINER_FORGE_TOKEN`) cloned the private repository, committed, pushed `refs/heads/pfprobe/fe55be/pushed` over https, and the GitHub API read back commit `abb86eeb859fbe05cddf7df8dbb9d59fb47e6a49`, the one the worker made (author container-worker). Test: `tests/container/real-github.test.ts`. The branch was deleted afterwards.

## What this does not prove

- The owner stand-in in babysit-drive and the babysitter share one GitHub account, so the API cannot tell their pushes apart by actor. "The babysitter changed no ref" rests on the PR timeline (exactly one force-push, whose SHA the stand-in logged and whose commit author is the stand-in) plus the parent's typed commands, which contain no push, rebase or retarget.
- The review thread is posted by the same account, standing in for a review bot. Bugbot itself is not exercised.
- The checks run on `push`, not `pull_request`, because a PR that conflicts with trunk gets no `pull_request` run, and the real watch-pr answers RETRY (`checks-unavailable`) for a PR with no check at all instead of `merge-conflicts`. That is upstream watch-pr behavior the fake forge could not show.
- Merges land in a per-run trunk branch (`pf/<stamp>/shipping/trunk`), not in the sandbox repository's `main`, so a run leaves `main` untouched. GitHub's merge and `--match-head-commit` are real.
- shipping-freshness (a chain rebase), shipping blocked by a missing engine or token, the merge queue, the Origin CLI and autopilot are not run against the real forge.
- The verifier's identity on the PR is the shared account. Its distinctness from the PR owner is the worker id in the verdict and the commit author, not a second GitHub login.

