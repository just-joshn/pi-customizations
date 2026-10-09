### The Question

Why do bound checks for `clamp(n, lo, hi)` live in this helper rather than being repeated at every call site?

### The Code in Question

- **File:** `parity/evidence/teach/fixture-app/src/clamp.js` (lines 1–9; also `src/clamp.js` relative to fixture-app)
- **Symbol:** `export function clamp(n, lo, hi)`
- **Git:** path is **untracked** (`?? parity/evidence/teach/fixture-app/`); not in `HEAD`. No blame, no follow history, no PR numbers, no ticket IDs for this file.

### What We Found

- **[Direct]** Bound checks are centralized in the helper so callers do not repeat min/max at each site. Source: `parity/evidence/teach/fixture-app/src/clamp.js:1-3`. Verbatim: *"Bound a number to [lo, hi]. Callers that need a clamped value use this helper once instead of repeating min/max at every site."*
- **[Direct]** The fixture README states the same design intent in product language. Source: `parity/evidence/teach/fixture-app/README.md:6`. Verbatim: *"Bound checks live in the helper so call sites stay thin."*
- **[Direct]** The module’s stated role is a tiny held-out teach fixture, not a production feature with organic history. Source: `parity/evidence/teach/fixture-app/README.md:1-3`. Verbatim: *"Tiny held-out module for `/teach` how/why grounding."* plus the clamp export bullet.
- **[Supported]** Local git archaeology for this path is empty: `git blame` / `git log --follow` report no such path in `HEAD`; `git ls-files` does not track it; the whole `fixture-app/` tree is untracked. Repo-wide pickaxe for the comment/README phrases returned nothing for this content. So the only explicit rationale in-repo is the comment + README pair above—not a commit or PR trail.

### What We Can Reasonably Infer

- **[Inferred]** Given the matching wording in the file comment and README, and the README’s “`/teach` how/why grounding” framing, the helper-vs-call-site choice appears to be **intentionally documented for teach grounding**, not something we can reconstruct from a refactor series. Reasoning: two explicit texts agree on “thin call sites / don’t repeat min/max,” while there is zero commit/PR history for this path.
- **[Inferred]** Within this fixture tree there are no call sites or tests that import `clamp` (only the helper file and README mention it). That is consistent with a minimal held-out module, and means we cannot verify from this tree that duplication at call sites actually existed before the helper.

### Competing Hypotheses

- **Hypothesis:** The helper exists for ordinary DRY / thin-call-site maintainability (the story the comment and README state).
  - **Evidence for:** Direct quotes in `clamp.js:1-3` and `README.md:6`.
  - **Evidence against or missing:** No commits, PRs, reviews, or call-site diffs showing a move from duplicated min/max into a helper.

- **Hypothesis:** The rationale text was authored primarily so `/teach` can ground how/why answers, rather than recording a prior production decision.
  - **Evidence for:** README labels the tree a “held-out module for `/teach` how/why grounding”; the tree is untracked and thinly historied; no callers in the fixture.
  - **Evidence against or missing:** Nothing in the comment or README says the rationale is synthetic or pedagogical-only; both sentences read as genuine design intent for the helper.

These are compatible: the stated *design* reason can be real for the helper while the *artifact* still exists mainly for teach evidence.

### What We Don't Know

- Who authored the file, when, and whether any real call-site duplication preceded it (no git history for this path).
- Whether any PR, issue, chat, or design doc outside this tree motivated the shape (not searchable here under the narrowing contract / unavailable MCPs).
- Whether “callers” in the comment refers to code that will be added later, code outside this fixture, or is illustrative only—this fixture has no callers.
- People who would know: whoever created the teach fixture locally; that authorship is not in the git record for this path.

### Sources Consulted

- **Source control history**: Searched `parity/evidence/teach/fixture-app/src/clamp.js` via `git blame`, `git log --follow -p`, `git log --oneline`, `git ls-files`, status (`??` untracked), pickaxe (`git log -S` / `-G` for clamp/comment/README phrases—hits were unrelated vendored paths, not this file). Read in-file comment (`clamp.js:1-3`), README (`README.md`), and grepped the fixture tree for `clamp` (only those two files). **0 commits / 0 PRs** for this path. `gh repo view` shows `just-joshn/pi-customizations`; no PR bodies pulled because there are no merge commits for this file.
- **Issue / ticket tracker**: Not searched. Skipped under teach narrowing; also **provably irrelevant** for this untracked local held-out teach helper (no commits/PRs/ticket IDs to follow). GitHub Issues MCP exists but would not explain this untracked fixture’s shape.
- **Long-form documents**: Not searched. No general docs MCP (Notion/Confluence content search) available; Forge Confluence tools are app-dev guides, not a workspace document store for this fixture.
- **Real-time team chat**: Not searched. Slack MCP is `needsAuth` / unusable; no other chat MCP ready. Also irrelevant to an untracked tiny teach helper with no conversational paper trail expected.
- **Infrastructure observability**: Not searched. No matching MCP (Datadog/etc.). Provably irrelevant: pure sync helper, no infra signal.
- **Error / exception tracking**: Not searched. No matching MCP (Sentry/etc.). Provably irrelevant: no runtime exception path motivating the extraction.
- **Product analytics warehouse**: Not searched. No matching MCP. Provably irrelevant: no product metrics or thresholds in this helper.

### Confidence Summary

The **stated reason**—centralize bound checks so call sites stay thin and do not repeat min/max—is **directly documented** in the in-file comment and README, so confidence on *that claimed intent* is high. Confidence that this reflects an organic historical refactor from duplicated call sites is **low**: the fixture is untracked, has no git/PR trail, has no callers, and is explicitly framed as `/teach` grounding material. Treat the Direct quotes as authoritative for the documented design rationale; treat deeper product/history motivation as unknown.
