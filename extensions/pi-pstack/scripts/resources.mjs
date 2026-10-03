import { createHash } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rmdir, stat, unlink, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { cloudVm, localState, remoteFallback } from './resource-text.mjs';
import { pinLatest, sentenceCaseHeadings, tabIndentFences } from './resource-transforms.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const sources = [
  { directory: 'upstream', inventory: 'docs/source-inventory.json' },
  { directory: 'upstream-team-kit', inventory: 'docs/team-kit-source-inventory.json' },
];
const write = process.argv.includes('--write');
const routineAdapter = await readFile(join(root, 'host/adapters/make-bot-ui/SKILL.md'));
const overlayNames = (await readdir(join(root, 'scripts/overlays'))).filter((name) => name.endsWith('.mjs')).sort();
const overlays = (await Promise.all(overlayNames.map((name) => import(new URL(`./overlays/${name}`, import.meta.url))))).flatMap((module) => module.default);
const rowNames = (await readdir(join(root, 'scripts/resource-rows'))).filter((name) => name.endsWith('.mjs')).sort();
const generatedRows = (await Promise.all(rowNames.map((name) => import(new URL(`./resource-rows/${name}`, import.meta.url))))).flatMap((module) => module.default);
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
if (!manifest.pi?.prompts?.includes('./prompts') || !manifest.files?.includes('prompts')) {
  throw new Error('Package must register and distribute the generated prompts directory.');
}
async function files(dir, installedDependencies = false) {
  const items = await readdir(dir, { withFileTypes: true });
  const paths = await Promise.all(
    items.map(async (item) => {
      if (installedDependencies && item.name === 'node_modules' && item.isDirectory()) return [];
      if (installedDependencies && item.name === '.DS_Store') return [];
      const path = join(dir, item.name);
      if (item.isDirectory()) return files(path, installedDependencies);
      if (item.isFile()) return [path];
      throw new Error(`Unexpected non-file ${path}`);
    }),
  );
  return paths.flat().toSorted();
}
const inventories = await Promise.all(
  sources.map(async (source) => {
    const directory = join(root, source.directory);
    const inventory = JSON.parse(await readFile(join(root, source.inventory), 'utf8'));
    const actual = (await files(directory)).map((path) => relative(directory, path));
    if (JSON.stringify(actual) !== JSON.stringify(inventory.map((entry) => entry.path).toSorted())) {
      throw new Error(`Upstream file inventory differs from the pinned source: ${source.directory}.`);
    }
    return inventory.map((entry) => ({ ...entry, source: `${source.directory}/${entry.path}` }));
  }),
);
const entries = inventories.flat();
const destinations = entries.filter((entry) => entry.path.startsWith('skills/')).map((entry) => entry.path);
if (new Set(destinations).size !== destinations.length) throw new Error('Duplicate generated skill destination across source bundles.');
const verified = await Promise.all(
  entries.map(async (entry) => {
    const path = join(root, entry.source);
    const original = await readFile(path);
    if (sha(original) !== entry.sha256) throw new Error(`Upstream hash mismatch: ${entry.source}`);
    return { ...entry, original, mode: (await stat(path)).mode & 0o777 };
  }),
);
const markdownFiles = /\.md$/;
const worktreeAudit = /^skills\/poteto-mode\/scripts\/worktree-audit\.sh$/;
const modelRule = 'Map model rule location to Pi agent configuration.';
const skillDirectories = 'Map user and project skill directories to Pi discovery locations.';
const transcripts = 'Map Reference agent-transcripts to the Pi session store and per-parent subagents child transcripts.';
const portableDates = 'Replace BSD-only stat and date calls with Perl so transcript dates survive GNU or uutils coreutils on PATH.';
const dependencyCorrections = 'Adapt external dependency instructions to Pi host capabilities and evidence rules.';
const hostPaths = [
  [
    /^skills\/pr-review-canvas\/SKILL\.md$/,
    'Run this backgrounded, then navigate the in-app browser to',
    'Run this backgrounded, then open a local browser. Follow the control-ui skill to connect to the browser and verify the page at',
    'Map the review canvas browser step to the local control-ui workflow.',
  ],
  [
    markdownFiles,
    'Look recursively for `.upstream/skills/**/*-mode/SKILL.md` and `~/.upstream/skills/*-mode/SKILL.md`',
    'Look recursively for `.pi/skills/**/*-mode/SKILL.md`, `.agents/skills/**/*-mode/SKILL.md`, `<agent-dir>/skills/*-mode/SKILL.md` (`~/.pi/agent/skills` by default), and `~/.agents/skills/*-mode/SKILL.md`',
    skillDirectories,
  ],
  [markdownFiles, '~/.upstream/rules/pstack-models.mdc', '~/.pi/agent/pstack/models.mdc', modelRule],
  [markdownFiles, '~/.upstream/skills', '~/.pi/agent/skills', skillDirectories],
  [markdownFiles, '.upstream/skills', '.pi/skills', skillDirectories],
  [markdownFiles, 'or plugin-installed paths under `~/.upstream/plugins/`', 'or Pi package skill paths such as the bundled pstack skills directory named by the host contract', skillDirectories],
  [
    markdownFiles,
    'Transcripts live at `~/.upstream/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`, where `<slug>` is the workspace path with the leading slash dropped and each "/" turned into "-" (so `/Users/you/proj` becomes `Users-you-proj`). Every line is one chat message.',
    'Transcripts live in the workspace Pi session directory that the pstack host contract names. Read that path. Pi\'s `sessionDir` setting, `PI_CODING_AGENT_SESSION_DIR`, and `--session-dir` can move it. By default transcripts live at `~/.pi/agent/sessions/<slug>/<timestamp>_<uuid>.jsonl`, with Task subagent transcripts under `<slug>/<parent-uuid>/subagents/agent-<child-id>.jsonl` (older runs used `<slug>/pstack-workers/<parent-uuid>/`). `<slug>` is the workspace path with the leading slash dropped, each "/", "\\", and ":" turned into "-", and `--` added at both ends (so `/Users/you/proj` becomes `--Users-you-proj--`). Every line is one session entry.',
    transcripts,
  ],
  [markdownFiles, 'ls -t <agent-transcripts>/*.jsonl <agent-transcripts>/*/*.jsonl <agent-transcripts>/*/subagents/*.jsonl', '', transcripts],
  [
    markdownFiles,
    'Three transcript layouts: legacy flat (`<id>.jsonl`), current nested (`<id>/<id>.jsonl`), and subagent (`<parent>/subagents/<child>.jsonl`).',
    'Two transcript layouts: session (`<timestamp>_<id>.jsonl`) and Task subagent (`<parent-id>/subagents/agent-<child>.jsonl`, with `agent-<child>.meta.json` beside it; older runs wrote `pstack-workers/<parent>/<timestamp>_<child>.jsonl`).',
    transcripts,
  ],
  [
    markdownFiles,
    'read the first JSONL line and check that `message.content[0].text`',
    'read the first JSONL line whose `message.role` is `user` and check that its `message.content` (a string, or the `text` of its first text block)',
    transcripts,
  ],
  [markdownFiles, '`agent-transcripts/` directory', 'Pi session directory', transcripts],
  [markdownFiles, 'under `agent-transcripts/`', 'under the Pi session directory', transcripts],
  [markdownFiles, '`~/.upstream/projects/*/`', '`~/.pi/agent/sessions/*/`', transcripts],
  [
    /^skills\/deslop\/SKILL\.md$/,
    'Check the diff against main and remove AI-generated slop introduced in the branch.',
    "Find the pull request's actual base branch from forge metadata or the task brief. For a stacked pull request, use its direct parent branch. For non-PR work, use the task's named comparison base. Review only changes introduced by this branch; if the scope is unknown, report it and do not edit outside the known diff. Never default to `main` when it is not the base.",
    dependencyCorrections,
  ],
  [
    /^skills\/deslop\/SKILL\.md$/,
    '- Extra comments that are unnecessary or inconsistent with local style',
    '- Extra comments that are unnecessary or inconsistent with local style, except comments that document invariants, constraints, security, compatibility, or user intent',
    dependencyCorrections,
  ],
  [
    /^skills\/deslop\/SKILL\.md$/,
    '- Keep behavior unchanged unless fixing a clear bug.',
    '- Keep behavior unchanged unless fixing a clear bug.\n- Preserve all comments that document constraints, invariants, security, compatibility, or user intent. Do not delete or rewrite them.',
    dependencyCorrections,
  ],
  [
    /^skills\/swarm\/SKILL\.md$/,
    'Fan out N parallel cloud workers.',
    `Fan out N parallel workers. Default each worker to \`environment: "cloud"\` when the host contract shows a configured remote executor. Use a local worker when the task needs an app, simulator, credentials, transcripts, or IDE state available only on this machine. Verify a cloud worker's host, working directory, and exact commit SHA. ${cloudVm} ${remoteFallback} If a required machine is unavailable, mark the lane BLOCKED.`,
    dependencyCorrections,
  ],
  [/^skills\/swarm\/SKILL\.md$/, 'N is total workers, not the cloud concurrency limit.', 'N is the total worker count, not the current concurrency limit.', dependencyCorrections],
  [
    /^skills\/swarm\/SKILL\.md$/,
    'Spawn all N workers in one message with `subagent_type: generalPurpose`, `environment: "cloud"`, `run_in_background: true`, and the step 4 model, left unset for `auto` or `inherit-parent`. Use `environment: "local"` only when the worker needs access to something on the user\'s computer.',
    'Spawn all N workers in one message with `subagent_type: generalPurpose`, `run_in_background: true`, and the step 4 model, left unset for `auto` or `inherit-parent`, using the Pi `Task` tool. Default `environment` to `"cloud"` when the host contract shows a configured remote executor. Use `environment: "local"` only when the worker needs access to something on this machine, or when no remote executor is configured, and record that fallback. Use `environment: "cloud"` for a configured independent VM. Its receipt must match the expected machine identity and exact checkout SHA. If a required machine is unavailable, mark the lane BLOCKED.',
    dependencyCorrections,
  ],
  [/^skills\/poteto-mode\/playbooks\/autopilot-(?:full|stack)\.md$/, 'One Reference cloud agent per PR', 'One Pi worker per PR', dependencyCorrections],
  [
    /^skills\/poteto-mode\/playbooks\/autopilot-(?:full|stack)\.md$/,
    'Never require Graphite (`gt`).',
    `Never require Graphite (\`gt\`). Run each owner as Task \`environment: "cloud"\` when the host contract shows a configured remote executor, unless it needs ${localState}. Keep an owner local when the app, simulator, credentials, transcripts, or IDE state are local. Verify a cloud owner's host, working directory, and exact commit SHA. ${cloudVm} ${remoteFallback} If the required machine is unavailable, mark the lane BLOCKED.`,
    dependencyCorrections,
  ],
  [
    /^skills\/poteto-mode\/playbooks\/shipping\.md$/,
    'One subagent per PR, not batched, each a Reference cloud agent, each exercising the real surface with the matching control skill (such as `control-ui` or `control-cli` from `team-kit`) against parent versus head. Each returns `PASS`, `PASS+NOTES` or `FAIL` and posts that verdict on its own PR. Safe means a verdict from an agent that did not write the code.',
    `One independent worker per PR, not batched, and none may have written the code. Each exercises the real surface with \`control-ui\` or \`control-cli\` against parent versus head. Each returns \`PASS\`, \`PASS+NOTES\` or \`FAIL\` and posts that verdict on its own PR. Safe means a verdict from an agent that did not write the code. Default each verifier to \`environment: "cloud"\` when the host contract shows a configured remote executor. Run a local app lane on the machine that can reach the app when the lane needs this machine's app, simulator, credentials, transcripts, or IDE state. Run a genuinely remote lane only through a separately configured remote executor that can run the app and its dependencies; verify the host, machine ID, working directory, and exact PR-head SHA. ${cloudVm} ${remoteFallback} If the required machine is unavailable, mark the lane BLOCKED. For a result from \`verify-this\`, map \`VERIFIED\` to \`PASS\` only when the required baseline, treatment, and evidence are present. Map \`NOT VERIFIED\` and \`INCONCLUSIVE\` to \`FAIL\`. \`PASS+NOTES\` is allowed only when all verification requirements pass and every note is non-blocking. Post the verdict on the PR.`,
    dependencyCorrections,
  ],
  [
    /^skills\/poteto-mode\/playbooks\/multi-phase-plan\.md$/,
    '- [ ] `git show origin/main:<control skill path>`',
    '- [ ] Read the control skill from the target repository when it commits that file. Otherwise read the bundled skill from the package path named by the pstack host contract. Do not run `git show` for a skill path absent from the target repository.',
    dependencyCorrections,
  ],
  [
    /^skills\/poteto-mode\/playbooks\/multi-phase-plan\.md$/,
    'Each live lane runs on its own cloud VM at the PR head. Drive through `control-ui` or `control-cli` from `team-kit`.',
    `Each live lane runs on its own cloud VM at the PR head when the host contract shows a configured remote executor, as Task \`environment: "cloud"\` with one VM per lane. Use a local worker only for a local-only app, simulator, credential, transcript, or IDE. Verify each cloud lane's host, machine ID, working directory, and exact PR-head SHA. ${cloudVm} ${remoteFallback} Mark the lane BLOCKED if its required machine is unavailable. Drive the real surface through \`control-ui\` or \`control-cli\`.`,
    dependencyCorrections,
  ],
  [
    /^skills\/poteto-mode\/playbooks\/multi-phase-plan\.md$/,
    "- [ ] Hold the review gate. <PR ids> change an interaction. They wait for the operator's review in chat with screenshots and a video before merge.",
    "- [ ] Hold the review gate. <PR ids> change an interaction. Before capturing or storing screenshots or video from a privacy-sensitive workspace, get the operator's explicit agreement. Without agreement, do not store the media and mark the review gate BLOCKED. The operator reviews approved screenshots and video in chat before merge.",
    dependencyCorrections,
  ],
  [
    /^skills\/poteto-mode\/playbooks\/multi-phase-plan\.md$/,
    '- [ ] Save every screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.',
    "- [ ] Check whether the workspace is privacy-sensitive before capturing or storing media. Without the operator's explicit agreement, do not store screenshots or video from a privacy-sensitive workspace and mark the lane BLOCKED. Otherwise save each screenshot to `/tmp/swarm-<pr-id>/worker-<n>/<slug>.png` and return the paths with the report.",
    dependencyCorrections,
  ],
  [
    worktreeAudit,
    '# Usage: worktree-audit.sh [repo-path]   (defaults to the current repo)',
    '# Usage: worktree-audit.sh [repo-path] [session-dir]\n# Pass the host contract session directory when Pi uses --session-dir.\n# Otherwise PI_CODING_AGENT_SESSION_DIR overrides the default store.',
    transcripts,
  ],
  [
    worktreeAudit,
    `# Transcripts dir: ~/.upstream/projects/<slugified-repo-path>/agent-transcripts.\nslug=$(printf '%s' "$main_wt" | sed 's#^/##; s#/#-#g')\ntranscripts="$HOME/.upstream/projects/$slug/agent-transcripts"`,
    `# Pi session dirs: <agent-dir>/sessions/--<repo path with / and : as ->--, including child transcripts under <parent-id>/subagents and legacy pstack-workers.\nsessions="\${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}"; sessions="\${sessions/#\\~/$HOME}/sessions"\nsession_dir() { printf '%s/--%s--' "$sessions" "$(printf '%s' "$1" | sed 's#^/##; s#[/:]#-#g')"; }\ntranscripts="\${2:-\${PI_CODING_AGENT_SESSION_DIR:-$(session_dir "$main_wt")}}"\ntranscripts="\${transcripts/#\\~/$HOME}"`,
    transcripts,
  ],
  [
    worktreeAudit,
    `\tif [ -d "$transcripts" ]; then\n\t\tf=$(rg -l -e "\${wt}/" -e "\${wt}\\"" "$transcripts" 2>/dev/null`,
    `\twt_sessions=$(session_dir "$wt")\n\tif [ -d "$transcripts" ] || [ -d "$wt_sessions" ]; then\n\t\tf=$(rg -l -0 -e "\${wt}/" -e "\${wt}\\"" "$transcripts" "$wt_sessions" 2>/dev/null`,
    transcripts,
  ],
  [worktreeAudit, `| xargs stat -f '%m %N' 2>/dev/null`, `| xargs -0 perl -e 'printf "%d %s\\n", (stat)[9], $_ for @ARGV' 2>/dev/null`, portableDates],
  [worktreeAudit, `last=$(date -r "$last_ts" '+%Y-%m-%d' 2>/dev/null)`, `last=$(perl -MPOSIX -e 'print strftime("%Y-%m-%d", localtime shift)' "$last_ts" 2>/dev/null)`, portableDates],
];
hostPaths.push(
  [
    /^skills\/poteto-mode\/playbooks\/autopilot-(?:full|stack)\.md$/,
    'A cloud root uses the existing cloud-sleeper wake chain instead.',
    'A durable Pi root uses `SubscribeTimer` with a 30-minute schedule and the audit prompt. Record its run and subscription IDs. `ListSubscriptions` verifies it remains armed; `Unsubscribe` cancels it after the program finishes. A cloud root, a Task with `environment: "cloud"` on a remote VM, arms `SubscribeTimer` from its own Pi root on that VM, and the tick fires there.',
    dependencyCorrections,
  ],
  [
    /^skills\/poteto-mode\/playbooks\/multi-phase-plan\.md$/,
    'In a cloud root, a cloud-sleeper wake chain.',
    'For a durable root, use `SubscribeTimer` with a 30-minute schedule and the audit prompt. Record the run and subscription IDs, verify them with `ListSubscriptions`, and cancel with `Unsubscribe` after the program finishes. A cloud root, a Task with `environment: "cloud"` on a remote VM, arms `SubscribeTimer` from its own Pi root on that VM, and the tick fires there.',
    dependencyCorrections,
  ],
);
hostPaths.push(...generatedRows);
const appliedHostPaths = new Set();
function mapHostPaths(entry, text) {
  return hostPaths.reduce(
    ({ text, transformations }, row) => {
      const [scope, from, to, reason] = row;
      const present = typeof from === 'string' ? text.includes(from) : new RegExp(from.source, from.flags.replace('g', '')).test(text);
      if (!scope.test(entry.path) || !present) return { text, transformations };
      appliedHostPaths.add(row);
      return { text: text.replaceAll(from, to), transformations: transformations.includes(reason) ? transformations : [...transformations, reason] };
    },
    { text, transformations: [] },
  );
}

function markdown(entry) {
  if (entry.path === 'skills/make-bot-ui/SKILL.md')
    return {
      generated: Buffer.from(routineAdapter.toString('utf8').replaceAll('../../../upstream/', '../../upstream/')),
      transformations: ['Replace Reference routine panel and secret card with the native reviewed Pi routine adapter at host/adapters/make-bot-ui/SKILL.md.'],
    };
  let text = entry.original.toString('utf8');
  let transformations = [];
  if (/^skills\/[^/]+\/SKILL\.md$/.test(entry.path)) {
    const slug = entry.path.split('/')[1];
    const updated = text.replace(/^name: .+$/m, `name: ${slug}`);
    if (text !== updated) transformations = [...transformations, 'Normalize skill name to its directory slug for Pi discovery.'];
    text = updated;
    const pathTriggered = /^---\r?\n[\s\S]*?^paths:/m.test(text);
    const portable = text.replace(/^(---\r?\n)([\s\S]*?)(\r?\n---)/, (_match, start, frontmatter, end) => start + frontmatter.replace(/^(?:mode|icon|color|reminder|paths):[^\n]*(?:\n|$)/gm, '') + end);
    if (text !== portable) transformations = [...transformations, 'Remove Reference-only frontmatter; Pi runtime behavior belongs to the extension.'];
    text = portable;
    if (pathTriggered) transformations = [...transformations, 'Pi has no file-path skill trigger. Keep the skill hidden from model selection, and the host contract requires reading it before editing matching files.'];
    if (slug === 'setup-pstack') {
      text = text
        .replace(
          '# Setup pstack',
          '# Setup pstack\n\nCall `pstack_setup` to perform these steps through native Pi dialogs and validated writes. This skill may be selected when the user asks to configure models. Do not bypass the confirmation by manually writing the rule. The steps below document the contract owned by that tool; /setup-pstack and /skill:setup-pstack use the same implementation.',
        )
        .replace(
          'interrogate reviewers: claude-opus-5-5-max, gpt-5.6-sol-max, grok-4.7-xhigh-fast\n',
          'interrogate reviewers: claude-opus-5-5-max, gpt-5.6-sol-max, grok-4.7-xhigh-fast\ntrail reviewer: inherit-parent\nfigure-it-out judge: inherit-parent\nrecall miners: inherit-parent\n',
        );
      transformations = [
        ...transformations,
        'Preserve ambient setup invocation and route it through the same native validated dialogs as the slash entry points.',
        'List the three port-added role lines so a re-run preserves them instead of dropping them as retired.',
        'Keep the setup-pstack role table in step with src/models.ts roleNames.',
      ];
    }
  }
  const mapped = mapHostPaths(entry, text);
  const shaped = shapeMarkdown(entry.path, mapped.text);
  return { generated: Buffer.from(shaped.text), transformations: [...transformations, ...mapped.transformations, ...shaped.transformations] };
}

function shapeMarkdown(path, text) {
  if (/^skills\/(?:tdd|principle-[^/]+)\/SKILL\.md$/.test(path)) return { text: sentenceCaseHeadings(text), transformations: ['Use sentence case for headings, per the prose style rules.'] };
  if (path === 'skills/typescript-best-practices/references/patterns.md') return { text: tabIndentFences(text), transformations: ['Indent code snippets with tabs, per the technical-writing rule.'] };
  return { text, transformations: [] };
}

const helperPins = /^skills\/poteto-mode\/scripts\/(?:package\.json|bun\.lock)$/;
const helperLock = verified.find((entry) => entry.path === 'skills/poteto-mode/scripts/bun.lock').original.toString('utf8');

function pinnedText(entry) {
  const text = entry.original.toString('utf8');
  if (!helperPins.test(entry.path)) return { text, transformations: [] };
  const pinned = pinLatest(text, helperLock);
  return { text: pinned, transformations: pinned === text ? [] : ['Pin the helper dev dependencies to the versions that bun.lock resolves, so a fresh install is reproducible.'] };
}

function script(entry) {
  const mapped = worktreeAudit.test(entry.path) ? mapHostPaths(entry, entry.original.toString('utf8')) : pinnedText(entry);
  const overlaid = overlays.filter((overlay) => overlay.path === entry.path).reduce((acc, overlay) => applyOverlay(acc, overlay), mapped);
  if (overlaid.text === entry.original.toString('utf8')) return { generated: entry.original, transformations: [] };
  return { generated: Buffer.from(overlaid.text), transformations: overlaid.transformations };
}

function applyOverlay({ text, transformations }, overlay) {
  let next = text;
  const reasons = [...transformations];
  for (const [from, to, reason] of overlay.edits) {
    if (!next.includes(from)) throw new Error(`Overlay for ${overlay.path} does not match: ${from.slice(0, 60)}`);
    next = next.replace(from, () => to);
    reasons.push(reason);
  }
  return { text: next, transformations: reasons };
}

function promptOutput(entry, generated) {
  if (!/^skills\/[^/]+\/SKILL\.md$/.test(entry.path)) return [];
  const slug = entry.path.split('/')[1];
  if (slug === 'poteto-mode' || slug === 'setup-pstack') return [];
  const body = generated
    .toString('utf8')
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '')
    .trim();
  const prompt =
    slug === 'bro'
      ? body
      : [
          `Read ${slug}/SKILL.md in full under the bundled pstack skills directory identified by the pstack host contract.`,
          'Follow those instructions, resolving references and supporting scripts relative to that skill directory.',
          'If the pstack host contract is unavailable, report that the package extension must be enabled to locate this bundled skill. Do not invent a path.',
        ].join('\n');
  return [
    {
      source: entry.source,
      destination: `prompts/${slug}.md`,
      generated: Buffer.from(
        `---\ndescription: ${JSON.stringify(slug === 'bro' ? 'Restate the last message in plain human language, with no jargon.' : `Invoke the bundled ${slug} workflow.`)}\nargument-hint: ${JSON.stringify(slug === 'bro' ? '[focus]' : '[task]')}\n---\n\n${prompt}\n\n$ARGUMENTS\n`,
      ),
      mode: 0o644,
      executable: false,
      transformations: [slug === 'bro' ? 'Classify reusable restatement text as a Pi prompt template.' : 'Expose the skill entry point as a native Pi prompt template with user arguments.'],
    },
  ];
}

const outputs = verified
  .filter((entry) => entry.path.startsWith('skills/'))
  .flatMap((entry) => {
    const { generated, transformations } = entry.path.endsWith('.md') ? markdown(entry) : script(entry);
    const executable = (entry.mode & 0o111) !== 0;
    const skill = { source: entry.source, destination: entry.path, generated, mode: entry.mode, executable, transformations };
    return [...(entry.path === 'skills/bro/SKILL.md' ? [] : [skill]), ...promptOutput(entry, generated)];
  });
const unusedHostPaths = hostPaths.filter((row) => !appliedHostPaths.has(row));
if (unusedHostPaths.length) throw new Error(`Host path mapping no longer matches upstream: ${unusedHostPaths.map((row) => row[1].split('\n')[0]).join('; ')}`);
for (const output of outputs) {
  const { generated, executable } = output;
  const destination = join(root, output.destination);
  if (write) {
    await mkdir(dirname(destination), { recursive: true });
    await writeFile(destination, generated);
    await chmod(destination, output.mode);
  } else if (!(await readFile(destination)).equals(generated)) {
    throw new Error(`Generated resource drift: ${output.destination}. Run bun run generate.`);
  }
  if ((((await stat(destination)).mode & 0o111) !== 0) !== executable) throw new Error(`Executable mode drift: ${output.destination}`);
}
if (write) {
  try {
    await unlink(join(root, 'skills/bro/SKILL.md'));
    await rmdir(join(root, 'skills/bro'));
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
}
const changes = outputs.map(({ source, destination, generated, executable, transformations }) => ({
  source,
  destination,
  sha256: sha(generated),
  executable,
  transformations,
}));
const expected = changes.map((entry) => entry.destination).toSorted();
const generatedPaths = (await Promise.all(['skills', 'prompts'].map((directory) => files(join(root, directory), true))))
  .flat()
  .map((path) => relative(root, path))
  .toSorted();
if (JSON.stringify(expected) !== JSON.stringify(generatedPaths)) throw new Error('Unexpected generated resource files.');
const output = `${JSON.stringify(changes, null, 2)}\n`;
const mappingPath = join(root, 'docs/resource-map.json');
if (write) await writeFile(mappingPath, output);
else if ((await readFile(mappingPath, 'utf8')) !== output) throw new Error('Resource map drift.');
process.stdout.write(`Verified ${entries.length} upstream files and ${changes.length} generated resources.\n`);
