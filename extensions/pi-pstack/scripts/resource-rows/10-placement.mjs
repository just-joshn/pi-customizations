import { remoteFallback } from '../resource-text.mjs';

const placement = 'Restore the upstream cloud default placement and name the local fallback and its record.';

export default [
  [
    /^skills\/poteto-mode\/playbooks\/shipping\.md$/,
    'ignoring `READY` until `mergedAt` is non-null or `state` is `MERGED`',
    "ignoring the watcher's non-terminal `QUEUE`, `STATUS`, `WAITING`, and `ADVANCE` wakes (queued mode never emits `READY`) until `mergedAt` is non-null or `state` is `MERGED`",
    'Name the queued-mode events the watcher actually emits, since queued mode never emits READY.',
  ],
  [
    /^skills\/poteto-mode\/playbooks\/autopilot-stack\.md$/,
    'Treat a lane that passes its expected runtime without a side effect as stuck.',
    'Treat a lane that errors, or that passes its expected runtime without a side effect, as stuck.',
    'Align the stack stuck test with the full autopilot, so an erroring lane is stuck.',
  ],
  [/^skills\/poteto-mode\/playbooks\/orchestrate\.md$/, "Run a unit's verifier on a different model family from its worker.", `Run a unit's verifier on a different model family from its worker. ${remoteFallback}`, placement],
];
