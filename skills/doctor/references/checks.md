# Doctor checks

Every check reads the inventory JSON first and touches files only after
confirmation. Field names below are inventory keys.

## Check 0: setup health

- **Installs.** `install.pi_on_path` lists every `pi` on `PATH` with its
  resolved target. More than one distinct target means the one that runs
  depends on `PATH` order. Report which wins and propose removing the others
  (for an npm global install, `npm -g uninstall <package>`). Several entries
  in `install.releases` besides the running `install.version` are leftover
  releases. Propose deleting the old release directories under
  `<agent-dir>/install/releases/`, never the running one.
- **Settings.** Any `settings` value other than `ok` or `missing` means Pi
  ignores that file wholesale. Report the parser error position as a warning.
  Offer a repair only if the user asks, since repairing means reading the file.
- **Packages.** A `packages` entry with `exists: false` means the inventory
  did not find its estimated checkout path. Confirm the actual installation
  through Pi before reporting a missing package. For a confirmed missing
  package, propose `pi update --extensions` to reconcile, or removing the
  declaration with `pi remove <source>` if the user no longer wants it.
- **Skills.** Compare `skills[].problems` with Pi's actual diagnostics before
  proposing a frontmatter repair. Quote only the offending frontmatter lines.
  Missing or empty descriptions and malformed declared skills prevent
  loading. Invalid names and oversized descriptions produce warnings but do
  not by themselves prevent loading. Pi falls back to the directory name
  when `name` is absent. The inventory's "name differs from directory" is a
  portability advisory; Pi neither requires a match nor warns about it.
  Report that advisory and "non-spec fields" in one line per file, and
  propose no change for them unless the user wants portability.
- **Collisions.** Each `collisions` entry is one name defined in several
  scanned places. Confirm that both copies are enabled and discovered by Pi.
  Actual Pi name collisions keep the first discovered and warn. Report the
  group and which copy is live (the `prompt.loaded_skills` location), and propose disabling
  the others (check 1 mechanics) or renaming one.

## Check 1: unused skills, extensions, prompts, and packages

For each resource the user installed, collect use in the window and its
always-resident context cost.

- **Skill use.** `usage.skills.<name>` counts `explicit` (`/skill:<name>`
  invocations) and `model_reads` (the model reading its SKILL.md). Either
  counts as use. Session files include subagent runs, so heavy delegation
  inflates counts. Say so when it matters.
- **Skill cost.** Only skills in `prompt.loaded_skills` are resident, at
  `chars / 4` est. tokens each. Explicit-only skills
  (`disable-model-invocation: true`) cost nothing until invoked. A zero-use
  explicit-only skill still gets a verdict, framed as decluttering, never as
  token savings.
- **Extension tools.** `prompt.tool_chars` gives each declared tool's schema
  size and `usage.tools` its call count. Built-in tools (`read`, `bash`,
  `edit`, `write`, `grep`, `find`, `ls`) are out of scope. Attribute each
  remaining tool to its extension or package by searching the package
  checkouts (the `packages[].dir` values) and `<agent-dir>/extensions/` for
  where it is registered.
- **Prompt templates and themes** have no usage signal. A zero is missing
  logging, not disuse. Still take a position (default: remove) and ask at the
  confirmation question: "Do you use <name>? If you don't recognize it, I
  recommend removing it. You can undo this later."
- **Signal strength.** When `usage.window` spans under 7 days, zero use is
  not disuse evidence, even when the install is that recent. Give zero-use
  items the verdict "too early to judge", keep them out of "Clean up
  everything", and offer them only through "Let me pick" as items the user
  confirms they don't use.

Verdicts: zero use in a window of at least 7 days, disable. Rare use but expensive, still take a
position with a one-line reason ("2 uses in 30 days for 600 est. tokens every
session, remove, re-enabling is one line" / "keep, used daily"). Never leave a
borderline case as "up to you". Leave alone only resources with real use in the
window and Pi's own built-ins.

Disable mechanics (every name and path below is harvested, so the ground rules
on untrusted strings apply):

- **Loose skill** (under `<agent-dir>/skills/`, `~/.agents/skills/`, or a
  path in the top-level `skills` setting): add `-<skill-dir>` to the top-level
  `skills` array in `<agent-dir>/settings.json`, where `<skill-dir>` is the
  directory of the `prompt.loaded_skills` location exactly as listed, without
  resolving symlinks. For a project skill, use `.pi/settings.json` only if it
  is untracked. Otherwise use the user file.
- **Package resource**: convert the package entry to object form and add an
  exact exclusion, keeping every other key:
  `{"source": "<source>", "skills": ["-<skill-dir>"]}`. Use `"extensions"`,
  `"prompts"`, or `"themes"` for other resource types, and `[]` to turn off a
  whole type.
- **Whole package**: `pi remove <source>`. It deletes only the declaration and
  checkout, and `pi install <source>` restores it. Prefer resource filters
  when the user uses part of the package.

## Check 2: user-level and local context file dedup

User-level files load in every project: `<agent-dir>/AGENTS.md` (or its
`AGENTS.override.md`, `CLAUDE.md` siblings). Local files are context files in
the project and its ancestors that `git ls-files` doesn't track, including
`AGENTS.override.md`. Checked-in files are tracked `AGENTS.md` and `CLAUDE.md`
files. `prompt.context_files` lists what the newest session loaded.

- Find guidance in user-level or local files that a checked-in file already
  covers, semantically, not just verbatim. Propose deleting the duplicate from
  the user-level or local file only, quoting each removal.
- A nested-directory context file loads only when Pi runs at or below that
  directory. Don't treat it as covering always-loaded guidance.
- User-level files and ancestor files load in other projects too. Only propose
  removing content that is clearly specific to this project, or say that the
  guidance would be lost everywhere else.
- Flag contradictions **only when they would materially change behavior**
  (conflicting package managers, opposite push or test policies). Quote both
  sides, say which you'd keep (usually the checked-in side, which the team
  reviews), and ask which wins. Apply the answer to the user-level or local
  file only.
- Leave blocks another tool manages alone (for example text between
  `<!-- ...:begin -->` and `<!-- ...:end -->` markers). Say which tool owns them.

## Check 3: trim derivable content from checked-in context files

A line a fresh session could reconstruct with a few tool calls (`ls`, reading
the manifest, `--help`) is dead weight every session pays for. Scan each
checked-in `AGENTS.md` and `CLAUDE.md` in the project, root first.

- **Cut, derivable from the codebase**: directory and file layouts; tech-stack
  and dependency lists the manifest already states; standard build, test, and
  lint commands or ones listed in manifest scripts; API signatures, types, and
  schemas copied from source; README-style architecture tours; generic best
  practices the model already follows; rules a pre-commit hook, linter, or CI
  already enforces (check their configs before cutting).
- **Keep, not derivable**: gotchas and failure contracts; design rationale;
  conventions that differ from language or tool defaults; agent directives and
  safety-critical prohibitions ("never push to main"); repo etiquette; domain
  glossaries; non-guessable commands (required flags, environment setup);
  pointers to context that lives elsewhere.
- **When unsure, keep it.** Never cut a "never do X" rule as generic.

Propose per file: categories cut with approximate line counts, est. tokens
saved, and what remains. Quote each removed block verbatim so the edit is
reversible from the report. Run this before check 4, and don't migrate
anything this check deletes.

## Check 4: move always-loaded guidance to lazy loading

Of the checked-in content that survives check 3, a root file is in context
every session. Scan it for guidance that doesn't need to be:

- **Subdirectory-only guidance** goes to `<subdir>/AGENTS.md`, which loads
  when Pi runs in that directory. Say that it does not load when Pi runs from
  the repo root, so it suits packages people open on their own.
- **Task-specific workflows** (deploy steps, release checklists, API
  references) become a project skill at `.pi/skills/<name>/SKILL.md` (or
  `.agents/skills/` for other harnesses too) with `name` and `description`
  frontmatter. Only the description stays resident.
- **Keep in the root file**: universal constraints, style that applies
  everywhere, and safety-critical prohibitions. Never move a "never do X" rule
  into a skill that might not load when it matters.

Propose the full migration set (source lines to destination file) with est.
savings.

## Check 5: context-heavy components (warnings only)

From `prompt.section_chars` and `prompt.tool_chars`, report est. resident
tokens by component: each context file (`prompt.context_files`), the skills
listing total, each non-built-in tool schema, and any `SYSTEM.md` or
`APPEND_SYSTEM.md` section. Call out the largest few. These figures come from
the newest session's real system prompt, so name that session and note that
the current settings may differ if they changed since.

## Check 6: project trust

`trust.stale` lists trust entries for directories that no longer exist.
Propose removing them from `<agent-dir>/trust.json`. Also report, without
proposing, a `defaultProjectTrust` of `"always"` in user settings. For projects
without a saved trust decision, it permits project resource loading without
asking. Extensions execute in Pi; skills supply instructions that may lead
the model to run supporting scripts through existing tools. Loading a skill
does not execute its scripts or register runtime behavior.

## Check 7: Pi version

- Installed: `install.version`.
- Latest: from `$HOME`, not the project, run
  `npm view @earendil-works/pi-coding-agent version --registry https://registry.npmjs.org/`.
  A project `.npmrc` could otherwise redirect the lookup. Use the result only
  for the comparison line. Skip the lookup when `PI_OFFLINE` is set, and if it
  fails, say the latest version couldn't be determined.
- Compare as semver. Up to date or ahead, one healthy line. Behind, propose
  `pi update` (Pi only) or `pi update --all` (Pi and packages).

## Verify

After applying settings or skill changes, confirm what Pi now loads with a
throwaway session, then rerun the inventory against it:

```bash
tmp=$(mktemp -d) && pi --print --session-dir "$tmp" "Reply OK only. Do not use tools." >/dev/null
python3 <skill-dir>/scripts/inventory.py --cwd "$PWD" --session-dir "$tmp" --days 1
```

Check that `prompt.loaded_skills` no longer lists disabled skills, that
`prompt.tool_chars` no longer lists disabled tools, and that `settings` still
reports `ok`. If a disable didn't take, revert that edit and report it.
