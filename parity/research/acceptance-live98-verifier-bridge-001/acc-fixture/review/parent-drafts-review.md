# Review of the parent draft ledgers

Status: DRAFT. Reviewer: independent acceptance owner, `claude-opus-5-5` via `claude-subscription`, reasoning `high`, read from this session's runtime variables.

## Inputs reviewed

Paths are relative to the parent `parity/` directory. Hashes were computed in this session.

| File | sha256 |
| --- | --- |
| contract.md | ffb66225c10486e861d79f60415138fd79cc2fa8e6794825b2124998924c4f6f |
| source-lock.json | 6d94d96a35a08e67207f9ef18735611d6dcf4b26b855f2ca10099802575e0796 |
| dependencies.json | 219066de39a6e3a06e7f04cef4a5bd7c3e0cc3d8ac7972f35555a4e45eb7c4b2 |
| requirements.json | 3537a42fd41207c2ff8fd8ec87b4fb4e9508aada56c08b2a053ea195de9b2045 |
| configurations.json | d2c146c89f528ed67fa7bcc54147133014b16655c4f605e3bbf7991e0a252743 |
| scenarios/setup-budget-labels.json | 934cbf8f820ea156788f169fe1b37c7c7c09653570ad27d698d3f172c009e51c |
| mismatches.json | 37d38568d3cef3d2513b22674aecb91e010958412fc79b0cc08877d80daf367f |
| progress.md | 509879c874bd265fa5708e5686f19ac58ecef91815e7babcffe21668766aa114 |
| reference/cursor-plugins/pstack/skills/setup-pstack/SKILL.md | d61b47256a18155a81c8e5ef95e3cc6569ce8c18317c35c4dd9c8015cf68cb59 |
| reference/cursor-plugins/pstack/README.md | 7f39feae81103e18b567e1fa5075cba86425cf4697a01be66a7422ef93c2c855 |
| reference/cursor-plugins/pstack/docs/guide/01-setup.md | 86d0330f245d16254a2069955f993c15d96cf29cd1a73690a0164074b7ac1190 |
| reference/cursor-plugins/pstack/skills/poteto-help/SKILL.md | ea71bcb15c023a5d9cc70686e4812144687ffe03bf80d85cc480af3e0b181d1e |
| evidence/cursor-first-run/04-setup-running.txt | 991402bbcbb8bde142758c398feb31942a0f8e4836681f5bf3770b3f8d686950 |
| evidence/candidate-baseline/01-setup-discovery.txt | fd4de1296c1788b0cb25306b539730563b328edd5e39b072daa7397eee3e0d1c |
| evidence/candidate-baseline/02-setup-selected.txt | 8b272ac7515ed0cb0f32fc00cf026fba6ac6c231fdb2a14ad925c5b244f950d4 |
| evidence/candidate-baseline/actions.txt | 5e4297ad693c7914b26d61eddff56bd45e761f4c0bca8a85eaa70338bea0cb83 |

A change to any of these inputs makes the matching finding below stale until it is re-reviewed.

## Confirmed

- The reference checkout HEAD is `ccb5507cec1546dc88135c1139c811e6c59115ba`. `git ls-files` gives 164 pstack files and 29 cursor-team-kit files. The setup SKILL.md, README.md and plugin.json hashes match `source-lock.json`. Measured in this session.
- The README hash cited by both mode drafts and the setup hash cited by both setup drafts are correct. Measured.
- The expected label `unlimited — max reasoning` and the candidate label `unlimited — keep max` in mismatch SETUP-BUDGET-UNLIMITED-LABEL match the source line 24 and the candidate screen. Measured.
- The `included_usage` capture shows a failure. It is correctly recorded as an open account-owner prerequisite and not as a success. Measured.

## Findings needing correction

R-01. PSTACK-SETUP-BUDGET-LABELS-001 bundles three independently falsifiable behaviors. Split into exact labels, naming the current budget, and the no-rule note that large matches the defaults. These are ACC-SETUP-030, ACC-SETUP-032 and ACC-SETUP-033.

R-02. PSTACK-SETUP-MODEL-DISCOVERY-001 omits the empty-detection paste request, the entitlement-listing preference and alias validity. Its expected observation, that slugs are detected before choices are written, has no user-visible check. Use ACC-SETUP-010 through ACC-SETUP-013 and ACC-SETUP-060.

R-03. The mode drafts read only README line 91. Guide line 60 adds that a one-message attachment fades as the chat moves on and that the custom mode stays until exit. README line 91 also gives three behaviors with no draft. These are staying out of the way when no playbook matches, opting out by saying so, and exiting the mode. Each needs its own requirement. The one-message expected observation, "Skill attaches to one message only", is not observable as phrased.

R-04. The candidate capture shows `tmux extended-keys is off. Modified Enter keys may not work.` Any Option+Enter or Alt+Enter journey run under that terminal setup is invalid evidence for PSTACK-MODE-STICKY-001. Make extended keys a recorded precondition of that scenario.

R-05. Scenario setup-budget-labels action 2 has no expectation. The preliminary Cursor capture shows the first Enter closes the menu without submitting and a second Enter submits. Encode both Enters as literal actions per ACC-SETUP-002 and keep the observation open for repetition.

R-06. Scenario setup-budget-labels action 3 asks to observe detection and loading, which a user cannot see directly. Replace it with the observable consequences in ACC-SETUP-012, ACC-SETUP-032, ACC-SETUP-033 and ACC-SETUP-051.

R-07. The scenario says live catalogs are available in both environments. Fallback and needing-a-choice outcomes depend on the detected set, so paired runs need detected sets that map one to one under the reviewed host translation. Otherwise the two sides legitimately differ. The fixture digest is still null.

R-08. The scenario uses `installed-user` for both hosts, but the Cursor rule records `small (medium)` and the Pi rule records `unlimited (max)`. A pair under that id compares different starting states. Apply one rule snapshot to both sides, as `rule.installed-user` does in this partition.

R-09. The Cursor first run used the real user home. A successful model-backed setup there would overwrite `~/.cursor/rules/pstack-models.mdc` with sha256 `bcbb7853f54efdd4ff32d010dccd79517ee1e4c0b80d34b2c81356b548954b25`, which is account-owner configuration. Reference runs need an isolated home or explicit owner approval with a byte-exact backup and restore.

R-10. The candidate reached the budget selector while showing `No models available`. Source step 1 asks the user to paste slugs when none are detected, before any budget question. Record this as its own mismatch against ACC-SETUP-012. This is a single unpaired candidate capture.

R-11. The candidate slash menu shows two rows, `setup-pstack` and `skill:setup-pstack`. The Cursor capture shows one `/setup-pstack` row. Record a mismatch against ACC-SETUP-001. Single unpaired captures, terminal widths not recorded for the candidate.

R-12. The candidate opened the budget selector on the first Enter. Cursor needed two Enters. Record an interaction-count mismatch against ACC-SETUP-002. Single unpaired captures.

R-13. The candidate selector shows no current-budget name and no note that large matches the defaults. The candidate fixture's rule state was not recorded, so it is unknown whether ACC-SETUP-032 or ACC-SETUP-033 applied. Record the fixture rule bytes with every setup capture.

R-14. Mismatch SETUP-BUDGET-UNLIMITED-LABEL says source inspection shows unlimited leaves effort unchanged. That is a diagnosis from candidate code. Keep it as a diagnosis and judge it against ACC-SETUP-040 and ACC-SETUP-042, not as an acceptance statement.

R-15. Static reading of baseline `78dd5a04279436ebf6dde44853bacdab88ca9ae0` finds `judgment = 'claude-opus-5-5-max'` at `extensions/pi-pstack/src/models.ts` line 13 and `claude-opus-5-5-max` as the prose and judgment default in `extensions/pi-pstack/skills/poteto-mode/SKILL.md` line 92. The reference default is `claude-opus-5-5-xhigh` in setup SKILL.md lines 53-65 and poteto-mode SKILL.md line 95, and the guide says the defaults run at xhigh. This predicts failures of ACC-SETUP-020, ACC-SETUP-040 and ACC-SETUP-074 under budget large. The prediction is a guess until a candidate run shows it. Eight translated skills contain the `-max` string and need the same check.

R-16. The same file at line 245 writes comment lines that differ from the reference shape, and substitutes `max` in the budget line when the chosen budget has no target effort, which is the case for its unlimited entry at line 37. The reference shape comment text is pending variation capture under ACC-SETUP-074, so the comment difference is a likely mismatch, not a confirmed one. If the R-14 diagnosis holds, the file would say `# budget: unlimited (max)` while role slugs keep other efforts, which fails ACC-SETUP-040 even though the budget line itself matches ACC-SETUP-071. This is a guess from static reading.

R-17. The Pi host contract adds a project-level role rule override. No setup source establishes a project rule. Under contract section 4, an implementation behavior must trace to a source requirement. Either trace it to a reference host behavior or remove it. ACC-SETUP-070 forbids setup from writing a project rule.

R-18. `dependencies.json` lacks the setup closure. Missing nodes or edges are create-verification-skill from step 7, the Cursor AskQuestion and Task host built-ins from steps 1 and 3, the guide page and poteto-help as user-facing sources, and the consumer skills that read the rule. Those consumers are poteto-mode, how, why, arena, architect, interrogate, reflect and swarm.

R-19. The contract anchor names revision `d0ef80d86795816da932a153458c5dbe192d294e`. The lock uses `ccb5507cec1546dc88135c1139c811e6c59115ba`, committed 2026-10-07T17:45:14-07:00. This review did not check upstream main, so whether ccb5507 is current remains unverified here.

R-20. `requirements.json` sets `acceptanceDefinitionOwner` to null and `configurations.json` sets its owner to null. Point both at this partition and record the manifest sha256 as the acceptance-definition hash once the parent accepts the governance in README.md.

## Not found

No draft claims a pass. No draft counts the `included_usage` failure as success. No draft shrinks the denominator.
