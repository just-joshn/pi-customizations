# Retained baseline corpus review

Deliver one clean-installable pi-pstack preserving official Cursor pstack behavior for unchanged prompts.

## Overview

**The retained corpus fails.** Pi violates the official public-source citation contract in all three `/poteto-help` attempts. Cursor supplies the required GitHub link. Pi supplies a disposable local path instead. The other twelve pairs satisfy the frozen behavioral assertions in the recorded attempts.

This is an independent review of all 15 retained pairs and all 36 model turns. It is not a new model run. This review did not change any attempt, prompt, assertion, implementation file, or source scope. The automatic summary remains 27 passing host attempts and three failing Pi host attempts.

The frozen rubric contains 66 assertions per host across the 15 pairs. Cursor passes all 66. Pi passes 63 and fails three. These are observed assertion judgments, not estimates of parity across models or inference settings.

The exact source contracts add a shared finding. All six `/bro` follow-ups keep the unexplained role labels `consumer` and `producer`. They are simpler than the preceding sentence, so the frozen simpler-language assertion passes. They do not fully meet the source's stronger no-jargon wording. This is shared reference behavior, not a Pi-only regression.

**Model comparability remains UNVERIFIED. Overall release parity and complete clean-install certification are not established.** Both official source trees remain in scope. This five-scenario corpus cannot pass their untested obligations.

The machine-readable review contains the unchanged assertion text, each host's judgment, and artifact locators for every pair in [`corpus-baseline-review.json`](corpus-baseline-review.json).

## Key concepts

### Verdict boundaries

A passing assertion describes the observed behavior in one retained attempt. It does not certify hidden host state or every future execution. Controls and missing coverage stay separate from those judgments.

The no-work assertions concern task execution. The runner and hosts still perform setup, model transport, session persistence, credential copying, and evidence writes. The review checked unchanged task files and every recorded model tool call. It did not run a whole-filesystem or network-effects monitor.

String presence is a precheck. For the help cases, the official source expressly requires its public GitHub copy. The missing substring is therefore relevant, but the verdict comes from reading the actual link target and source obligation.

### Evidence roots and locator rules

The retained run is under this directory.

```text
/Users/josh-desktop/src/personal/pi-customizations/.audit/pstack-release-2026-11-06/corpus-baseline-001/
```

Pair paths below are relative to that directory. Each host directory contains `result.json`, `turn-*-final.txt`, `turn-*.stdout`, process receipts, and before/after snapshots. Pi also retains `retained-session.jsonl`. `L` identifies a one-based physical line in a text or JSONL artifact. JSON pointers identify fields in a JSON artifact.

The official source roots are these directories at revision `2776ddd2355d6d6c8747d3964600f28daf62f049`.

```text
/Users/josh-desktop/src/experiments/plugins/pstack/
/Users/josh-desktop/src/experiments/plugins/cursor-team-kit/
```

The source checkout is clean for both roots. No team-kit workflow runs in these five scenarios. Its manifest and both alwaysApply rule contracts were read. Their unexercised behavior is not certified here.

## How it works

### Integrity and retained attempts

The review recomputed these SHA-256 values and matched them to the declaration and summary receipts.

| Artifact | Recomputed SHA-256 |
|---|---|
| `run-corpus.mjs` | `c07ea820ffdcb347b1680f3f34b6744389a89aa77d646ffcd90659785b0098ed` |
| `corpus.json` | `97711c1cb89de4321c663907ad85b137016f35c76eed76182012401c93de5831` |
| Packed `0.15.36-pi.20` tarball | `ce80efe79cf33fd1b4d0ee00d83f491f8b46e8d54057f0445a8c096647d25fdf` |
| `corpus-runner.test.mjs` | `b77f767c6c1a8df60d590aa79ddea305800f12119ce528aeb5646af8e221ce1a` |
| Retained `run-summary.json` | `d37d2891e94ce3353bb7b489ee10df82ef6468676e54d486858d78db21324088` |
| `artifact-manifest.json` | `a9b601c6533b0e9dcb41c85d990c092247e65231db1d7b62d09a0fc370495364` |

All 1,524 manifest entries match their current byte counts and hashes. The only unlisted run files are `artifact-manifest.json` and `run-summary.json`. The runner creates them after it builds the manifest. The external summary receipt hashes both. Pi, Cursor, and Node executable hashes also match `metadata.json`.

The declaration at `17:49:45.795Z` precedes the first recorded model process at `17:49:46.693Z`. All 15 declared pair directories remain. All 18 input artifacts match the corpus bytes. All 36 host invocation arguments match those inputs. The declared semantic assertions and automatic predicates match the current corpus exactly. Pair-embedded host results match the standalone results.

All 36 model processes finish with code zero, complete protocol endings, and no recorded model or tool error. Independent raw decoding agrees with every parsed and final-text artifact. Cursor makes three model-initiated reads. Pi makes nine. Every read targets a skill file. No model invokes a shell, writer, editor, delegate, subscription, or service tool.

All 30 task before/after snapshots agree with their raw Git outputs. They retain the same README, commit, tree, empty status, and empty diff. The README has 34 bytes and SHA-256 `bd0da14eab659e95f64741da3075b76154260455e050b8cfb3f6d7d0562af1b5`.

The offline command `node --test parity/pstack-release-2026-11-06/corpus-runner.test.mjs` passes all 12 tests. It invokes no models. It does not substitute for the semantic review.

### Every pair and frozen assertion

The assertion identifiers below map to the exact unchanged strings in the JSON review's `assertionCatalog`. Each pair has its own host-specific reasoning and locators there. Named final-text selectors resolve to physical line ranges in that pair's `namedFinalTextLocators`. A range such as `IYW-1` through `IYW-4` means each listed assertion passed, not a majority vote.

| Pair directory | Cursor | Pi | Independent judgment |
|---|---|---|---|
| `01-PROMPT-IN-YOUR-OWN-WORDS-r1` | PASS on `IYW-1` through `IYW-4` | PASS on all four | Both identify duplicate files and wasted space. Both preserve read-only safety. No tools or implementation. |
| `02-PROMPT-IN-YOUR-OWN-WORDS-r2` | PASS on `IYW-1` through `IYW-4` | PASS on all four | Pi describes identical-content groups and manual review. Its only tool rereads the invoked skill. No task-file change or delegation. |
| `03-PROMPT-IN-YOUR-OWN-WORDS-r3` | PASS on `IYW-1` through `IYW-4` | PASS on all four | Both retain the goal and no-deletion constraint. Pi names additional prohibited mutations. Neither starts work. |
| `04-PROMPT-SHARPEN-r1` | PASS on `SH-1` through `SH-7` | PASS on all seven | Both give the four considerations before the rewrite. They name primary bytes, source and syscall evidence, concrete tools, and external regression checks. Product choices stay open. |
| `05-PROMPT-SHARPEN-r2` | PASS on `SH-1` through `SH-7` | PASS on all seven | Both propose causal reproduction and byte-level validation. Pi adds a negative control without starting the investigation or choosing product policy. |
| `06-PROMPT-SHARPEN-r3` | PASS on `SH-1` through `SH-7` | PASS on all seven | Both rewrite the same output-loss task. Pi leaves required platforms, termination guarantees, and shutdown latency to the user. Only a skill read occurs. |
| `07-PROMPT-HELP-NO-WORK-r1` | PASS on `HELP-1` through `HELP-4` | FAIL on `HELP-3`. PASS on the other three. | Both recommend `/how`, give one adapted example, and only read its contract. Pi returns a local source link instead of the required public copy. |
| `08-PROMPT-HELP-NO-WORK-r2` | PASS on `HELP-1` through `HELP-4` | FAIL on `HELP-3`. PASS on the other three. | The Pi-first repeat has the same citation failure. Mentioning the single explainer route describes future `/how` behavior. It does not launch a delegate. |
| `09-PROMPT-HELP-NO-WORK-r3` | PASS on `HELP-1` through `HELP-4` | FAIL on `HELP-3`. PASS on the other three. | The third retained Pi source link is again local. No module investigation starts on either host. |
| `10-PROMPT-BRO-FOLLOWUP-r1` | PASS on `BRO-1` through `BRO-4` | PASS on all four | Both resume the prior session, simplify the supplied sentence, and retain holding the last line until the producer's end signal. Pi only rereads `bro`. |
| `11-PROMPT-BRO-FOLLOWUP-r2` | PASS on `BRO-1` through `BRO-4` | PASS on all four | Same observed relationship and signal ordering. `Done` and `finished` do not change the meaning. |
| `12-PROMPT-BRO-FOLLOWUP-r3` | PASS on `BRO-1` through `BRO-4` | PASS on all four | The retained Pi conversation directly links the setup assistant sentence, attached `/bro` request, and restatement. No tools run on either turn. |
| `13-PROMPT-NONTRIGGER-MENTION-r1` | PASS on `NT-1` through `NT-3` | PASS on all three | Both return exactly the 19-byte sentinel. No tools or observed activation. Pi has no attached skill or custom mode-state entry. |
| `14-PROMPT-NONTRIGGER-MENTION-r2` | PASS on `NT-1` through `NT-3` | PASS on all three | Pi-first order still gives the exact sentinel with no work. Hidden future persistent state is not probed. |
| `15-PROMPT-NONTRIGGER-MENTION-r3` | PASS on `NT-1` through `NT-3` | PASS on all three | The visible response is byte-identical again. No playbook output, todo, delegation, or task-file change appears. |

The four restatement assertions cover goal, safety, file effects, and implementation/delegation. The seven sharpen assertions cover professional additions, raw evidence, methods, external checks, rewrite ordering, product choices, and no execution. The four help assertions cover recommendation, example count, public citation, and no work. The four bro assertions cover context, simpler language, preserved meaning, and no effect. The three nontrigger assertions cover the exact sentinel, non-activation, and no effect.

The complete raw traces and snapshots support the negative-effect assertions. They do not prove arbitrary hidden host effects are impossible.

### Supplemental source-contract checks

The complete official skill text remains authoritative. The review did not stop at the frozen text heuristics.

| Source obligation | Pairs | Cursor | Pi | Evidence |
|---|---|---|---|---|
| Sharpen makes the same task deeper, not a broader product task. | `04`, `05`, `06` | PASS in each | PASS in each | Each final rewrite stays on output loss and its causal validation. No redesign or implementation starts. |
| Help reads the routed skill before recommending it. | `07`, `08`, `09` | PASS in each | PASS in each | Both hosts complete a `how/SKILL.md` read before the final answer in every repeat. |
| Help leads with the answer, gives one adapted code-block prompt, and ends with the source link. | `07`, `08`, `09` | PASS in each | PASS in each | The separate public-link obligation still fails on Pi. Formatting order does not excuse the wrong target. |
| Bro removes jargon, not merely some jargon. | `10`, `11`, `12` | FAIL in each | FAIL in each | Every follow-up retains unexplained `consumer` and `producer` roles. Source `bro/SKILL.md:3,7` requires no jargon. |

### Defect in all three help attempts

The official source at `pstack/skills/poteto-help/SKILL.md:13` requires the file's public copy under `https://github.com/cursor/plugins/blob/main/pstack/`.

The archived Pi file at `package/skills/poteto-help/SKILL.md:13` instead says to give the file's full installed package path. The packed file has SHA-256 `9bbf06ca32c1a089a45ce4b3cf59997e3a61c0154cd625494cf8225d1ef16b84`. The actual attached payload matches that archive body in all three Pi sessions. It is visible at `retained-session.jsonl:L5` in each help directory.

Every Cursor answer links this public file.

```text
https://github.com/cursor/plugins/blob/main/pstack/skills/how/SKILL.md
```

Every Pi answer instead links its own ephemeral installed file under `/private/var/folders/.../pi/dist/package/skills/how/SKILL.md`. The disposable outer directory is absent at review time.

| Pair | Cursor read and final records | Pi read and final records | Source-link output |
|---|---|---|---|
| `07-PROMPT-HELP-NO-WORK-r1` | `cursor/turn-1.stdout:L86-L89` | `pi/turn-1.stdout:L86-L87,L241-L244` | Last line of each host's `turn-1-final.txt`. |
| `08-PROMPT-HELP-NO-WORK-r2` | `cursor/turn-1.stdout:L85-L88` | `pi/turn-1.stdout:L84-L85,L242-L245` | Last line of each host's `turn-1-final.txt`. |
| `09-PROMPT-HELP-NO-WORK-r3` | `cursor/turn-1.stdout:L3-L6` | `pi/turn-1.stdout:L86-L87,L255-L258` | Last line of each host's `turn-1-final.txt`. |

This is a real source-contract failure and a semantic citation difference. It is not an invalid automatic assertion. Normalizing an absolute installation root does not turn a filesystem link into a public HTTPS source link.

The source substitution explains the observed outputs, but this review did not perform a live causal intervention. Matching model names are not needed to establish that the packed instruction contradicts the official contract.

The maintainer needs to preserve the public-source obligation in the port. A local installed path may supplement it, not replace it. No repair was made here. All three automatic failures remain in their original `result.json` files and the summary.

### Source locator drift

The frozen help source string includes lines `191-193`. The frozen nontrigger string includes lines `171-174`. The pinned official file's final reply instruction is at line 163. Those later ranges do not exist in the pinned text.

The actual applicable wording is at help lines 9-13, 42, 64-71, 145, and 163. This is a citation metadata defect. It does not invalidate the public-source assertion, which is explicit in the already-cited lines 9-15. The original corpus locator bytes remain unchanged. The review records the resolved locations rather than editing executed assertions.

### Credential-cleanup evidence

All 30 host results retain the same cleanup receipt. Each says that the copied credential was removed, its mode was `0600`, the runner did not change the source, and the private profile was not retained as evidence.

The runner's `runHost` cleanup removes the private copy and checks `ENOENT` with `lstat`. Its outer cleanup awaits removal of the disposable root before it writes `cleanup.json`. The retained run receipt reports successful removal. A review-time existence check also finds this outer directory absent.

```text
/var/folders/11/m_kwnqr97632l_cjt0mhytvh0000gn/T/pstack-corpus-GR9enK
```

No auth file or secret was opened for this review. The checks used sanitized receipts, runner code, manifest paths, artifact hashes, and the outer directory's absence.

The source-unchanged claim is supported by code inspection and receipts, not by an independent before/after read of private credentials. The review cannot certify that another process never modified source credentials. It also does not claim that redaction logic proves the absence of every possible secret value.

## Where things live

- [`../corpus.json`](../corpus.json) retains the exact prompts and assertions.
- [`../corpus-baseline-summary.json`](../corpus-baseline-summary.json) retains the execution counts, automatic failures, digest bindings, and original unknown controls.
- [`../run-corpus.mjs`](../run-corpus.mjs) declares attempts, sets up isolated hosts, records events and snapshots, and retains credential-cleanup receipts.
- [`corpus-baseline-review.json`](corpus-baseline-review.json) records all 132 frozen host-assertion verdicts, supplemental source checks, per-pair raw locators, defects, cleanup limits, and open controls.
- The raw run directory contains `intent.json`, `metadata.json`, `artifact-manifest.json`, `run-summary.json`, `cleanup.json`, and all 15 pair directories.
- The earlier `prompt-first`, `prompt-retry`, `model-preflight`, and `cursor-auth-preflight` directories remain beside the raw run. This review did not alter or discard them. They are outside the baseline manifest and were not independently rejudged as acceptance pairs.

## Gotchas

### Model and request comparability

| Control | Recorded evidence | Remaining limit |
|---|---|---|
| Selected model and reasoning | Cursor requests `gpt-5.6-sol-medium` and reports `GPT-5.6 Sol 272K Medium`. Pi requests `openai/gpt-5.6-sol` with `--thinking medium` and reports `openai-responses`, `gpt-5.6-sol`, and medium. | Names and labels do not prove the same provider route, build, weights, or alias. |
| Sampling and reasoning budget | Both hosts record the named medium selection. | Temperature, top-p, seed, and provider-side reasoning budget are not established. |
| Context and output limit | Cursor reports 272K. Pi's static catalog reports 272K context and 128K maximum output. | These do not prove equal effective limits on actual requests. Cursor's effective output cap is unknown. |
| Prompt bytes and expansion | All input files and invocation arguments match. All twelve explicitly invoked Pi skill bodies match the archive. | Full Cursor skill expansion, system instructions, tool schemas, and provider requests are not exposed. The Pi stored system message has empty `content` and separate `sections`, not a captured wire request. |
| Order and repetition | All three repeats per scenario remain. Successive host order alternates. | Three repeats on one selected family do not establish behavior across models or settings. No timing comparison is claimed. |
| Follow-up state | All bro setup sentences are exact. Session IDs and resume arguments agree. Pi's retained conversation preserves the parent sequence. | The provider's complete hidden context is not captured on both hosts. |
| Mention-only state | Exact sentinels, no tools, no Pi skill attachment, and no stored custom mode entry. | No later-turn or restart probe tests hidden persistent state. Cursor's internal mode state is not exported. |
| External effects | Unchanged task files and only skill reads in every recorded model action. | No whole-filesystem, process-tree, or network-effects monitor. |

The visible nontrigger behavior passes. The full statement that installation changes nothing until invocation is not established by these cases. Pi stores pstack host instructions and added tools even for the mention-only prompt. That context difference is not itself proof that a playbook or sticky mode activated.

### Installation and release coverage

All 15 Pi setups use the same packed `0.15.36-pi.20` artifact. The runner extracts it, installs only runtime dependencies, and calls ordinary `pi install` on the extracted package. Every setup completes. The retained runtime manifests agree with the reported dependency-tree digest. They contain none of the prohibited dev or host-peer package roots.

This is useful installed-artifact evidence. It does not exercise direct registry installation, a tarball URL install, Linux, the declared minimum Node version, or every package entry point. Pi itself is preinstalled. The run covers macOS arm64 on Node 24.22.1.

This corpus exercises no actual `/how` delegation, poteto-mode task workflow, team-kit workflow, code mutation, cloud task, approval gate, shell lifecycle, media delivery, mode transition, MCP integration, or live service effect. Those remain open release controls. Neither official source tree has been removed from scope.

The retained failed baseline is useful evidence. The public-source defect needs a source-preserving repair and later verification under a separately declared run. This review does not authorize changing these executed prompts or assertions.

### Principles that changed this review

**Prove It Works.** The verdicts use exact source text, raw events, retained sessions, and task snapshots rather than accepting the automatic pass count.

**Explain the Number.** The report separates automatic host-attempt results, semantic assertion results, shared source shortfalls, and unknown inference controls. None becomes an overall parity or speed claim.
