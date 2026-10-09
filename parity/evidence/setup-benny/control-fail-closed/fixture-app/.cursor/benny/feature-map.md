# Feature map (completed fixture)

CONTROL-FAIL-CLOSED-FEATURE-MAP-MARKER

## login

- Path: open app → Login → submit credentials form
- Adapter actions: `open_login`, `submit_login`
- States: default, loading, error
- Screenshot: login form with email field visible
- Recording: full login attempt through error state
- Reset: sign out or clear session cookie

## settings

- Path: open app → Settings
- Adapter actions: `open_settings`, `toggle_notify`
- States: default, disabled
- Screenshot: settings panel
- Recording: toggle notify once
- Reset: restore defaults
