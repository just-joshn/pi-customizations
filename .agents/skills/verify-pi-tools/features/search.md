# Search: grep, find, and ls

The search feature covers content search (`grep`), glob discovery (`find`), and directory listing
(`ls`) with a shared ignore verdict. The scenario seeds two files that match the same pattern and an
ignore file that hides one of them; every search must return only the visible file.

## Sub-features

- `search-grep` returns `keep/a.ts` and drops `skip/b.ts` for the pattern `needle`.
- `search-find` lists `keep/a.ts` for `*.ts` and drops the ignored file.
- `search-ls` shows `keep/` and omits `skip`.
- `search-ignore` applies `.piignore` to all three tools in the same run.

## How to get to it (user POV)

- Ask Pi to search for a string. The model calls `grep` with `pattern`.
- Ask Pi to find files by glob. The model calls the `find` tool with `pattern`.
- Ask Pi to list a directory. The model calls `ls` with an optional `path` and `depth`.
- From an SDK session, the same tools are available when the extension is loaded.

## Driving it with verify.ts

Preconditions:

- `doctor` prints `doctor: ok`.
- The scenario seeds `keep/a.ts`, `skip/b.ts`, and `.piignore` with `skip/` before launch.

- **Run the scenario.** From the repo root run
  `bun .agents/skills/verify-pi-tools/scripts/verify.ts run --feature search`.
  The script prints `feature: search`, `result: PASS`, and an `evidence:` path.
- **Check grep.** In `summary.txt`, the first tool line is a successful `grep` naming `keep/a.ts`. It
  must not name `skip/b.ts`.
- **Check find.** The second line is a successful `find` naming `keep/a.ts` and not the ignored file.
- **Check ls.** The third line is a successful `ls` showing `keep/` and hiding `skip`.
- **Check the end state.** `files.json` is empty for this scenario; the proof is the tool result text
  and the final assistant text `SEARCH-OK` in `stdout.jsonl`.

## Gotchas

- `.piignore` is seeded directly by the script. The `write` tool refuses to change a protected ignore
  file, so a model turn cannot create the filter.
- The glob tool is named `find`, not `glob`. Scripts or prompts that ask for `glob` will not call it.
- Results are relative to the search root. A file in a nested directory appears as `keep/a.ts`.
- `grep` and `find` return partial results on a timeout; a truncated result is still a pass only when
  the expected file is present and the ignored file is absent.
