# Setup role-confirm capture playbook

1. Confirm locked fixture digest `sha256:2b6b4668…` on `~/.cursor/rules/pstack-models.mdc` and `/tmp/pi-ref-agent/pstack/models.mdc`.
2. Run `parity/scripts/capture-setup-role-confirm.mjs --cursor-only`, then `--pi-only`.
3. Score `screen-02-role-confirm.txt` for every role with its model, accept/change prompt, and digest unchanged until after accept.
4. Link attempt IDs in `pair-setup-role-confirm-1.json`. Restore locked digest after each side.
