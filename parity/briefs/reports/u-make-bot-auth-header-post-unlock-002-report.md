# Report: Make-bot auth header post-unlock (002)

## Status

Cursor `key_server_ok`. Attempt `55f42e27-ee7e-4d6b-8f12-5b35824addff`. Probe HTTP 200. Key in owned 0600 store only. `MAKE-BOT-UI-KEY-SERVER-HOST` closed; `PSTACK-CMD-MAKE-BOT-UI-KEY-SERVER-001` `verified-pass-paired` (Pi `e75f8e08`).

## What worked

1. Operator left Automations Settings open on `parity-webhook-witness` with **Copy auth header** (not Generate — key already materialized).
2. Helper/`get_app_state` screenshots track the IDE key window; Automations proof used `screencapture -R0,33,1512,949` (Cursor Agents bounds, Retina 2×).
3. System Events / AXPress / `click_index` reported success but left the pasteboard empty. **CGEvent HID click** at the AX frame center of **Copy auth header** wrote the header (91 bytes).
4. Stored via `clipboard_to_secret` → `~/.local/share/pi-pstack-parity/make-bot-auth-header-post-unlock-002/55f42e27-….json` mode `0600`. Never printed.
5. First probe: `400` body `Automation … is disabled` (Authorization shape was correct).
6. CGEvent toggle → **Active**, Save; next probe: `400` `Automation does not have git configuration`.
7. Combo **No Repository** → filter `pi-pstack` → select `pi-pstack just-joshn` → Save; probe **HTTP 200** `success:true`.

## Merge

- `parity/scripts/merge-make-bot-post-unlock.mjs` updated to allow Enable/repo only when `keyStoredServerSide` + probe 200 (refuse enable-only shortcuts).
- Merge eval OK; mismatch closed; requirement paired.

## Non-claims / constraints kept

- No secrets in this report or evidence bodies.
- Activate + repo were required by the product for HTTP 200; recorded as `activatedByHarness` / `enabledForProbe` / `repoAttached`.
- Live-int-004 cascade still needs its own merge-proposal (not invented here).

## Evidence locators

- Disposition: `parity/research/make-bot-auth-header-post-unlock-002/disposition.json`
- Merge eval: `parity/research/make-bot-auth-header-post-unlock-002/merge-eval.json`
- Session artifacts: `parity/research/wait-unlock-make-bot-001/ready4-*`
