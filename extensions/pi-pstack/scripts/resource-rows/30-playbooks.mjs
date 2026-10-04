const referenceNouns = 'Replace a Reference-only noun with its Pi equivalent.';
const stale = 'Resolve a stale or contradictory upstream guard natively.';
const store = 'Name the agent store directory from the host contract and the orch writers that own each store file.';
const mode = /^skills\/poteto-mode\/SKILL\.md$/;
const playbooks = (...names) => new RegExp(`^skills/poteto-mode/playbooks/(?:${names.join('|')})\\.md$`);
const taskTrail = 'a cloud Task id (read its record with `TaskOutput` or `TaskAttach`)';

export default [
  [/^skills\/poteto-mode\/(?:SKILL|playbooks\/authoring-a-skill)\.md$/, "(Reference's built-in for authoring SKILL.md files)", "(the host contract names its file, which targets Pi's SKILL.md format)", referenceNouns],
  [
    mode,
    'Agent-facing prose also follows the **create-skill** skill',
    'Agent-facing prose also follows the **create-skill** skill for SKILL.md structure and description rules (an imperative `Use when` or `Apply when` trigger clause is accepted)',
    stale,
  ],
  [mode, 'the `deslop` skill from the `team-kit` plugin (`/deslop`)', 'the **deslop** skill (`/deslop`)', referenceNouns],
  [
    mode,
    '`team-kit` publishes `control-cli` (CLIs and TUIs) and `control-ui` (browser / Electron / web UIs).',
    'The bundled `control-cli` skill drives CLIs and TUIs and the bundled `control-ui` skill drives browser / Electron / web UIs.',
    referenceNouns,
  ],
  [mode, ", and not Reference's built-in babysit skill, whose description matches the same words.", '. Pi has no built-in babysit or autopilot skill, so this playbook is the only route.', stale],
  [
    playbooks('babysit'),
    "This playbook replaces Reference's built-in babysit skill for these requests, so do not route there even though its description matches the same words.",
    'Pi has no built-in babysit or autopilot skill, so this playbook is the only route for these requests.',
    stale,
  ],
  [mode, 'PR link as `https://github.com/<owner>/<repo>/pull/<number>`', 'PR link as the URL from the resolved forge (`gh pr view` or `origin pr view`)', 'Name the resolved forge for the reply link, since Origin PRs are not on GitHub.'],
  [mode, 'from a transcript, cloud-agent URL, or pushed branch', `from a transcript, ${taskTrail}, or a pushed branch`, referenceNouns],
  [playbooks('session-pickup'), 'a cloud-agent URL', taskTrail, referenceNouns],
  [mode, 'a Reference restart', 'a Pi restart or reload', referenceNouns],
  [playbooks('opening-a-pr'), 'Run `/deslop` from `team-kit` over the diff', 'Run `/deslop` over the diff', referenceNouns],
  [playbooks('bug-fix'), "with Reference's `/loop` command.", 'with the `/loop` command the host contract names.', referenceNouns],
  [playbooks('autonomous-run'), "Pick the wake mechanism using Reference's `/loop` command (a built-in, not a pstack skill).", 'Pick the wake mechanism using the local `loop` skill the host contract names (`/loop`).', referenceNouns],
  [playbooks('worktree-cleanup'), 'misses one that lives at `.upstream/worktrees/myrepo/x`', 'misses one that lives under a different worktree root, such as a Pi Task cloud checkout under `pstack-workers`', referenceNouns],
  [
    playbooks('worktree-cleanup'),
    'Get that set from the user or sidebar and cross-check every candidate.',
    'Ask the user for that set, because Pi has no chat sidebar to read it from. Cross-check every candidate against the user-supplied pinned set.',
    referenceNouns,
  ],
  [
    playbooks('worktree-cleanup'),
    '`~/Library/Application Support/Reference` (`state.vscdb.backup`, and `snapshots/roots/<root>` where a `<root>` named for a folder you opened as a workspace balloons)',
    '`~/.pi/agent` growth (`sessions/` transcripts, `pstack-workers/` child transcripts and Task worktrees, and timer roots)',
    referenceNouns,
  ],
  [playbooks('autopilot-full', 'autopilot-stack'), '(the `deslop` skill from the `team-kit` plugin (`/deslop`))', '(the **deslop** skill, `/deslop`)', referenceNouns],
  [playbooks('autopilot-full'), 'such as `control-cli` or `control-ui` from `team-kit`, or a named driver', 'such as `control-cli` or `control-ui`, or a named driver', referenceNouns],
  [
    playbooks('multi-phase-plan'),
    'Browser, Electron, and web UIs use `control-ui` from `team-kit`. CLIs and TUIs use `control-cli` from `team-kit`.',
    'Browser, Electron, and web UIs use the bundled `control-ui` skill. CLIs and TUIs use the bundled `control-cli` skill.',
    referenceNouns,
  ],
  [playbooks('multi-phase-plan'), "write the file under the agent store's `docs/`.", 'write the file under `docs/` in the agent store directory the host contract names.', store],
  [playbooks('orchestrate'), 'runtime verification (from `team-kit`)', 'runtime verification (the bundled control skills)', referenceNouns],
  [
    playbooks('orchestrate'),
    "in the current agent's store (path in the system prompt).",
    'in the agent store directory the host contract names. Export `ORCH_STORE` as the path of that `orchestrate/<project-slug>/` directory before the first `orch` call, or pass `--store <that directory>`, because `orch` fails without one.',
    store,
  ],
  [
    playbooks('orchestrate'),
    '`gates.md` parks human gates (question, options, default on no answer).',
    '`gates.md` parks human gates (question, options, default on no answer). `orch gate park` writes them, `orch gate list` lists the open ones, and `orch gate resolve` records the answer.',
    store,
  ],
  [
    playbooks('orchestrate'),
    "the cloud agent's status in the Reference dashboard.",
    '`TaskList` with `repository: true`, `TaskAttach` status reads (which reconcile a cloud record without sending a prompt), and `TaskOutput` without resume.',
    referenceNouns,
  ],
  [playbooks('orchestrate'), 'After a Reference restart:', 'After a Pi restart or reload:', referenceNouns],
  [/^skills\/reflect\/SKILL\.md$/, "hand to Reference's built-in `create-skill` skill", 'hand to the `create-skill` skill', referenceNouns],
  [/^skills\/automate-me\/SKILL\.md$/, "Reference's built-in `create-skill` (authoring)", 'the `create-skill` skill (authoring)', referenceNouns],
  [/^skills\/automate-me\/SKILL\.md$/, "Use Reference's built-in `create-skill` skill", 'Use the `create-skill` skill', referenceNouns],
  [
    /^skills\/why\/SKILL\.md$/,
    'list the available MCPs from the Reference environment. Use the available-tools map when present. Otherwise inspect the `mcps/` directory Reference exposes for enabled MCP servers.',
    'list the available MCPs by calling `pstack_context` and classifying the MCP tools it returns.',
    referenceNouns,
  ],
  [/^skills\/workflow-from-chats\/SKILL\.md$/, 'recent Reference chats', 'recent agent chats', referenceNouns],
  [
    /^skills\/setup-pstack\/SKILL\.md$/,
    "If Reference also exposes a models API or CLI that lists the user's entitled models, prefer it for completeness.",
    "If Pi also exposes a model registry or CLI that lists the user's configured models, prefer it for completeness.",
    referenceNouns,
  ],
];
