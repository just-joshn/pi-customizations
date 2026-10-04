const originRepair = 'Load the `origin` skill to repair a missing or unauthenticated CLI before any fallback to `gh`.';
const originOnly =
  'A repository whose remote is `the origin host` is an Origin repository. Keep its owners and verifiers local, or on an executor with the origin CLI authenticated, and never fall back to `gh` for it. Mark the lane BLOCKED instead.';
const forge = 'Detect the origin CLI at its installed path, repair it before any gh fallback, and keep an Origin repository off gh.';
const playbook = (...names) => new RegExp(`^skills/poteto-mode/playbooks/(?:${names.join('|')})\\.md$`);

export default [
  [playbook('opening-a-pr', 'babysit', 'shipping', 'autopilot-full', 'autopilot-stack', 'multi-phase-plan'), '`command -v origin` succeeds', '`command -v origin || test -x ~/.local/bin/origin` succeeds', forge],
  [playbook('babysit', 'shipping', 'autopilot-full', 'autopilot-stack'), 'Otherwise stay on `gh` and record the fallback.', `${originRepair} ${originOnly} For any other repository, stay on \`gh\` and record the fallback.`, forge],
  [playbook('opening-a-pr'), 'If Origin is absent or cannot resolve the repository, stay on `gh` and record the fallback.', `${originRepair} ${originOnly} For any other repository, stay on \`gh\` and record the fallback.`, forge],
  [playbook('multi-phase-plan'), 'Record any fallback to `gh`.', `${originRepair} ${originOnly} For any other repository, record the fallback to \`gh\`.`, forge],
  [playbook('babysit'), 'Never add a second sleep loop.', "Keep one watcher plus the loop skill's one-shot fallback heartbeat, and never a second polling loop.", 'Reconcile the babysit one-watcher rule with the loop skill heartbeat.'],
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
    playbook('eval'),
    'Each works in its own sanitized dir. Same prompt to each.',
    "Each works in its own sanitized dir. Same prompt to each. Override arena's output paths and worktree names with sanitized project-shaped names, because arena's defaults contain `arena` and `candidate`, which the blinding rules forbid.",
    'Resolve the arena path defaults that contain the words that the eval blinding rules forbid.',
  ],
  [
    playbook('autopilot-stack'),
    'and STACK-READY with the exact head SHA when its loop is green.',
    'and STACK-READY with the exact head SHA when its loop is green. STACK-READY means self-proof receipts exist, CI is green, and babysit reports merge-ready at that exact head SHA, with the PR open and ready and nothing merged or armed.',
    'Define STACK-READY, which the stack playbook uses but never defines.',
  ],
];
