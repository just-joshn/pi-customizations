# Independent resume parity review

## Scope and verdict

Reviewed the working-tree diff, `spec.md`, `ledger.json`, `decisions.md`, public Cursor documentation excerpts in `fixtures/0.15.21/cursor-docs-quotes.md`, all eleven new `evidence/*v21*.json` records, and the relevant implementation/test/harness changes. No implementation was edited. No proprietary Cursor implementation or built-in skill prose was consulted. This is an evidence review, not a fresh execution of the test suite or remote providers.

**Overall NOT VERIFIED remains justified.** The new evidence improves confidence in the port, but does not justify treating every implemented adaptation as exact Cursor parity. TASK-019 has a documented-versus-observed conflict; HOST-006 verifies an offline integration, not real remote generation; MODE-006 is explicitly approximate. LIVE-001 and LIVE-004 should remain INCONCLUSIVE for reliable cross-host behavior, with their now-stale evidence summaries updated.

## Findings

### 1. TASK-019 VERIFIED overstates parity; the clean frontmatter probe contradicts its positive-shell contract

**Priority: high. Recommended status: INCONCLUSIVE for Cursor parity (or a separately declared intentional divergence).**

The public docs describe readonly as “no file edits, no state-changing shell commands.” That supports restricting writes, but does not by itself establish that every non-state-changing command is available. General sandbox defaults also do not establish the policy of a readonly custom subagent.

`cursor-readonly-v21-frontmatter-run1.json` uses the documented agent-frontmatter route. Its parent relays that `git log --oneline -1` and `curl` were blocked before execution with an Ask-mode tool restriction. This is evidence that shell was unavailable in this tested CLI configuration, including a read-only git command. It is not evidence that Cursor selectively allowed read-only shell and denied writes. `touch` and the `/tmp` write were skipped by the model, not attempted, so their denial must not be claimed as an observed tool result. Neither file existed afterward.

The record contains the parent's relayed child report, not raw child tool results. Thus “Cursor readonly always blocks all shell” would also be too broad: the defensible statement is that the recorded frontmatter probe reported shell-tool blocking for git log and curl on CLI 2026.10.01.

`cursor-readonly-v21-resume-run1.json` is not a counterexample to the frontmatter restriction: its Task schema omitted `readonly`, the model passed that extra argument anyway, and writes/network succeeded. This tests an unsupported/ignored call flag, not documented readonly agent configuration. It also warns against presenting TASK-001's added `readonly` call parameter as an observed native Cursor CLI contract.

The Pi sandbox tests can verify **Pi's chosen policy**. They cannot establish parity with the observed Cursor CLI. TASK-008 is inconsistent with TASK-019 and the new implementation: the spec still says only read/grep/find/ls/TodoWrite, no bash, and its ledger mapping still lists that old tool set. Reconcile these before asserting VERIFIED.

### 2. TASK-017 rewrite corrects an unsupported inference, but narrows away billing evidence

**Priority: medium. Recommended status: VERIFIED only for the explicitly narrowed local usage/model-card contract. Billing parity remains unverified.**

Withdrawing the old inference that background usage must enter parent chat totals is justified. Cursor docs name independent subagent contexts/token usage, a task card naming the model, and an account usage dashboard row. They do not equate the account dashboard with a parent-chat session counter.

The new Pi per-child transcript plus Task card is credible evidence for independent recorded usage and model identification. It does not prove account billing, usage-pool routing, or dashboard reconciliation. Keep D4's scope correction explicit; do not describe it as fixing or verifying the old background-total requirement. The rewritten requirement omits the dashboard behavior in its own source quote. That omission is acceptable as an explicit host/account adaptation, not as evidence that billing parity has been achieved. TASK-014's foreground session-total behavior is a separate Pi contract and does not settle background accounting.

### 3. HOST-006 fake provider verifies the CLI/codemode seam, not real image generation

**Priority: medium. Recommended status: VERIFIED for mapping/offline wiring; INCONCLUSIVE for remote generation or end-to-end teach/ketchup behavior.**

`test/fixtures/image-model.ts` registers `testimg/painter`, whose adapter returns a fixed 1×1 PNG. Its localhost base URL is not contacted by that implementation. The added e2e test runs real Pi CLI and codemode infrastructure with a scripted call, and checks that an image content block is returned. This is useful integration evidence, not just a string assertion.

It does not exercise remote authentication, a supported production image endpoint, prompt-dependent generated output, or a real model following teach/ketchup into generation. “Through the real Pi CLI” is accurate; “real remote image generation verified” is not. The current narrow `spec.md` input/output is host-map text and can reasonably remain VERIFIED, provided the ledger explicitly labels the provider offline/fake. Its acceptance note still says the environment has no image model: clarify “no remote image provider; a test-only provider covers wiring.” No real-image outcome should be inferred from this fixture.

### 4. MODE-006 VERIFIED needs an adaptation qualifier

**Priority: medium. Recommended status: VERIFIED for declared terminal approximation, not exact styling parity.**

The docs support icon/color metadata and the badge. `modeBadge` supports crown/lightning glyphs and maps colors to theme semantic colors. Yellow and orange both become warning; cyan, blue, purple, magenta, and brand all become accent. A user's theme can choose entirely different actual colors. Unknown icon names become lightning rather than the requested icon.

The spec acknowledges this adaptation, which is good. Tests of these mappings verify the chosen approximation, not Cursor's palette/icon rendering. “Nearest theme color” is a design assertion, not a measured color-distance result. For poteto-mode specifically, crown plus warning styling is a justified functional terminal substitute. Do not generalize it to exact support for all Cursor icon/color values or unconditional “yellow crown” rendering.

### 5. LIVE-001 gains a paired success, but still has observed failures and non-verbatim checking

**Recommended status: keep INCONCLUSIVE for reliable parity.**

New Pi Opus-high runs: playbook read 3/3; the checker reports all first steps matching in 2/3. Run 1 matches only steps 1 and 4 under the checker and shortens step 3. Cursor Opus-high poteto run: playbook read and first-step checker success 1/1. This establishes observed successes in both hosts, not reliability or equivalent success rates from such a small sample.

The harness removes Markdown emphasis/backticks before comparison (Cursor also removes a leading numbered prefix). `firstTodosAreStepsVerbatim` therefore means normalized equality, not byte-verbatim equality. Report that qualification. It is separate from downstream execution of the steps: several runs skip the how delegate and do not produce every requested output section. Those omissions do not negate the narrowly tested initial todo contract, but prevent claiming full playbook compliance.

The ledger gap “No model was observed following it reliably in both hosts” should distinguish lack of reliability evidence from lack of any paired success. Add the new 3/3, 2/3, and 1/1 observations rather than replacing historic failures.

### 6. LIVE-004 clean Cursor baseline now exists; success counts are not a deterministic guarantee

**Recommended status: keep INCONCLUSIVE for broad/reliable compliance; observed positive scenario is supported.**

Pi `live-delegate-v21-opus-run{1,2,3}.json`: all three records show a poteto-agent Task call and the absolute skill path in its prompt. The new checker avoids vacuous success when no delegate is called. These records support 3/3 **issued prompts** for the selected model/scenario; saved summaries omit tool-result events, so the checker alone is not proof of child success or its full skill read.

Cursor `cursor-delegate-v21-resume-run1.json`: no poteto agent was available; fallback delegation is not a valid pstack compliance trial. Run 2 discovers the copied project skills and custom poteto-agent and includes the absolute skill path: a usable positive baseline, conditional on the revision being the intended 0.15.21 copy. The harness now copies project resources and hides stale codex/claude user skill locations, addressing the old shadowing problem. This is project discovery, not proof of native marketplace plugin discovery.

Consequently the ledger/spec statements “no clean Cursor baseline” and “live-e2e.mjs has no delegate-path scenario yet” are obsolete. Replace them with the new positive observations and preserve the older Sonnet failures. One successful configured Cursor trial and three Pi trials cannot establish universal model compliance. Upgrading the probabilistic requirement to VERIFIED would need an explicit criterion such as “observed at least once,” not an implicit relaxation of reliable parity.

## Other status judgments

- RES-010: VERIFIED is justified for shipped instructions, sibling paths, and availability of an absolute path. Do not infer deterministic parent/delegate compliance from it; LIVE-004 owns that issue.
- HOST-005: added title/description fields and validation against 24 observed calls improve schema coverage. VERIFIED is reasonable for observed input/UI coverage, not the complete native Cursor result contract. The unknown result text remains correctly acknowledged. The new CLI record also exposes different casing/extra fields (`allowMultiple`, `runAsync`), so those IDE observations must not be described as an exhaustive all-client schema.
- MODE-004: INCONCLUSIVE remains appropriate; stored transcripts do not reveal all per-turn context injection.
- LIVE-002/LIVE-003: existing VERIFIED statuses are defensible as recorded scenario successes, not universal reliability guarantees. Apply the same distinction consistently across LIVE rows.
- Other unchanged VERIFIED rows were not independently re-executed here; this review supplies no blanket recertification of them.

## Evidence hygiene and required report corrections

1. Separate documented contract, observed Cursor CLI behavior, and Pi's intentional adaptation in TASK-019; record the contradiction, not just the successful Pi sandbox probe.
2. Reconcile obsolete TASK-008 no-shell prose/mapping with the added sandboxed bash.
3. Keep TASK-017's contract revision transparent and exclude remote billing claims.
4. Label HOST-006's provider fixed/offline and MODE-006's styling semantic/approximate.
5. Update LIVE-001/LIVE-004 evidence summaries and remove obsolete “no scenario/no baseline” assertions.
6. Name normalized todo equality accurately. The saved JSON truncates arguments at 600 characters and retains checks rather than full raw events; it is adequate for the displayed path prefixes and todo arrays but weaker for reconstructing complete tool calls, child enforcement, or successful task completion. Prefer preserving raw event streams for future reproducibility.

No implementation changes were made and no new external runs were performed.
