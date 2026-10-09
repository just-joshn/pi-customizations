# Control UI harness notes
Marker: UI_PROBE
- Server: node serve.mjs on 127.0.0.1:8765
- Harness: headless Google Chrome + raw CDP (Node 24 WebSocket, /tmp/cdp.mjs); no Playwright added.
- Steps: navigate, read #out (before: "idle"), click #go (DOM click), read #out (after: "UI_PROBE_OK").
- Screenshot: ui-harness-after.png
- Result: UI_PROBE_OK confirmed.
