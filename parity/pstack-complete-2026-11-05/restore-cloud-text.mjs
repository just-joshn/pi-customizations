#!/usr/bin/env node
// Restores pstack's own cloud-agent wording in pi-pstack now that Task environment "cloud" gives each agent its own
// machine. Each entry replaces the port's weakened sentence with upstream's, changing only the Cursor product names.
// Usage: restore-cloud-text.mjs <pi-pstack-dir>   (fails when a target sentence is missing, so a rerun is a no-op check)
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [root] = process.argv.slice(2);
if (!root) throw new Error('usage: restore-cloud-text.mjs <pi-pstack-dir>');

const edits = [
  {
    file: 'skills/swarm/SKILL.md',
    from: 'Both environments run on the user\'s computer. `cloud` gives each worker a separate git worktree, not a VM or a credential boundary. Use `environment: "local"` only when the worker needs the existing checkout or its uncommitted state. For concurrent runtime lanes, each brief must assign distinct ports, output directories, and writable cache paths. If the task requires stronger machine isolation, report that requirement as unavailable rather than claiming a worktree provides it.',
    to: 'Use `environment: "local"` only when the worker needs access to something on the user\'s computer.',
  },
  {
    file: 'skills/poteto-mode/playbooks/orchestrate.md',
    from: 'Run workers in a new git worktree (`environment: "cloud"`) unless the work needs the existing checkout or its uncommitted state. Both environments run on this machine and can access its local transcripts, simulators, and auth. Assign distinct ports, output directories, and writable cache paths to concurrent runtime workers, including `control-ui` and `control-cli` checks. A worktree is not a machine or credential boundary. Report stronger isolation as unavailable when the task requires it.',
    to: 'Run workers on a new cloud VM (`environment: "cloud"`) unless the work needs this machine: a `control-ui` or `control-cli` runtime check (shipped with pi-pstack), local transcripts, a simulator, or auth that exists only here.',
  },
  {
    file: 'skills/poteto-mode/playbooks/multi-phase-plan.md',
    from: 'Each live lane runs in its own git worktree (`environment: "cloud"`) at the PR head on this machine. Assign each concurrent lane distinct ports, output directories, and writable cache paths. A worktree does not provide VM or credential isolation. If the lane needs stronger machine isolation, mark it blocked until that isolation is available.',
    to: 'Each live lane runs on its own cloud VM at the PR head.',
  },
  { file: 'skills/poteto-mode/playbooks/multi-phase-plan.md', from: 'Record a 30 to 60 second video of the change in a lane worktree.', to: 'Record a 30 to 60 second video of the change on a lane VM.' },
  { file: 'skills/poteto-mode/playbooks/autopilot-full.md', from: 'Each owner is an isolated worker in its own git worktree that builds', to: 'Each owner is a cloud agent that builds' },
  { file: 'skills/poteto-mode/playbooks/autopilot-full.md', from: 'Assume the worker dies.', to: 'Assume the VM dies.' },
  { file: 'skills/poteto-mode/playbooks/shipping.md', from: 'One verifier per PR, each an isolated worker in its own git worktree, runs', to: 'One verifier per PR, each a cloud agent, runs' },
  { file: 'skills/poteto-mode/SKILL.md', from: "from a transcript, an isolated worker's agent ID, or pushed branch.", to: "from a transcript, a cloud agent's ID, or pushed branch." },
  { file: 'skills/poteto-mode/playbooks/session-pickup.md', from: "an isolated worker's agent ID, or a pushed branch.", to: "a cloud agent's ID, or a pushed branch." },
  { file: 'skills/poteto-help/SKILL.md', from: '| Run parallel checks over slices, or race workers, as isolated worktree workers |', to: '| Run parallel checks over slices, or race workers, as cloud agents |' },
  {
    file: 'skills/poteto-help/SKILL.md',
    from: '| Parallel agents overwrote each other | Give each agent its own git worktree with `environment: "cloud"`. They still share this machine. Assign distinct ports, output directories, and writable cache paths to concurrent runtime lanes. Stronger machine isolation is not provided. |',
    to: '| Parallel agents overwrote each other | Give each agent its own worktree, or run them as cloud agents, which each get their own machine. |',
  },
  { file: 'docs/guide/10-recipes-and-pitfalls.md', from: 'Run them as isolated workers (`environment: "cloud"`), or say "own worktree per attempt".', to: 'Run them as cloud agents, or say "own worktree per attempt".' },
];

for (const { file, from, to } of edits) {
  const path = join(root, file);
  const text = readFileSync(path, 'utf8');
  if (text.includes(to) && !text.includes(from)) {
    console.log(`already restored: ${file}: ${to.slice(0, 60)}`);
    continue;
  }
  const count = text.split(from).length - 1;
  if (count !== 1) throw new Error(`${file}: expected the port's sentence once, found it ${count} times:\n${from}`);
  writeFileSync(path, text.replace(from, to));
  console.log(`restored: ${file}: ${to.slice(0, 60)}`);
}
