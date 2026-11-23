# Policy: deny rules and the headless outside refusal

The policy feature covers what happens when a call is forbidden. A read deny rule blocks a secret, a
write deny rule blocks a mutation, and a write outside the workspace is refused because the run has no
approval UI. The proof is an error result for each call, plus unchanged files on disk.

## Sub-features

- `policy-read-deny` refuses `read secret.txt` with `rule: **/secret.txt` and no file content.
- `policy-write-deny` refuses `write denied.txt` with `rule: **/denied.txt` and leaves the file.
- `policy-outside` refuses `write ../outside.txt` with `outside the workspace` and creates nothing.
- `policy-headless` makes all three calls errors, because there is no approval channel.

## How to get to it (user POV)

- Configure the rules in the Pi profile: `$PI_CODING_AGENT_DIR/pi-tools.json` with `rules` and
  `mode: "auto"`.
- Ask Pi to read or write a denied path. The model calls `read` or `write`.
- Ask Pi to write outside the workspace. The model calls `write` with `../outside.txt`.
- In an interactive session the outside write would prompt; this harness has no UI, so it refuses.

## Driving it with verify.ts

Preconditions:

- `doctor` prints `doctor: ok`.
- The scenario writes `pi-tools.json` with a read deny for `**/secret.txt`, a write deny for
  `**/denied.txt`, and `mode: auto`.
- The scenario seeds `secret.txt` and `denied.txt` and no `../outside.txt`.

- **Run the scenario.** From the repo root run
  `bun .agents/skills/verify-pi-tools/scripts/verify.ts run --feature policy`.
  The script prints `feature: policy`, `result: PASS`, and an `evidence:` path.
- **Check every call is an error.** `events.json` has three `tool_execution_end` events, each with
  `isError: true`.
- **Check the reasons.** The read names `rule: **/secret.txt`, the write names
  `rule: **/denied.txt`, and the outside write names `outside the workspace`.
- **Check no secret text.** The read event text does not contain `TOP-SECRET`.
- **Check the disk.** `files.json` shows `secret.txt` as `TOP-SECRET\n`, `denied.txt` as `original\n`,
  and no `../outside.txt`. The final assistant text is `POLICY-OK`.

## Gotchas

- The user config is at `$PI_CODING_AGENT_DIR/pi-tools.json`, not in the workspace. A workspace
  `.pi/pi-tools.json` loads only when the project is trusted, and this harness does not mark it
  trusted.
- A pattern without a slash such as `secret.txt` matches a file name at any depth, but the evidence
  messages show the pattern as written. Assert the pattern you configured.
- `auto` mode prompts for an outside write when a UI exists. The harness sets no UI, so the refusal is
  the expected result, not a skipped approval.
- Writing the config through the `write` tool would be a tool call. The scenario writes it directly to
  the profile before launch.
