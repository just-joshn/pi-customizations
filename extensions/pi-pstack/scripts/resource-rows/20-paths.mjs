const bundledPaths = 'Name bundled skill files relative to the poteto-mode skill directory or by skill name, since an installed package or another repository has no extensions/pi-pstack tree.';
const plan = /^skills\/poteto-mode\/playbooks\/multi-phase-plan\.md$/;
const autopilot = (name) => new RegExp(`^skills/poteto-mode/playbooks/${name}\\.md$`);

const tickReread = (name) => [
  autopilot(name),
  `re-read this playbook from trunk with \`git show origin/main:pstack/skills/poteto-mode/playbooks/${name}.md\``,
  `re-read this playbook. When the target repository commits it, read it from trunk with \`git show origin/main:<repo path>\`. Otherwise read the bundled \`playbooks/${name}.md\` in the poteto-mode skill directory the host contract names`,
  bundledPaths,
];

export default [
  tickReread('autopilot-full'),
  tickReread('autopilot-stack'),
  [
    plan,
    'Run `node pstack/skills/poteto-mode/scripts/check-plan.mjs <plan.md>` and fix',
    'Run `node scripts/check-plan.mjs <plan.md>` with the working directory set to the poteto-mode skill directory that the host contract names, passing the plan as an absolute path, and fix',
    bundledPaths,
  ],
  [plan, 'The program runs `pstack/skills/poteto-mode/playbooks/<execution playbook>.md`.', 'The program runs the bundled `playbooks/<execution playbook>.md` in the poteto-mode skill directory.', bundledPaths],
  [
    plan,
    '- [ ] Read these from trunk at program start. Re-read them at every tick.',
    '- [ ] Read these at program start and re-read them at every tick. Read a file from trunk with `git show origin/main:<repo path>` when the target repository commits it. Otherwise read the bundled copy at the path the host contract names.',
    bundledPaths,
  ],
  [plan, '  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/<execution playbook>.md`', '  - [ ] `playbooks/<execution playbook>.md` in the poteto-mode skill directory.', bundledPaths],
  [plan, '  - [ ] `git show origin/main:pstack/skills/swarm/SKILL.md`', '  - [ ] The **swarm** skill.', bundledPaths],
  [plan, '  - [ ] `git show origin/main:pstack/skills/poteto-mode/playbooks/opening-a-pr.md`', '  - [ ] `playbooks/opening-a-pr.md` in the poteto-mode skill directory.', bundledPaths],
  [plan, '  - [ ] `git show origin/main:pstack/skills/<each other leaf skill the program uses>`', '  - [ ] Each other leaf skill the program uses.', bundledPaths],
  [plan, 'Triage every Bugbot and security-reviewer comment per `../references/bugbot-triage.md`.', 'Triage every Bugbot and security-reviewer comment per the bundled `references/bugbot-triage.md` of the poteto-mode skill.', bundledPaths],
  [plan, 'run the swarm per `pstack/skills/swarm/SKILL.md`.', 'run the swarm per the **swarm** skill.', bundledPaths],
  [
    plan,
    'Which PRs get `pstack/skills/how/SKILL.md` and `pstack/skills/interrogate/SKILL.md`. The trail per `pstack/skills/show-me-your-work/SKILL.md`.',
    'Which PRs get the **how** skill and the **interrogate** skill. The trail per the **show-me-your-work** skill.',
    bundledPaths,
  ],
  [/^skills\/poteto-mode\/(?:playbooks|references)\/[^/]+\.md$/, '`../references/', '`references/', 'Resolve references from the skill directory the host contract names, not from the playbook file.'],
  [/^skills\/poteto-mode\/(?:playbooks|references)\/[^/]+\.md$/, '`../playbooks/', '`playbooks/', 'Resolve playbooks from the skill directory the host contract names, not from the reference file.'],
];
