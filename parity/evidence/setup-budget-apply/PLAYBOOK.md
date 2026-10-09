# setup-budget-apply capture

Oracle. `PSTACK-SETUP-BUDGET-APPLY-001` / scenario `setup-budget-apply`.

1. Seed a mixed fixture with real medium-effort slugs, panel lists, one `auto`, and one `inherit-parent`.
2. Run `parity/scripts/capture-setup-budget-apply.mjs` for Cursor, then Pi.
3. Choose budget `large — xhigh reasoning`. Diff `rule-before.mdc` vs `rule-after.mdc`.
4. Pass when every real slug (panel entries included) has effort `xhigh`, and aliases stay put.
5. Restore the locked all-inherit-parent reference rule after each side.
