# Fact-check: pi-pstack 0.15.34 upstream move

**Worktree:** `/Users/josh-desktop/src/personal/pi-customizations-wt/pi-pstack-0.15.34`  
**Package:** `extensions/pi-pstack`  
**Upstream clone:** `/tmp/cursor-plugins`  
**Claimed pin:** `519d36aa98955bf680db01bcde5fdfba686dc901`, pstack `0.15.34`, team-kit `1.2.0`  
**Method:** filesystem + `git show` / `git diff`; independent hash rebuild via `evidence/fact-check/verify-lock.mjs` (reuses exported transform helpers only as code under test, not lock content as authority). Official `sync-upstream.mjs --check` run as corroboration only.  
**Date:** 2026-10-27

## Final verdict: **VERIFIED**

All eight required checks **PASS**. No corrected numbers vs the claimed pin / counts used in this bump (579 lock files; transforms none 517 / frontmatter 61 / patch 1; 62 loaded skills; 57 hidden; 5 invocable).

---

### Check 1 — SOURCE / lock source vs claimed pin and plugin.json versions

**PASS**

| Field | `SOURCE` (`scripts/sync-upstream.mjs`) | `upstream.lock.json` `source` | Claim |
| --- | --- | --- | --- |
| repository | `https://github.com/cursor/plugins` | same | match |
| commit | `519d36aa98955bf680db01bcde5fdfba686dc901` | same | match |
| pstackVersion | `0.15.34` | same | match |
| teamKitVersion | `1.2.0` | same | match |

At that commit:

- `git show 519d36aa…:pstack/.cursor-plugin/plugin.json` → `"version": "0.15.34"`
- `git show 519d36aa…:cursor-team-kit/.cursor-plugin/plugin.json` → `"version": "1.2.0"`

Lock `files.length` = **579**.

---

### Check 2 — Every `lock.files` entry: disk + rebuild hashes/modes

**PASS**

Independent verifier: `parity/pi-pstack-0.15.34/evidence/fact-check/verify-lock.mjs`  
Result: `verify-lock-result.json`

For all **579** entries:

| Assertion | Result |
| --- | --- |
| Disk bytes sha256 == `targetSha256` | 0 mismatches |
| Disk exec bit ↔ `mode` (`100644` / `100755`) | 0 mismatches |
| `git show <commit>:<source>` sha256 == `sourceSha256` | 0 mismatches |
| Rebuild (`none` / `frontmatter` via `normalizeFrontmatter` / `patch:*` via `patches.json`) sha256 == `targetSha256` | 0 mismatches |
| Declared `transform` == rebuilt transform | 0 mismatches |
| Disk == rebuilt bytes | 0 mismatches |

Transform breakdown re-counted from lock: **none 517**, **frontmatter 61**, **patch:worktree-audit-pi-transcripts 1**.

Corroboration: `node scripts/sync-upstream.mjs --source /tmp/cursor-plugins --check` → `upstream check passed: 579 files match 519d36aa…` (exit 0).

---

### Check 3 — Authored-only extra file

**PASS**

- `AUTHORED` / `lock.authored` = `['skills/create-skill/SKILL.md']` only.
- File exists on disk.
- Not present in `lock.files` (`create-skill in files` = false).

---

### Check 4 — No unexpected files under skills/agents/automations/docs/licenses

**PASS** (with noted non-file exceptions)

Walk of those five trees: **0** files that are neither in `lock.files` nor authored.

Noted (allowed by the check wording):

- `node_modules: skills/poteto-mode/scripts/node_modules`
- `empty dir: skills/statechart/scripts/model`

---

### Check 5 — Skill counts (loadSkills + SKILL.md frontmatter)

**PASS**

| Metric | Count | Names / note |
| --- | --- | --- |
| Dirs with `skills/*/SKILL.md` | **62** | includes ketchup-video, statechart, create-skill, team-kit trio |
| `disable-model-invocation: true` (hidden) | **57** | matches README “57 pstack skills stay out…” |
| Invocable (not hidden) | **5** | `control-cli`, `control-ui`, `create-skill`, `deslop`, `setup-pstack` |

`loadSkills({ skillPaths: [package/skills], includeDefaults: false })` from `@earendil-works/pi-coding-agent` returned `{ skills }` with **loaded 62 / hidden 57 / invocable 5** — same set.

---

### Check 6 — package.json version and README pin text

**PASS**

- `extensions/pi-pstack/package.json` `"version"`: **`0.15.34-pi.1`**
- README states pstack **0.15.34**, cursor-team-kit **1.2.0**, and pins `cursor/plugins@519d36aa` (short of claimed full SHA) with regenerating against that tip — consistent with `SOURCE`.

---

### Check 7 — `src/` HostMapChange none vs `origin/main`

**PASS**

- `git diff --name-status origin/main...HEAD -- extensions/pi-pstack/src/` → empty  
- `git diff origin/main -- extensions/pi-pstack/src/` byte size → **0**  
- Working tree clean for `extensions/pi-pstack/src/`  
- No branch commits touching `src/` in `origin/main...HEAD`

**HostMapChange: none** (no `src/` delta for this bump).

---

### Check 8 — ketchup-video + statechart entry; no `statechart.mjs` user entry

**PASS**

- `skills/ketchup-video/SKILL.md` present; lock entry `frontmatter`; disk == `git show` bytes (identity transform for this file’s frontmatter).
- User entry is `skills/statechart/scripts/statechart` (**100755**), which execs `statechart.ts` (not `.mjs`).
- `skills/statechart/scripts/statechart.ts` present (**100644**).
- `skills/statechart/scripts/statechart.mjs` **does not exist** on disk.
- Upstream tree at pin: **no** `statechart.mjs` paths under `pstack/skills/statechart` (corpus TLA comments may still mention the old name; that is not a shipped entry).

---

## Evidence artifacts

| Path | Role |
| --- | --- |
| `evidence/fact-check/verify-lock.mjs` | Independent per-entry disk + rebuild verifier |
| `evidence/fact-check/verify-lock-result.json` | Machine summary (579 checked, zero mismatches, skill lists) |
| `evidence/fact-check/report.md` | This report |

## Verdict

**VERIFIED** — claimed pin, versions, lock integrity, authored set, skill inventory, package/README docs, no `src/` host-map change, and ketchup-video / statechart TS entry all re-derived from git and the package filesystem.
