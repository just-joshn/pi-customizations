# cursor-agent Custom Mode path (binary + docs)

Measured against cursor-agent `2026.10.01-e373342` at
`~/.local/share/cursor-agent/versions/2026.10.01-e373342/`.

## Documented host paths

From `parity/research/cursor-host/customization/sources/prompting.md`:

- Pick a skill in the `/` menu and press Option+Enter (Mac) or Alt+Enter (Windows).
- Or select **Use as Mode** from the skill entry.
- Custom Modes are documented for Agents Window and CLI.

From `parity/research/cursor-host/cli/retrieved/reference_terminal-setup.md`:

- Option+Enter as `\x1b\r` is for newlines after `/setup-terminal`, not a separate
  Custom Mode protocol.

From poteto-help / pi README: Pi sticky spelling is `/poteto-mode sticky`. That is
not a Cursor Custom Mode entry path.

## CLI wiring (from minified bundles)

1. Slash footer copy when Custom Modes are enabled:
   `enter to attach · option+enter to use as mode`
   (`9969.index.js` / `palette-slash-list.tsx`).
2. Prompt input binds `onMetaEnter` to a handler that requires
   `customModesEnabled` and an active skill slash selection. It then submits with
   `skillInvokeStickiness: "sticky"`.
3. Skill run path activates Custom Mode only when
   `skillInvokeStickiness === "sticky"` and `customModesEnabled === true`
   (`9577.index.js`).
4. `customModesEnabled` comes from Statsig gate `glass_custom_modes`
   (`Xt=(0,Rt.QF)("glass_custom_modes")`).
5. Default gate table in `index.js` sets `glass_custom_modes: false`.
6. Meta+Enter byte detector (`1322.index.js` function `k`) accepts:

   - `\x1b\r`, `\x1b\n`
   - `\x1b[13;3~`, `[13;3~`
   - `\x1b[27;3;13~`, `[27;3;13~`
   - `\x1b[13;3u`, `[13;3u`
   - plus regex forms for `;3;13~` and `13;3u`

7. Hidden `--statsig-overrides` / `CURSOR_STATSIG_OVERRIDES` accepts
   `{"featureFlags":{"glass_custom_modes":true}}`, but apply runs only when
   `constants.Cu` is true. In this production build `Cu` is `false`, so overrides
   are ignored.

## Implication

In this locked cursor-agent build, Option+Enter sequences can be recognized as
Meta+Enter and still cannot enter Custom Mode while `glass_custom_modes` is off
for the account. Absence of the slash footer hint is the live chrome signal that
the gate is off.
