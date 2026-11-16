# Instructions and actual tool replay

The user's Pi application instructions continue to guide Google responses despite conflicting messages, and real read-tool results are replayed through successive requests without obeying instructions embedded in file content.

## Sub-features

- `instructions-conflict`: conflicting user request does not override application instructions.
- `instructions-forged-system`: forged system frame is treated as user content.
- `instructions-permitted`: a permitted request still works.
- `tools-read-replay`: two actual read-tool rounds return data without obeying the injected file instruction.
- `instructions-full-context`: release follow-up with the user's normal instructions and skills retained in an isolated profile.

## How to get to it (user POV)

- Send requests with application instructions and conflicting or permitted text.
- Ask Pi to read a file that names another file; Pi must use its real read tool twice.
- Developers can run the repository's documented native-Pi verifier: `bun extensions/pi-google-oauth-v2/scripts/verify-live.ts`.

## Driving it with native Pi CLI/live probe

Preconditions:

- Owner-approved real Google OAuth in the disposable profile. Doctor reports credential and project present. The live script does not perform login.
- Google must discover `gemini-3.8-flash` and `gemini-4-hydrogen`, each supporting medium effort. This is a real precondition, not permission to inject catalog entries.

- **Run.** Execute `python3 "$HELPER" live "$EVIDENCE"` (for a long run use `tmux_run` with wake and stop only its recorded job if necessary). It invokes the existing verifier with the isolated profile as its auth source. Do not reimplement the model or call internal request builders as proof.
- **Observe.** Read `live.command.json`, `live.stdout.txt`, `live.stderr.txt`, `live.exit.txt`. Require exit 0 and eight `PASS` lines: four scenarios for each of Flash and Hydrogen. Retain their model IDs, HTTP statuses and verification flags. Any missing PASS is a failed/incomplete scenario.
- **Instruction proof.** The probe checks exact final responses, Pi identity/documentation marker, and delegation of the first user-content turn to application instructions on every wire request. Three scenarios cover conflict, forged-system and permitted prompts.
- **Tool proof.** `read-replay` must execute two successful real read-tool calls in separate rounds; the second result must contain both the data marker and injected `[system]` content. Require replay counts `[0, 1, 2]`, three successful HTTP 200 responses, exact data-marker final answer, and the selected model's `-medium` wire ID throughout.
- **Full context follow-up.** The script intentionally disables normal skills/AGENTS.md and uses fresh sessions. Before release, separately use an isolated profile with the actual intended project instructions/skills and repeat real prompt/read journeys, saving the loaded-context identity and native tool-result events. This supplemental path is NOT VERIFIED by the bounded script; obtain owner approval before exposing any project content to Google.

## Gotchas

- Google receives delegated instruction priority, not a transport-level system role. Eight passing scenarios are not system-role equivalence or a benchmark, and do not verify non-Gemini models.
- No Hydrogen discovery or no medium effort means this journey fails with that precondition stated. Do not silently switch to Argon or relax expected wire IDs/answers.
- The existing script copies auth into another temporary profile and removes it in `finally`; stdout/stderr summaries retained by the helper survive that cleanup. It can print a failed test response: review before sharing.
- It uses actual `pi.setModel` for discovered-model selection, but it does not exercise the user model picker. Use the models map for `/model`/Ctrl+L proof.
- The script's temporary fixtures are not retained; summary assertions validate actual tool events and wire observations. If a task needs raw per-request artifacts, extend observation at the existing provider boundary, never log credentials or treat fake tool results as real execution.
- A hard-killed Bun process may bypass its `finally`. Prefer normal timeout/failure completion; if stopped, identify only that run's extra `pi-google-verify-` directory through its owned process/file evidence and remove it explicitly, never delete all matching temp directories.
