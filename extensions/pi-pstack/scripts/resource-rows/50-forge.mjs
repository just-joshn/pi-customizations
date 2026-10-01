const originRepair = 'Load the `origin` skill to repair a missing or unauthenticated CLI before any fallback to `gh`.';
const originOnly =
  'A repository whose remote is `the origin host` is an Origin repository. Keep its owners and verifiers local, or on an executor with the origin CLI authenticated, and never fall back to `gh` for it. Mark the lane BLOCKED instead.';
const forge = 'Detect the origin CLI at its installed path, repair it before any gh fallback, and keep an Origin repository off gh.';
const playbook = (...names) => new RegExp(`^skills/poteto-mode/playbooks/(?:${names.join('|')})\\.md$`);

export default [
  [playbook('opening-a-pr', 'babysit', 'shipping', 'autopilot-full', 'autopilot-stack', 'multi-phase-plan'), '`command -v origin` succeeds', '`command -v origin || test -x ~/.local/bin/origin` succeeds', forge],
  [
    playbook('babysit', 'shipping', 'autopilot-full', 'autopilot-stack'),
    'Otherwise stay on `gh` and record the fallback.',
    `${originRepair} ${originOnly} For any other repository, stay on \`gh\` and record the fallback.`,
    forge,
  ],
  [
    playbook('opening-a-pr'),
    'If Origin is absent or cannot resolve the repository, stay on `gh` and record the fallback.',
    `${originRepair} ${originOnly} For any other repository, stay on \`gh\` and record the fallback.`,
    forge,
  ],
  [playbook('multi-phase-plan'), 'Record any fallback to `gh`.', `${originRepair} ${originOnly} For any other repository, record the fallback to \`gh\`.`, forge],
  [playbook('opening-a-pr'), 'With Origin, pass `--status open`.', 'With Origin, push the branch first or pass `--push`, and pass `--status open`.', 'Push before an Origin PR create.'],
  [
    playbook('opening-a-pr'),
    'Create a child with `origin pr create --status open --base <parent-branch>` or',
    'Create a child with `origin pr create --status open --stack-on <parent-pr>` or',
    'Use the Origin stack flag for a stacked child.',
  ],
  [playbook('babysit'), '`origin pr thread list <pr>`, and', '`origin pr thread list <pr> --unresolved --json id,resolved,path`, and', 'List only unresolved Origin threads.'],
  [
    playbook('babysit'),
    'Never add a second sleep loop.',
    "Keep one watcher plus the loop skill's one-shot fallback heartbeat, and never a second polling loop.",
    'Reconcile the babysit one-watcher rule with the loop skill heartbeat.',
  ],
  [
    playbook('babysit'),
    'Re-read the PR and threads whenever the check watch returns.',
    'Run the Origin check watch under `BackgroundShell` with an output sentinel in a local root, or through the CI subscription the host contract names in a durable root, never as a blocking foreground watch. Re-read the PR and threads whenever the check watch returns.',
    'Run the Origin check watch as an event instead of a blocking foreground call.',
  ],
  [
    playbook('shipping'),
    'and `origin pr checks <pr> --watch`, then re-read',
    'and `origin pr checks <pr> --watch` (under `BackgroundShell` with an output sentinel in a local root, or through the CI subscription the host contract names in a durable root), then re-read',
    'Run the Origin check watch as an event instead of a blocking foreground call.',
  ],
  [
    playbook('autonomous-run'),
    '1. State the exit condition as a checkable predicate before the first iteration (tests green, repro fixed, all N PRs merged, pixel-diff zero).',
    '1. State the exit condition as a checkable predicate before the first iteration (tests green, repro fixed, all N PRs merged, pixel-diff zero). Arm a `/goal` with `CreateGoal` carrying that predicate, so the goal outlives a single turn, and use `/loop` only as the wake mechanism.',
    'Arm a goal so an autonomous run has a predicate that the goal system checks.',
  ],
  [
    playbook('autopilot-full'),
    'The goal continues across turns until the queue is done.',
    "The goal continues across turns until the queue is done. Call `UpdateGoal` with status complete only after the last PR merges and the root's final verdict audit passes.",
    'Name the goal completion point so a goal cannot outlive the program or finish early on a green queue.',
  ],
  [
    playbook('autopilot-stack'),
    'The goal continues across turns until the chain is done.',
    "The goal continues across turns until the chain is done. Call `UpdateGoal` with status complete only after the last PR joins the stack and the root's final verdict audit passes.",
    'Name the goal completion point so a goal cannot outlive the program or finish early on a green chain.',
  ],
  [
    playbook('multi-phase-plan'),
    '- [ ] Every box above is checked with its evidence.',
    "- [ ] Every box above is checked with its evidence.\n- [ ] Call `UpdateGoal` with status complete only after the last PR merges or joins the stack and the root's final verdict audit passes.",
    'Name the goal completion point so a goal cannot outlive the program or finish early.',
  ],
  [playbook('multi-phase-plan'), '**Control skill.** Pick it by surface.', "**Control skill.** Prefer the repository's committed `verify-<app>` skill when it exists. Otherwise pick it by surface.", 'Prefer the repository verification skill over the generic recipe.'],
  [
    playbook('multi-phase-plan'),
    "- [ ] <Deliver input only through the control skill's commands. Name the read-only diagnostics.>",
    "- [ ] <Deliver input only through the commands of the generated `verify-<app>` skill from `create-verification-skill` when the repository has one, otherwise through the harness commands this lane writes down before driving. Name the read-only diagnostics.>",
    'Name the command surface a lane restricts input to when only a recipe exists.',
  ],
  [
    playbook('multi-phase-plan'),
    'and return the paths with the report.',
    'and return the paths with the report. Keep these files. This brief overrides the control skill cleanup default.',
    'Keep lane screenshots against the control skill cleanup guardrails.',
  ],
  [
    playbook('eval'),
    "Each works in its own sanitized dir. Same prompt to each.",
    "Each works in its own sanitized dir. Same prompt to each. Override arena's output paths and worktree names with sanitized project-shaped names, because arena's defaults contain `arena` and `candidate`, which the blinding rules forbid.",
    'Resolve the arena path defaults that contain the words that the eval blinding rules forbid.',
  ],
  [
    playbook('autopilot-stack'),
    'and STACK-READY with the exact head SHA when its loop is green.',
    'and STACK-READY with the exact head SHA when its loop is green. STACK-READY means self-proof receipts exist, CI is green, and babysit reports merge-ready at that exact head SHA, with the PR open and ready and nothing merged or armed.',
    'Define STACK-READY, which the stack playbook uses but never defines.',
  ],
  [
    playbook('autopilot-full'),
    'granted only after verifier proof.',
    "granted only after verifier proof. A countersign is the root's recorded approval of that one raise, a row in the root's decision trail that points at the verifier proof.",
    'Define the countersign that the autopilots require but never define.',
  ],
];
