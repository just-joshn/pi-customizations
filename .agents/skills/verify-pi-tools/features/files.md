# Files: write, read, and edit

The files feature covers the layer's three text mutations: `write` creates a file, `read` returns the
content with a metadata footer and digest, and `edit` replaces exact text in place. The proof is the
tool results plus the bytes on disk after Pi exits.

## Sub-features

- `files-write` creates `notes.txt` with `alpha\n` and reports one line and six bytes.
- `files-read` returns `alpha` and the footer `[file: 1 line, 6 bytes]` followed by the sha256 line.
- `files-edit` replaces `alpha` with `beta` and leaves `beta\n` on disk.
- `files-handoff` keeps the three tool calls in one Pi turn sequence with no extra model call.

## How to get to it (user POV)

- Ask Pi to write a file. The model calls `write` with `path` and `content`.
- Ask Pi to read the file back. The model calls `read` with `path`.
- Ask Pi to change the text. The model calls `edit` with `edits[].oldText` and `edits[].newText`.
- From an SDK session, the same three tools are available when the extension is loaded.

## Driving it with verify.ts

Preconditions:

- `doctor` prints `doctor: ok`.
- `notes.txt` does not exist in the run's workspace; the scenario creates it.

- **Run the scenario.** From the repo root run
  `bun .agents/skills/verify-pi-tools/scripts/verify.ts run --feature files`.
  The script prints `feature: files`, `result: PASS`, and an `evidence:` path.
- **Check the tool sequence.** Open `events.json` from the evidence directory. The three
  `tool_execution_end` events name `write`, `read`, and `edit`, in that order, and none has
  `isError: true`.
- **Check the read result.** The second event's text contains `alpha`, `[file: 1 line, 6 bytes]`, and
  `[sha256: `. The digest line is part of the result the model sees.
- **Check the bytes.** `files.json` records `notes.txt` as `beta\n`, and `stdout.jsonl` ends with the
  assistant text `FILES-OK`.
- **Confirm the model saw the tools.** The run makes four scripted turns; `summary.txt` reports
  `model turns: 4`.

## Gotchas

- The read footer carries the full sha256 on its own line. A check for an exact footer alone is
  incomplete.
- `edit` matches text after normalizing line endings, then splices the original file, so the bytes on
  disk are the proof; the diff in the event is not.
- The fake model is scripted. Changing the prompt without changing `turns` makes Pi stop after the
  scripted calls and the run fails at the final text check.
- A failed check still writes evidence. Read `summary.txt` before rerunning.
