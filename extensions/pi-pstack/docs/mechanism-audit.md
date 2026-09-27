# Pi mechanism audit

This audit checks the repository against the Pi facility boundaries supplied for this change. The baseline is commit `91946b769c398ddd66cef9a085c600f05ba61fa6`, with 401 tracked files. Pi 0.87.1 is the installed verification target. Current documentation is at [pi.dev](https://pi.dev/docs/latest).

## Work plan

- [x] Read the Principles section of Poteto Mode.
- [x] Phase A: Frame. Inventory every tracked area and record the existing verification baseline.
- [x] Phase B: Design the workflow. Partition runtime, generated resources, and standalone skills. Compare native prompt aliases with duplicated workflow bodies.
- [x] Phase C: Run the loop. Reproduce violations, fix their owning facility, and verify each change.
- [x] Phase D: Keep the audit trail. Record decisions and evidence in `mechanism-decisions.tsv`.
- [x] Phase E: Verify and hand back. Run resource checks, type checks, tests, real CLI checks, and independent review.

The finish predicate is no unresolved identified mechanism violations, preserved executable capabilities, and passing checks on the resulting package. It does not imply identical decisions from different language models or restore unavailable Cursor services.

The throughput checkpoint uses three independent audit slices. Runtime cleanup and resource generation receive separate regression checks before the combined package check. Bulk generated files come from the generator. Source archives remain hash-verified evidence.

The final verdict is VERIFIED for the identified mechanism corrections and the stated deterministic checks. No identified mechanism violation remains unresolved. Full Cursor behavioral parity remains unverified for the explicit limits below.

## Design decision

Plain workflow aliases become native prompt templates that ask the model to read the corresponding skill. The package extension supplies the installation-specific skill root in its host context. SDK workers receive the same root in their host instructions, including readonly workers whose extensions are disabled. If that host context is unavailable, the prompt reports the missing resource. This keeps full skill instructions on demand and preserves relative references.

The alternative copies complete skill bodies into every prompt template. It duplicates the instructions and still needs an installation-specific base for references. Native template argument substitution could also alter dollar expressions inside bundled examples. The audit rejects that alternative.

`/bro` contains only reusable prompt text, so it becomes a prompt template without a duplicate skill. `/poteto-mode`, `/setup-pstack`, and `/pstack` retain executable command handlers because they change state, run dialogs, or inspect runtime state.

Package-wide team-kit rules remain extension-injected system sections. A context file inside the installed package would not apply to unrelated working directories. The extension explicitly supplies these package rules; Pi does not discover the archived Cursor `.mdc` files as context resources.

## Verification baseline

Before changes, resource verification passed for 187 source files and 143 generated skill resources. Type checking passed. All 28 tests passed. The real Pi CLI loaded the package and passed the RPC command, status, mode-off, and shutdown checks.

## Findings and final evidence

| Finding | Correction | Evidence |
| --- | --- | --- |
| Pure text aliases registered as extension commands | Generate 63 native prompts; retain only mode, setup, and status commands | Resource and SDK integration tests; CLI checks assert each command's source |
| `bro` represented as a skill despite containing only a reusable prompt | Preserve its full text in `prompts/bro.md`; retire `/skill:bro` | Generator migration test and actual provider request for `/bro` |
| Cursor-only mode, icon, color, reminder, and path fields in generated skill frontmatter | Remove unsupported active fields; retain original archived bytes | Resource classifier test and source hash verification |
| Native mode/setup handlers act when the corresponding skills are disabled | Require the matching discovered skill before handling `/skill:` | Failing-then-passing SDK regression with skills disabled |
| Pasted skill XML activates mode or setup outside the native command path | Remove obsolete expanded-block input handlers; treat examples as ordinary user text | Failing-then-passing pasted-block regression, with native and extension invocation tests retained |
| Shutdown overlooks children still being constructed or overlapping cleanup | Track pending starts and share cleanup completion; stop accepting tasks during shutdown | Worker lifecycle regression |
| Child SDK loaders do not receive the newly separated prompt resources | Supply explicit prompt paths and bundled skill-root context to child loaders | Worker resource and prompt expansion checks |
| Doctor implies a questionnaire tool exists, conflates skill loading with execution, and mistakes inventory approximations for Pi discovery | Clarify optional extension tools, trust, validation warnings, portability, and authoritative discovery | `skills/doctor/SKILL.md`, `skills/doctor/references/checks.md`, installed Pi loader and source |

## Repository coverage

The audit covers all 401 tracked baseline files. Ignored dependency installs and local machine caches are not project-authored resources. Installed Pi declarations and implementation were consulted to verify host contracts.

| Area | Baseline files | Classification and review |
| --- | ---: | --- |
| Standalone skills | 28 | Five instruction skills, four support scripts, references, examples, and tests. Scripts run through existing tools and do not register Pi behavior. All five load without diagnostics. |
| Root configuration and license | 4 | Repository context, Git configuration, and license. No invented Pi API or manifest. |
| Preserved source bundles | 187 | Immutable upstream provenance, including dormant automations. Excluded from direct resource discovery; explicitly read persona and rule files are extension inputs. Hash inventories cover every file. |
| Generated active skills and support | 143 | Each skill classified by its instructions. One pure prompt moved; other workflows, principles, references, scripts, and assets retain their instruction role. |
| Runtime and tests | 9 | All four runtime modules and five test files inspected. Eight model tools, three runtime commands, SDK children, branch state, UI, and model-role configuration use supported integration points. |
| Generator and CLI verifier | 2 | Source hashes, resource mapping, manifest registration, native template discovery, and installed-package verification. |
| Package configuration and documentation | 28 | Six package-level files and 22 documents. Current README, architecture, parity, and verification describe the corrected implementation. Prior designs, reviews, work plans, and decision logs are historical evidence. |

The original design and team-kit documents record earlier 47- and 65-skill implementations. This audit supersedes their current-behavior claims while retaining those records. Their reported historical measurements are not new verification results.

## Facilities that remain correctly placed

`Task`, `TaskOutput`, `TaskMessage`, and `TaskStop` expose real model tools through extension registration. Their child agents embed Pi through the SDK. Todo state, sticky mode, questions, and workspace context are also executable extension behavior. Session-only state follows the active branch through custom entries and tool details. Model-role preferences span sessions in extension-owned external storage.

The two team-kit rules are injected by the extension because they apply with the package enabled in any workspace. They are instructions, not compiler enforcement. Skill scripts remain supporting executables invoked through existing tools. `pstack/models.mdc` selects existing models; it is not a provider protocol or a replacement for `models.json`.

No theme or custom provider is required by the package. The RPC script is an external test client, not a discovered customization resource. `package.json` distributes extensions, skills, and prompts through Pi's actual resource keys. `docs/resource-map.json` is project maintenance data and is never presented as an official Pi mechanism manifest.

## Parity and limits

All 65 workflow entry points, 23 playbooks, eight tools, five canonical personas, and 17 model roles remain available. The Comment Sicko alias remains available in addition to its canonical persona. All 187 original files are preserved. Full skill text remains available through native `/skill:name`, except the intentionally retired `/skill:bro`, or an instructed read from a prompt alias.

An alias now relies on the model to read its skill, which is the normal instruction mechanism. Tests cannot promise the same decisions from every model. Native templates also use Pi's argument parsing. The pre-existing Cursor cloud, scheduling, service, credential-isolation, and model-entitlement limits in [parity.md](parity.md) remain. No numeric claim of 100% behavioral parity is made.

The high-rigor checks combine failing-before-fix regressions, real SDK sessions with a deterministic provider, and a real CLI process.

## Final verification

| Check | Result |
| --- | --- |
| `npm run check:resources` | 187 unchanged source files and 205 generated files verified |
| `npm run typecheck` | Passed against Pi 0.87.1 |
| `npm run test:coverage` | 38 tests passed; 93.31% lines and statements, 80% branches, 98% functions |
| `npm run check:cli` | Real Pi RPC loading, native command sources, status, mode-off, and shutdown passed |
| Standalone script tests | `python3 -m unittest discover -s skills/reverse-engineer-cli/tests -v` passed all nine tests |
| Standalone skill discovery | Official Pi loader found all five root skills with zero diagnostics |
| Distribution | Packed artifact contains 431 files, including all 187 source files and 205 generated resources. Extracted-package resource verification and real CLI checks passed. |
| Patch checks | `git diff --check` passed |

Coverage uses pinned `c8` 12.0.0 with source maps and includes every `src/*.ts` file. The command enforces an aggregate minimum of 80% for lines, statements, branches, and functions. The original Node 26.10.0 built-in report marked setup code uncovered in the combined run even though the isolated model tests reported 96.15% lines. Its initial combined report was 73.11%. The reporter was changed after that discrepancy, and behavior tests were added for actual extension setup, question dialogs, task messages, cancelled waits, invalid todos, and bounded transcript output. The old 91.73% historical coverage number is not used as evidence for this change.

The model in these tests is a deterministic fixture. UI tests use real Pi dialog APIs with scripted answers. They do not prove terminal rendering or a live external RPC client's dialog implementation. The real CLI check exercises the RPC process without model calls. Original helper scripts are unchanged and their previous test results remain historical evidence.

## Independent review

Separate reviewers examined runtime ownership, generated resources, all standalone skills, and the combined diff. Independent review reproduced missing child prompt discovery and overlapping shutdown completion; both were fixed and retested. The final input review identified the obsolete XML handlers, which were removed after a failing regression. The Comment Sicko review found no added comments or suppressions requiring action.

An independent reviewer reran the final coverage command and reproduced all 38 passing tests and the same aggregate percentages. There were no remaining blocking review findings. Model the Domain shaped explicit worker lifecycle ownership. Prove It Works required real SDK requests, actual resource loading, and an extracted-package CLI check.

All available reviewer models were in the GPT family. Cross-family review requested by the source workflow was unavailable and is not claimed. The decision trail's first two date-only placeholder timestamps are explicitly superseded by a later clock-stamped correction. Transcript evidence consists of this run's tool results and retained test artifacts; no separate exported conversation file was available for an additional transcript-file audit.

The [decision trail](mechanism-decisions.tsv) uses paths relative to `extensions/pi-pstack` unless a path is absolute. Temporary coverage outputs are local execution artifacts; the commands and result tables in this report are the durable reproduction record.

## References

- [Pi extensions](https://pi.dev/docs/latest/extensions) defines runtime registration, lifecycle, concurrency, state, and UI boundaries.
- [Pi skills](https://pi.dev/docs/latest/skills) defines discovery, explicit invocation, metadata, and supporting files.
- [Pi prompt templates](https://pi.dev/docs/latest/prompt-templates) defines reusable input expansion.
- [Pi packages](https://pi.dev/docs/latest/packages) defines distribution and resource registration.
- Installed `@earendil-works/pi-coding-agent` 0.87.1 declarations and implementations establish the tested API behavior. Context7 did not return the official project, so primary documentation was used directly.
