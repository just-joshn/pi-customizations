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
      [
        '\t# Distinguish real WIP (tracked edits) from disposable untracked scratch.\n' +
          '\tporcelain=$(git -C "$wt" status --porcelain 2>/dev/null)\n' +
          '\tif [ -z "$porcelain" ]; then dirty=clean\n' +
          "\telif printf '%s\\n' \"$porcelain\" | grep -qv '^??'; then\n" +
          "\t\tdirty=\"wip:$(printf '%s\\n' \"$porcelain\" | grep -cv '^??')\"\n" +
          "\telse dirty=\"scratch:$(printf '%s\\n' \"$porcelain\" | grep -c '^??')\"; fi\n",
        '\t# wip counts tracked edits. scratch counts untracked and ignored files. Neither is\n' +
          '\t# disposable, so both hold the worktree out of the safe bucket below.\n' +
          '\tporcelain=$(git -C "$wt" status --porcelain --untracked-files=all --ignored=matching 2>/dev/null)\n' +
          '\tif [ -z "$porcelain" ]; then dirty=clean\n' +
          "\telif printf '%s\\n' \"$porcelain\" | grep -qv '^[?!][?!]'; then\n" +
          "\t\tdirty=\"wip:$(printf '%s\\n' \"$porcelain\" | grep -cv '^[?!][?!]')\"\n" +
          "\telse dirty=\"scratch:$(printf '%s\\n' \"$porcelain\" | grep -c '^[?!][?!]')\"; fi\n",
        'Count ignored and every untracked file, and treat any dirty tree as work to hold (upstream cursor/plugins#459).',
      ],
      [
        '\tcase "$dirty" in wip:*) bucket=hold-wip ;; *)',
        '\tcase "$dirty" in wip:*|scratch:*) bucket=hold-wip ;; *)',
        'Bucket scratch worktrees as hold-wip.',
      ],
      [
        'elif [ "$merged" = YES ] || [ "$pr" != "-" ]; then bucket=safe',
        'elif [ "$merged" = YES ] || [ "${pr#*/}" = MERGED ]; then bucket=safe',
        'Only merged ancestry or a MERGED PR is safe. A CLOSED unmerged PR needs review.',
      ],
    ],
  },
];
