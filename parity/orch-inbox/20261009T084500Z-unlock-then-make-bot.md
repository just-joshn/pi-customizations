# Unlock Mac lock screen — then make-bot Generate

**Measured:** `IOConsoleLocked=Yes` still. Screencapture OCR is lock-noise. Helper cannot Discard Untitled.

## Right now (you)

1. Unlock the Mac **lock screen** (password / Touch ID) until Status menu / desktop responds to mouse.
2. Confirm: `ioreg -n Root -d1 | grep IOConsoleLocked` → `No`.
3. Restart this Cursor agent terminal.
4. In Automations: **Discard** stuck Untitled (do not Save).
5. Open webhook draft → **Generate auth header** (or leave open and tell coordinator).

## After that

Coordinator recaptures make-bot Generate + 0600 store + probe → can close `MAKE-BOT-UI-KEY-SERVER-HOST` with Pi `e75f8e08`.

## Still need separately

Benny+Slack (G4–G8), `CURSOR_API_KEY` (G1), Enterprise (G2), freeze owner (G3).
