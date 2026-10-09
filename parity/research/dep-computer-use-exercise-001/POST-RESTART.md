# Post-restart Computer Use / sticky capture

## Confirm grants (in a **new** terminal / agent session)

```sh
cursor-agent worker --computer-use --share-desktop view_and_control --debug start
# In DEBUG LOGS, need:
#   Computer use: Ready yes, Mac app yes
#   Desktop share: Ready yes, Screen recording yes, Accessibility yes
```

Also:

```sh
screencapture -x /tmp/tcc-ok.png && file /tmp/tcc-ok.png
osascript -e 'tell application "System Events" to tell process "Cursor" to get count of windows'
```

Enable in System Settings → Privacy & Security for **Cursor Computer Use** (bundle `co.anysphere.cursor-computer-use`), not only Terminal/Cursor:

1. Accessibility
2. Screen Recording

Optionally **Cursor Agent Helper** (`co.anysphere.cursor.agent-helper`) for `--share-desktop`.

## Then capture (coordinator / agent)

1. Sticky Custom Mode via Agents Window → `/poteto-mode` → Use as Mode → follow-up turn  
   Brief: `parity/briefs/u-mode-sticky-capture.md` / Agents Window path  
2. Computer-use edge live exercise with attempt IDs (screenshot/click/type)  
3. Revisit Automations editor / make-bot Cursor host if desktop drive works

Kill leftover workers:

```sh
pkill -f 'cursor-agent worker' || true
```
