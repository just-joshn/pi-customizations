import { readFileSync } from 'node:fs';

const snippet = (name) => readFileSync(new URL(`./worktree-audit-snippets/${name}.sh.txt`, import.meta.url), 'utf8');

export default [
  {
    path: 'skills/poteto-mode/scripts/worktree-audit.sh',
    edits: [
      [
        'cd "$repo" || exit 1\n',
        'cd "$repo" || exit 1\n\n' +
          '# Each missing tool silently blanks a column, so say so.\n' +
          'command -v jq >/dev/null 2>&1 || echo "warn: jq not found; PR column will be - for every worktree" >&2\n' +
          'command -v rg >/dev/null 2>&1 || echo "warn: rg not found; LAST_CHAT will be - for every worktree" >&2\n' +
          'command -v perl >/dev/null 2>&1 || echo "warn: perl not found; LAST_CHAT will be - for every worktree" >&2\n',
        'Warn on stderr when jq, rg, or perl is missing instead of silently blanking the PR and LAST_CHAT columns.',
      ],
      [
        "main_wt=$(git worktree list --porcelain | awk '/^worktree /{print $2; exit}')",
        "main_wt=$(git worktree list --porcelain | sed -n 's/^worktree //p' | head -1)",
        'Parse worktree paths by stripping the `worktree ` prefix so paths with spaces survive.',
      ],
      [
        "git worktree list --porcelain | awk '/^worktree /{print $2}' | while read -r wt; do",
        "git worktree list --porcelain | sed -n 's/^worktree //p' | while IFS= read -r wt; do",
        'Read each worktree path whole instead of splitting on whitespace.',
      ],
      [snippet('dirty-count-original'), snippet('dirty-count-replacement'), 'Count ignored and every untracked file, and treat any dirty tree as work to hold (upstream reference/plugins#459).'],
      ['\tcase "$dirty" in wip:*) bucket=hold-wip ;; *)', '\tcase "$dirty" in wip:*|scratch:*) bucket=hold-wip ;; *)', 'Bucket scratch worktrees as hold-wip.'],
      ['elif [ "$merged" = YES ] || [ "$pr" != "-" ]; then bucket=safe', snippet('bucket-safe-replacement'), 'Only merged ancestry or a MERGED PR is safe. A CLOSED unmerged PR needs review.'],
    ],
  },
];
