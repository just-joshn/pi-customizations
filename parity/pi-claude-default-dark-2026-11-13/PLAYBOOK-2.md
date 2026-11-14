# Playbook, run 2: closest Pi-native parity

User direction (2026-11-13): build a Pi extension that matches Claude Code's default dark theme as closely as Pi's own mechanisms allow, up to 100%. "Pi-native" means public Pi mechanisms only: theme JSON, `ExtensionAPI`, `ctx.ui`, `pi.registerToolRenderer`, and `@earendil-works/pi-tui` components. No private imports, no forks, no monkey patching. Where this conflicts with the design pack's verbatim text, the user's goal wins. Each such conflict is listed below.

## Decisions

| # | Topic | Decision | Why |
|---|---|---|---|
| 1 | Renderer adapters (pack strategy B) | Build them for every color mismatch a public hook can close: tool diffs, tool output, working indicator, and others the gap inventory finds. They are active only while `claude-default-dark` is the active theme, and otherwise defer to `next()` or the default. | Parity "as close as possible" needs them. Pack §11 allows B after a G4 failure, which we have. |
| 2 | `peerDependencies` | Add `"@earendil-works/pi-coding-agent": "*"` and `"@earendil-works/pi-tui": "*"` as Pi's packages.md requires. | Pi-native wins over the pack's verbatim manifest. Adapters import these at runtime. |
| 3 | Biome / formatting | Format the package to repo style and remove `result.error!`. | It is a real Pi package now, not a verbatim specimen. |
| 4 | Claude Code version | Compare 2.1.322 and 2.1.323 captures. Re-pin to the version the user runs if the colors are the same. | The user runs the auto-updated version. |
| 6 | Font | Record the terminal's font (Menlo, Alacritty's macOS default), and do not gate G0 on it. | Both apps inherit the terminal font, and parity is compared on SGR colors. |
| 9 | Commit size | Keep captures and results as evidence. Stop committing derived files that regenerate byte-identically (`captures/observations.json`, `captures/crosswalk-first-pass.csv`). `make` regenerates them. | Keeps the reviewable evidence and drops the bulk. |
| 10 | Scratch worktrees | Purged. | No longer needed. |
| 11 | Pi-only roles | Capture Claude at every `/effort` level. If its prompt border changes, map the thinking-level roles to it. Keep stock values only where Claude truly has no counterpart. | Moves roles from pi-only to measured where the evidence allows. |
| 12 | `/claude-theme verify` | Implement it to check, at runtime, that the active theme resolves to the shipped reference values, and to report the build-time gate vector shipped with the package. Superseded: `verify` reports the active theme, the matching and differing roles, and that parity is certified only by `development/PARITY_REPORT.md`; no gate vector ships, because gate results change on every run. | Pack §5 lists `verify`. It now has real evidence behind it. |
| 13 | Formal checks | Add property checks for the adapters (text and width are unchanged versus the built-in renderer; only styling changes). | Adapters are new rendering code where subtle bugs hide. |

## Phases

1. **Housekeeping.** Purge the worktrees, run the version check, fix the font and G0. Done in this run's first steps.
2. **Gap inventory.** For every renderer-required or unmappable role and every Claude-only surface, decide whether it can be closed by theme value, by a public hook, or not at all. The output is a table with the hook named.
3. **Adapter design (arena).** Two runners design the adapter layer against the inventory; pick and graft.
4. **Implement.** Write the adapters, the peerDependencies, `/claude-theme verify`, and the property checks. Update static-scan from a member allowlist to an API allowlist that permits only the public hooks used.
5. **Recapture and gate.** Themed Pi captures at every width, then G4–G10, reviews, report.
6. **Human review.** USER ACTION REQUIRED (marked in the reply): review the reference captures and write `results/APPROVED-SHA256SUMS`. Manually test IME and live resize.
