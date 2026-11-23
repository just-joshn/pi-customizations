# Observability and `/tasks`

The extension records what ran: child transcripts, parent checkpoints, persisted patches, status widgets, hook events, and the `/tasks` pager.

## Sub-features

- Child transcript files under `<session dir>/subagents/`
- In-memory checkpoints and `subagents:checkpoint` hook events
- Parent `pi-subagents-state` custom entries with changed-record patches
- Background completion messages with status, transcript path, failure id, and worktree metadata
- `/tasks` pager with list, abort, background, retry, and prune
- Status widget with completed and cancelled counts

## How to get to it (user POV)

Delegate work, then open `/tasks` in the TUI. The pager lists runs, status, attempts, failure ids, transcript paths, and worktree details. `Enter` inspects; `k` aborts; `b` backgrounds a foreground run. The status widget shows active runs. `Ctrl+Alt+B` also backgrounds.

The transcript files live beside the parent session. The parent session JSONL contains `pi-subagents-state` entries whose patches fold into the current records.

## Driving it with the real harness

```bash
cd "$(git rev-parse --show-toplevel)/extensions/no-ceilings/pi-subagents"
node test/e2e/verify-delegation-fake-model.mjs
node test/e2e/verify-state-growth.mjs 12 50
```

The deterministic delegation script asserts the parent session has a `task` call, the child transcript has the `read` call and marker, and the persisted state has a `success` record with a transcript path. The growth script exercises twelve runs and checks the parent session stays under 2 MB.

For the pager, use the TUI recipe in the main `SKILL.md`. Capture the tmux pane before and after `/tasks`; the pager row is the evidence.

Inspect persisted state:

```bash
python3 - <<'PY' "$ROOT/workspace/sessions"
import json, pathlib, sys
for path in pathlib.Path(sys.argv[1]).glob('*.jsonl'):
    for line in path.read_text().splitlines():
        entry = json.loads(line)
        if entry.get('customType') == 'pi-subagents-state':
            print(json.dumps(entry['data'], indent=2)[:2000])
PY
```

## Gotchas

- The pager does not render checkpoint progress. Checkpoints are in the run record and hooks, not the pager.
- Mid-run patches keep metadata and the transcript path. Completion patches keep the transcript preview and checkpoints. A crash can lose the newest mid-run checkpoint.
- `/tasks` and `/agents` are TUI commands. Headless `pi -p` cannot open the pager; use tmux or inspect the session file.
- The persisted state is an append-only patch log. Fold entries in order by `agentId`; do not read only the last entry.
- Background completion messages arrive through the parent session. A parent reply alone does not prove the message was delivered; inspect the session JSONL.
