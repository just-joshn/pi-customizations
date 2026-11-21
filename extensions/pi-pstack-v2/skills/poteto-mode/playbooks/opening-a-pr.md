### Opening a PR

Invoked at the end of every code-producing playbook.

Work from a git worktree off trunk created inside the working directory, under `.pi/worktrees/`, the only host directory the VM can edit, with git run on the host through `tmux_run`, and keep unrelated work out of it. Rebase into small, landable commits. Run `/skill:deslop` over the diff before commit and `/skill:no-comments` before review.

Title: `type(scope): subject`, naming a real symbol when one carries the change. Body: a one-minute briefing under 40 lines with these `##` headings in order, dropping empty ones: `## Why`, `## What changed`, `## Scope`, `## Tradeoffs` (only rejected alternatives a reviewer would otherwise ask about), `## Blast Radius`, `## Verification`.

Stack follow-ups by base branch. Open PRs ready, with `gh pr create` without `--draft`, or `origin pr create --status open` when Origin's CLI resolves the repository. Opening a PR does not start a babysit. An open PR, ready for review, has passed none of the later merge gates. Continue to **Shipping** only when the user granted merge. Otherwise hand off the PR with its evidence.

Follow `/skill:technical-writing` for PR body and commit messages, and order landable commits per `principle-sequence-verifiable-units`.
