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
    ],
  },
];
