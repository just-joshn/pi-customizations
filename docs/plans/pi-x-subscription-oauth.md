# The X Subscription in Pi plan

Rename `pi-xai-oauth` to `pi-x-subscription-oauth`, then give Pi users every Grok Build model and every Cursor CLI model under one package. The rule is dual backends with separate Pi credentials, never a single proxy. PR order is `usage` (open), `rename`, `cursor-adapter`, then `cursor-native`.

## How to read this

One box is one unit of work. Every box names the evidence that checks it. A nested box is a sub-step of the box above it. Check a box only when its evidence exists, a file, a log line, a screenshot, a test run, or a SHA. The body is a how-to. The appendices explain and record.

The program runs `pstack/skills/poteto-mode/playbooks/autopilot-stack.md`. The operator lands every PR. Owners stop at merge-ready.

Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

## Program checklist

### Arm the program

- [ ] State the protocol and this plan to the operator, then stop. Start execution only on the operator's explicit go.
- [ ] Read these from trunk at program start. Re-read them at every tick.
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/autopilot-stack.md`
  - [ ] `git show origin/main:pstack/skills/swarm/SKILL.md`
  - [ ] `git show origin/main:docs/plans/pi-x-subscription-oauth.md`
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/refactoring.md`
  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/feature.md`
  - [ ] `git show origin/main:pstack/skills/principle-sequence-verifiable-units/SKILL.md`
- [ ] On the operator's go, arm the audit tick as `/loop 1h` with the tick prompt below. Never leave the cadence to memory.
- [ ] Use this tick prompt, verbatim. "Re-read the execution playbook from trunk. Audit the operation against it and fix drift in this tick. Probe every active lane and judge progress by side effects only. Stand down a stuck lane and dispatch its replacement now. Then post a short status message to the operator in chat only when the audit found a tracked change that no earlier status message reported, such as a PR opened, a code-ready head, a round launched or closed, a verdict, a merge, a stuck agent and the action taken, a blocker added or cleared, or a decision only the operator can make. Name every such change and nothing else. Do not repeat a table, the merged list, or an unchanged blocker. If the audit found none, end the turn with no reply text. Either way, log this tick's row in your decision trail. The row names the items reported, or none."
- [ ] On the operator's hold or stand-down, send every owner a zero-writes order at once.

### Spawn owners

- [ ] Spawn one owner per PR with the full lifecycle the execution playbook names.
- [ ] Follow this dependency graph. Start dependent work only after its parent merges, or base it on the parent branch when the execution playbook stacks.
  - [ ] `usage` is already open as https://github.com/just-joshn/pi-customizations/pull/190 on `feat/pi-xai-oauth-usage`. Land or stack under it before `rename`.
  - [ ] `rename` after `usage`. Branches from the usage head (or from `main` once usage merges).
  - [ ] `cursor-adapter` after `rename`.
  - [ ] `cursor-native` after `cursor-adapter`.
- [ ] Hold the file boundaries. `rename` touches live package paths and callers only. `cursor-adapter` and `cursor-native` touch `extensions/pi-x-subscription-oauth/**` plus root docs that name the new Cursor provider. Leave `parity/**` archives untouched except the one status line named in `rename`.
- [ ] Hold the review gate. `cursor-adapter` and `cursor-native` change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.

### PR mechanics, for every PR

- [ ] Resolve the forge once. Default to `gh`; if `command -v origin` succeeds and Origin can resolve the repository, use `origin pr` for every PR operation. Record any fallback to `gh`. Never require `gt`.
- [ ] Open the PR ready, never draft, per **Opening a PR**. Use the run's built-in PR tool when it has one, else `origin pr create --status open --base <base-branch>` or `gh pr create --base <base-branch>` according to the resolved forge. A stack child targets its parent branch.
- [ ] Run the repo's lint and typecheck once before the PR-facing push. Push with hooks on.
- [ ] Run `/deslop` before each commit and `/no-comments` before review.
- [ ] Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.
- [ ] Rebase onto current trunk before the code-ready report and babysit. Keep that merge base in fix rounds. Rebase again only at merge prep, on a `git merge-tree` conflict with trunk, on a CI failure that comes from a change on trunk, or when a known concurrent change to the same files lands.

### Verdict and merge, for every PR

- [ ] A full swarm runs once, at the code-ready head. Another full swarm runs only for new behavior, a redesign, or a large new diff. A rebase, a merge-conflict resolution, or a minor fix gets a single verifier at the new head, and a wording-only change gets none. Run each full swarm per `pstack/skills/swarm/SKILL.md`. One gates lane. The ten live lanes from the PR's **Verify, live** block. The perf lane from its **Verify, perf** block. Two or more audit lanes, each with its own focus, that read the diff and the receipts and distrust the PR body. The root audits the receipts in the merge-ready report before the verdict.
- [ ] Judge every finding by the execution playbook's blocking rule. The verdict is clean when none blocks. A failure on trunk behavior in a lane marked `Regression lane against trunk.` is recorded against trunk and does not block the PR. A new head gets a fresh verdict, except for results that stay valid under the patch-id rule in `playbooks/shipping.md`.
- [ ] The root appends each PR to the base-branch stack and the operator lands it bottom-up. Owners stop at merge-ready. Apply the patch-id rule from `playbooks/shipping.md`.

### Boot recipe, for every live lane

Each live lane runs on its own cloud VM at the PR head. Drive through Pi CLI commands and `cursor-agent` where the PR needs Cursor auth. This repo has no installed `control-cli` skill, so lanes capture terminal output as PNG screenshots via the host terminal recorder the swarm worker already uses.

- [ ] `git fetch origin <head-branch> && git checkout <head SHA>`.
- [ ] Install workspace deps with `bun install`. Confirm `pi --version` and, for Cursor lanes, `cursor-agent --version`.
- [ ] Deliver input only through Pi and `cursor-agent` argv. Read-only diagnostics are `pi --list-models`, `pi /usage` when logged in, and `cursor-agent --list-models`.
- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.

## Land usage first (usage)

**Depends on.** None. Already open as https://github.com/just-joshn/pi-customizations/pull/190.

**Files.**

- [ ] Keep `extensions/pi-xai-oauth/src/usage.ts` from PR 190.
- [ ] Keep `extensions/pi-xai-oauth/test/usage.test.ts` from PR 190.
- [ ] Keep `extensions/pi-xai-oauth/test/fixtures/billing-credits.json` from PR 190.

**Build.**

- [ ] Merge or stack-ready the existing `/usage` command that reads `GET https://cli-chat-proxy.grok.com/v1/billing?format=credits`.

**You see.**

- [ ] `/usage` prints weekly plan percent, GrokBuild and Cursor product shares, prepaid, and unified flag.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] `extensions/pi-xai-oauth/test/usage.test.ts` covers parse, format, fetch errors, and the command. Run `bun run --filter @justjoshn/pi-xai-oauth test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-medium-fast` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `/usage` at trunk and head. Trunk lacks `/usage`, so record that and gate the head print of plan percent plus product shares. Save `usage-regression.png`. Pass when head prints a used percent and at least one product line.
- [ ] Lane 2. Logged-in `/usage` against the live billing endpoint. Save `usage-live.png`. Pass when the print includes `Unified` and a reset window.
- [ ] Lane 3. Logged-out `/usage`. Save `usage-logged-out.png`. Pass when the command tells the user to `/login`.
- [ ] Lane 4. `pi --list-models grok-build` still lists the four Grok Build ids. Save `usage-models.png`. Pass when `grok-4.7` appears.
- [ ] Lane 5. `/login` label still names The X Subscription. Save `usage-login-label.png`. Pass when the login row includes that phrase.
- [ ] Lane 6. Typecheck on the package. Save `usage-typecheck.png`. Pass when `bun run typecheck` exits 0.
- [ ] Lane 7. Package tests. Save `usage-tests.png`. Pass when `bun run test` exits 0.
- [ ] Lane 8. `bun run prove:list`. Save `usage-prove-list.png`. Pass when prove ids print.
- [ ] Lane 9. README documents `/usage`. Save `usage-readme.png`. Pass when the README section names `/usage`.
- [ ] Lane 10. Billing fixture matches the live shape fields used by the parser. Save `usage-fixture.png`. Pass when the fixture contains `creditUsagePercent` and `productUsage`.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time for one `/usage` round trip at head. Trunk lacks the command, so also record the absolute budget for the billing GET alone.
- [ ] Probe. Time `fetchPlanUsage` against the live endpoint three times at head. At trunk, time a no-op shell that prints `missing` so both sides emit a number.
- [ ] Baseline. Record the trunk no-op first.
- [ ] Rule. Head median under 3000 ms. Fail if any head sample exceeds 8000 ms.

**Review gate.** None. `usage` is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Operator squash-merges https://github.com/just-joshn/pi-customizations/pull/190 or the stack child that replaces it.

## Rename the package (rename)

**Depends on.** `usage`.

**Files.**

- [ ] Move `extensions/pi-xai-oauth/` to `extensions/pi-x-subscription-oauth/`.
- [ ] Edit `extensions/pi-x-subscription-oauth/package.json` so `name` is `@justjoshn/pi-x-subscription-oauth` and `repository.directory` plus homepage match.
- [ ] Edit root `package.json` `pi.extensions` path.
- [ ] Edit `Makefile` filters and rename `verify-xai-oauth-live` to `verify-x-subscription-oauth-live`.
- [ ] Edit `scripts/verify-fresh-install.mjs` and `scripts/verify-install-sources.mjs`.
- [ ] Edit root `README.md` and `docs/releases.md`.
- [ ] Edit `.pi/skills/verify-pi-customizations/features/oauth-providers.md` and `.pi/skills/verify-pi-customizations/bin/control-pi`.
- [ ] Edit temp-dir prefixes in package tests and prove scripts.
- [ ] Edit the status line in `parity/pi-xai-oauth/spec.md` so it points at the new README path.
- [ ] Regenerate `bun.lock` with `bun install`.
- [ ] Leave `parity/pi-xai-oauth/` and other archival `parity/**` strings that record the old name.

**Build.**

- [ ] Rename the live package and every live caller string from `pi-xai-oauth` to `pi-x-subscription-oauth` without changing provider id `grok-build`.

**You see.**

- [ ] `pi install npm:@justjoshn/pi-x-subscription-oauth` is the documented install string, and `make verify-oauth` filters the new package name.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Package tests still pass under the new directory. Run `bun run --filter @justjoshn/pi-x-subscription-oauth test`.
- [ ] A rename lever script reports zero live `pi-xai-oauth` hits outside `parity/**` and the authorize fixture notes field. Run that script and keep its log.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-medium-fast` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Run `pi --no-extensions -e extensions/<pkg> --list-models grok-build` at trunk (`pi-xai-oauth`) and head (`pi-x-subscription-oauth`). Save `rename-list-models.png`. Pass when both list `grok-4.7`.
- [ ] Lane 2. `make verify-oauth` at head. Save `rename-verify-oauth.png`. Pass when the new filter exits 0.
- [ ] Lane 3. `make verify-install` at head. Save `rename-verify-install.png`. Pass when exit 0.
- [ ] Lane 4. Root README install line uses the new npm name. Save `rename-readme.png`. Pass when the line contains `@justjoshn/pi-x-subscription-oauth`.
- [ ] Lane 5. Package README title uses the new name. Save `rename-pkg-readme.png`. Pass when the H1 matches.
- [ ] Lane 6. `rg pi-xai-oauth` outside `parity/**` and the authorize fixture notes field returns no live hits. Save `rename-rg.png`. Pass when the lever exits 0.
- [ ] Lane 7. Provider id remains `grok-build` in auth and catalog. Save `rename-provider-id.png`. Pass when `--list-models grok-build` still works.
- [ ] Lane 8. `/usage` still works after the move. Save `rename-usage.png`. Pass when plan percent prints.
- [ ] Lane 9. Biome on the new directory. Save `rename-biome.png`. Pass when `bunx biome ci extensions/pi-x-subscription-oauth --error-on-warnings` exits 0.
- [ ] Lane 10. `parity/pi-xai-oauth/spec.md` status line names the new README path. Save `rename-parity-pointer.png`. Pass when that path exists on disk.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Wall time for `bun run --filter <pkg> typecheck` at trunk and head.
- [ ] Probe. Run the typecheck three times on each side, interleaved.
- [ ] Baseline. Record the trunk median first.
- [ ] Rule. Head median within 20 percent of trunk, or absolute under 60000 ms if the machine is cold.

**Review gate.** None. `rename` is not review-gated.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Operator lands the PR. After the new package publishes, run `npm deprecate @justjoshn/pi-xai-oauth "Install @justjoshn/pi-x-subscription-oauth instead."` as a separate operator registry step.

## Add the Cursor provider adapter (cursor-adapter)

**Depends on.** `rename`.

**Files.**

- [ ] Create `extensions/pi-x-subscription-oauth/src/cursor/` for catalog, auth, and `streamSimple` adapter code.
- [ ] Edit `extensions/pi-x-subscription-oauth/src/index.ts` to `registerProvider` a second id `cursor` beside `grok-build`.
- [ ] Create loopback fixtures and Vitest coverage under `extensions/pi-x-subscription-oauth/test/` for Cursor registration, catalog parse, and adapter streaming.
- [ ] Edit the package README so it documents both providers and the `cursor-agent` requirement.

**Build.**

- [ ] Register provider `cursor` with `refreshModels` from Connect JSON `GetUsableModels` (or `AvailableModels`) using the Cursor session JWT, and a `streamSimple` that runs `cursor-agent --print --output-format json --mode ask --model <id>` until `cursor-native` lands.

**You see.**

- [ ] `pi --list-models cursor` includes `composer-2.5`, and a one-shot ask against that model returns model text while `grok-build` keeps working.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] New tests assert two providers register, Cursor catalog parsing, and adapter stream events against a fake `cursor-agent`. Run `bun run --filter @justjoshn/pi-x-subscription-oauth test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-medium-fast` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. List `grok-build` models at trunk and head. Save `cursor-adapter-grok-regression.png`. Pass when both sides still list `grok-4.7`.
- [ ] Lane 2. `pi --list-models cursor` after Cursor login. Save `cursor-adapter-list.png`. Pass when `composer-2.5` appears.
- [ ] Lane 3. One-shot Pi ask on `composer-2.5`. Save `cursor-adapter-composer.png`. Pass when the reply is non-empty.
- [ ] Lane 4. One-shot Pi ask on a Grok Build model. Save `cursor-adapter-grok-chat.png`. Pass when the reply is non-empty.
- [ ] Lane 5. `/login` shows both Grok Build and Cursor rows. Save `cursor-adapter-login.png`. Pass when both rows appear.
- [ ] Lane 6. Logged-out Cursor model request fails with a clear login hint. Save `cursor-adapter-logged-out.png`. Pass when the error names Cursor login.
- [ ] Lane 7. `/usage` still reads the Grok Build billing meter. Save `cursor-adapter-usage.png`. Pass when product shares print.
- [ ] Lane 8. Missing `cursor-agent` binary yields a clear install hint. Save `cursor-adapter-missing-bin.png`. Pass when the message names `cursor-agent`.
- [ ] Lane 9. Package tests. Save `cursor-adapter-tests.png`. Pass when `bun run test` exits 0.
- [ ] Lane 10. README documents both providers. Save `cursor-adapter-readme.png`. Pass when both provider ids appear.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time to first token for a short ask on `composer-2.5` at head. Trunk lacks the Cursor provider, so also set an absolute budget for that ask and for `grok-build` ask end-to-end at both sides.
- [ ] Probe. Run three short asks on each side for `grok-build`. At head only, run three short asks on `composer-2.5`.
- [ ] Baseline. Record trunk `grok-build` median first.
- [ ] Rule. Head `grok-build` median within 20 percent of trunk. Head `composer-2.5` time-to-first-token under 15000 ms median, fail above 45000 ms.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 2 and lane 3 screenshots into `docs/plans/media/cursor-adapter-review-list.png` and `docs/plans/media/cursor-adapter-review-composer.png`.
- [ ] Record a 30 to 60 second video of listing Cursor models and completing one ask. Save it as `docs/plans/media/cursor-adapter-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Operator lands after the review click.

## Replace the Cursor subprocess with native HTTP (cursor-native)

**Depends on.** `cursor-adapter`.

**Files.**

- [ ] Create `extensions/pi-x-subscription-oauth/src/cursor/native/` for the captured `api2.cursor.sh` request shapes.
- [ ] Edit the Cursor `streamSimple` (or native `ProviderStreams`) to call Cursor HTTP with the stored Cursor credential and keep `cursor-agent` only as a login helper or fallback.
- [ ] Create fixtures from redacted captures under `extensions/pi-x-subscription-oauth/test/fixtures/cursor/`.
- [ ] Edit README to mark native transport as default.

**Build.**

- [ ] Speak Cursor inference over HTTPS without spawning `cursor-agent` for chat turns, using credentials obtained through the Cursor login path.

**You see.**

- [ ] A Cursor model chat works with `cursor-agent` removed from `PATH` after login credentials already exist.

**Verify, unit.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Fixture-driven stream tests cover happy path, 401 refresh, and quota errors without spawning a binary. Run `bun run --filter @justjoshn/pi-x-subscription-oauth test`.

**Verify, live.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked. Ten lanes on `grok-4.7-medium-fast` at the PR head, per the boot recipe.

- [ ] Lane 1. Regression lane against trunk. Short ask on `composer-2.5` at trunk (adapter) and head (native). Save `cursor-native-regression.png`. Pass when both return non-empty text.
- [ ] Lane 2. Head chat with `cursor-agent` missing from `PATH`. Save `cursor-native-no-bin.png`. Pass when the ask still completes.
- [ ] Lane 3. Catalog refresh without the binary, using the native list endpoint or cached catalog. Save `cursor-native-catalog.png`. Pass when `composer-2.5` appears.
- [ ] Lane 4. 401 path refreshes or prompts re-login. Save `cursor-native-401.png`. Pass when the user-visible error or recovery is clear.
- [ ] Lane 5. Quota error from Cursor surfaces without crashing Pi. Save `cursor-native-quota.png`. Pass when the message names usage or credits.
- [ ] Lane 6. `grok-build` chat unchanged. Save `cursor-native-grok.png`. Pass when the reply is non-empty.
- [ ] Lane 7. `/usage` unchanged. Save `cursor-native-usage.png`. Pass when plan percent prints.
- [ ] Lane 8. Package tests. Save `cursor-native-tests.png`. Pass when exit 0.
- [ ] Lane 9. Typecheck. Save `cursor-native-typecheck.png`. Pass when exit 0.
- [ ] Lane 10. README says native transport is default. Save `cursor-native-readme.png`. Pass when that sentence exists.

**Verify, perf.** Tests alone are not sufficient verification. A PR is verified only when its unit, live, and perf boxes are all checked.

- [ ] Metric. Time to first token for the same short `composer-2.5` ask at trunk (adapter) and head (native).
- [ ] Probe. Three interleaved asks on each side.
- [ ] Baseline. Record trunk adapter median first.
- [ ] Rule. Head median less than or equal to trunk median, or within 10 percent if noise dominates. Fail if head is more than 25 percent slower.

**Review gate.** The operator reviews before merge.

- [ ] Copy lane 1 and lane 2 screenshots into `docs/plans/media/cursor-native-review-regression.png` and `docs/plans/media/cursor-native-review-no-bin.png`.
- [ ] Record a 30 to 60 second video of a native Cursor ask with `cursor-agent` off `PATH`. Save it as `docs/plans/media/cursor-native-review.mp4`.
- [ ] Post the screenshots and the video in chat. Stop at merge-ready. Wait for the operator's click.

**Merge.**

- [ ] Root's clean verdict at the exact head SHA.
- [ ] Bugbot triage done.
- [ ] Rebased onto current trunk after the verdict, patch-id unchanged.
- [ ] Operator lands after the review click.

## Close the program

- [ ] Every box above is checked with its evidence.
- [ ] Reply to the operator with the report the execution playbook names.

## Appendix A. Prototype evidence

Throwaway scratches. `/tmp/pi-x-sub-proto-66647` and `/tmp/pi-cursor-access-proto`.

- `cursor-agent --list-models` and `cursor-agent models` returned Cursor ids including `composer-2.5` and `claude-*`. Measured.
- `cursor-agent --print --mode ask --model composer-2.5` returned `pong` (also as JSON `result`). Measured. Wall about 7.3 to 7.7 s. API time in JSON about 2.6 s.
- Unknown model id exited 1 with `Cannot use this model` and listed available ids including `composer-2.5`. Measured.
- `claude-sonnet-5` exited 1 with weekly usage `ActionRequiredError`. Measured. Listed, then blocked by entitlement.
- Grok CLI `agent` listed only the four Grok Build ids and rejected `composer-2.5`. Measured.
- Cursor session JWT lives in the macOS keychain (`cursor-access-token` / `cursor-user`). Measured. `CURSOR_API_KEY` unset. IDE `cursorAuth/accessToken` is a different blob.
- With that JWT, `POST .../AvailableModels` returned 200 and 251 models. `GetUsableModels` returned 200 and 275 models. Measured. Includes `composer-2.5`, Claude, GPT, and Grok ids.
- `TestModelStatus` returned 200 with a canned answer that ignored the prompt. Measured. Not a user completion.
- `AgentService/RunSSE` without a Connect envelope returned a protocol error. With an envelope, the read timed out empty. Measured. User-prompt HTTP completion unproven.
- Grok Build and `~/.grok` bearers got 401 `ERROR_NOT_LOGGED_IN` on Cursor `AvailableModels`. Measured.
- Earlier session evidence (not remeasured here) showed `cli-chat-proxy.grok.com` remapping `composer-2.5` and 404ing a Claude id.

Still unproven until `cursor-native`. A minimal `RunSSE` body that returns the user's text. A server receipt that names the model id in the CLI JSON result. Distinct refresh grant behavior. Tool-using agent mode. Entitlement for the rest of the catalog beyond the models exercised here.

## Appendix B. Alternatives rejected

- One proxy for every model through `cli-chat-proxy.grok.com`. Rejected. The proxy remaps or rejects Cursor ids. Measured.
- One Pi provider id holding both tokens in a single credential. Possible in the type system, rejected for login and refresh UX. Pi stores one credential per provider id, and `/login` is one row per provider.
- A new package only for Cursor, leaving `pi-xai-oauth` forever. Rejected against the rename request and against one subscription product name.
- Shipping native chat HTTP before the `cursor-agent` adapter. Rejected. Catalog HTTP is proven. Chat HTTP is not. The hybrid keeps catalog native and chat on the CLI until `RunSSE` works.
- Treating `TestModelStatus` 200 as a completion success. Rejected. The body answered a different prompt than the one sent.
- Renaming `parity/pi-xai-oauth/` archives. Rejected. Those files are dated observations. Rewriting them breaks their own cross-links and helps no verify target.

## Appendix C. Risks

- No installed `control-cli` skill on this workstation. Live lanes must define their own terminal capture. Tracked in the boot recipe.
- npm has no rename redirect. Old installs keep `@justjoshn/pi-xai-oauth` until users change the install string. Mitigate with `npm deprecate` after the first publish of the new name. Lands after `rename` publish.
- Trusted publisher must be configured for `@justjoshn/pi-x-subscription-oauth` before `release.yml` can publish it. Operator registry step beside `rename`.
- Cursor quota and model-family gates can fail live lanes even when the adapter is correct. Lanes treat quota errors as environment signals when auth succeeded.
- `cursor-native` may discover Cursor protocol gaps that force keeping the adapter as fallback longer than one PR. If that happens, split a follow-up rather than blocking `cursor-adapter` value.
- Cursor session JWT today lives in the macOS keychain, not Pi `auth.json`. `cursor-adapter` must bridge that into Pi's credential model without printing the token. Tracked in `cursor-adapter` auth code.

## Appendix D. Links and reading list

- Plan inputs from explorers and local prototype notes under `/tmp/pi-x-sub-proto-66647/` and `/tmp/pi-cursor-access-proto/`.
- Pi extension API. `node_modules/.bun/@earendil-works+pi-coding-agent@1.5.0+b7b4099cc6b8d229/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts` (`ProviderConfig.streamSimple`, `registerProvider`).
- Prior art. `extensions/pi-antigravity-oauth/` custom stream. GitLab Duo `streamSimple` example in pi-coding-agent.
- Open usage PR. https://github.com/just-joshn/pi-customizations/pull/190
- Run `how` before `cursor-adapter` and `cursor-native` implementation. Run `interrogate` on the dual-provider auth design before `cursor-adapter` ships.
- Decision trail. Keep local under the agent store unless the operator asks to commit it via `show-me-your-work`.
