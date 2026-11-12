export type PrimitiveId =
  | 'task-tool'
  | 'subagent-type'
  | 'run-in-background'
  | 'task-resume'
  | 'readonly'
  | 'cloud-environment'
  | 'todolist'
  | 'plan-mode'
  | 'ask-question'
  | 'loop'
  | 'await-shell'
  | 'cursor-path'
  | 'cursor-transcripts'
  | 'cursor-model-rule'
  | 'cursor-automations'
  | 'builtin-pr-tool'
  | 'create-skill-builtin'
  | 'canvas'
  | 'custom-modes'
  | 'cursor-ui'
  | 'cursor-builtin-babysit'
  | 'project-tracker'
  | 'host-tool-names'
  | 'visualize'
  | 'cursor-team-kit'
  | 'cursor-mcp-discovery'
  | 'cursor-host'
  | 'skill-frontmatter'
  | 'agent-frontmatter'
  | 'upstream-repo-path'
  | 'bugbot'
  | 'cursor-model-slug'
  | 'subagent-concept';

export type Disposition = 'map' | 'retain';

export interface Primitive {
  readonly id: PrimitiveId;
  readonly label: string;
  readonly pi: string;
  readonly disposition: Disposition;
  readonly detect: RegExp | null;
}

const PSTACK_WORKER = '`pstack_worker` spawn with an assignment file';

export const PRIMITIVES: readonly Primitive[] = [
  { id: 'task-tool', label: 'Cursor Task tool call', pi: PSTACK_WORKER, disposition: 'map', detect: /`Task`|\bTask (?:tool|calls?|subagent|spawn|prompt|response|error)\b|\bTask `model`/g },
  { id: 'subagent-type', label: 'subagent_type selection', pi: 'assignment `role`', disposition: 'map', detect: /subagent_type|\bgeneralPurpose\b|\bpoteto-agent\b/g },
  { id: 'run-in-background', label: 'run_in_background', pi: 'spawn returns at once; collect and the `pstack-worker` wake message', disposition: 'map', detect: /run_in_background/g },
  {
    id: 'task-resume',
    label: 'Task resume or fork of an agent',
    pi: 'fresh worker with a consolidated brief; `steer` for live state',
    disposition: 'map',
    detect: /\bResume, message, or queue|a steer or resume of a running agent|Interrupt-chained resumes|\bFork when\b|\bMessage a worker\b|a message restarts/g,
  },
  { id: 'readonly', label: 'readonly / Ask mode subagents', pi: "assignment `workspace.mode: 'readonly'`", disposition: 'map', detect: /(?<!["'])\breadonly\b(?!["']| __brand|: ["']X)|\bAsk mode\b|\bagent mode\b/g },
  {
    id: 'cloud-environment',
    label: 'environment: cloud / cloud agents',
    pi: 'container worker (U09); otherwise refuse',
    disposition: 'map',
    detect: /environment: "(?:cloud|local)"|\bcloud[- ]agents?\b|\bcloud VMs?\b|\blane VM\b|cloud_base_branch/g,
  },
  { id: 'todolist', label: 'TodoWrite / todo list', pi: '`TODO.md` in the run root via `start-run.mjs`', disposition: 'map', detect: /\bTodoWrite\b|\btodo ?list\b/gi },
  { id: 'plan-mode', label: 'Plan mode', pi: 'Markdown plan under `.pi/pstack/plans/`', disposition: 'map', detect: /\bplan mode\b|\bCreatePlan\b/gi },
  { id: 'ask-question', label: 'AskQuestion', pi: 'ask in the conversation', disposition: 'map', detect: /\bAskQuestion\b|allow_multiple/g },
  { id: 'loop', label: '/loop', pi: "`pstack_worker` with `kind: 'watch'`", disposition: 'map', detect: /(?<![\w/])\/loop\b/g },
  { id: 'await-shell', label: 'AwaitShell / background shells', pi: "`pstack_worker` with `kind: 'watch'`", disposition: 'map', detect: /\bAwaitShell\b|\bbackground it\b/g },
  { id: 'cursor-path', label: '.cursor paths', pi: 'Pi paths under `.pi/` and `~/.pi/agent/`', disposition: 'map', detect: /\.cursor(?:-plugin)?\b(?!\.com)|plugins\/cache/g },
  { id: 'cursor-transcripts', label: 'Cursor agent transcripts', pi: 'Pi session files under `~/.pi/agent/sessions/`', disposition: 'map', detect: /agent-transcripts/g },
  { id: 'cursor-model-rule', label: '.cursor/rules/pstack-models.mdc', pi: '`~/.pi/agent/pstack/models.json`', disposition: 'map', detect: /pstack-models\.mdc|alwaysApply|always-applied rule|applies to new (?:chats|sessions)/g },
  {
    id: 'cursor-automations',
    label: 'Cursor Automations and webhook routines',
    pi: 'U08 event adapter; refuse until installed',
    disposition: 'map',
    detect: /update_state|SendToUser|secret-request|api2\.cursor\.sh|\[routine\]|webhook_event|Grok Bot/g,
  },
  { id: 'builtin-pr-tool', label: 'Cursor built-in PR tool', pi: 'forge CLI (`gh` or `origin`)', disposition: 'map', detect: /built-in PR tool|\bthe PR tool\b/g },
  { id: 'create-skill-builtin', label: 'Cursor built-in create-skill', pi: "Pi's Agent Skills documentation plus the Authoring a skill playbook", disposition: 'map', detect: /create-skill/g },
  { id: 'canvas', label: 'Cursor Canvas', pi: 'none required (no active use)', disposition: 'map', detect: /\bCanvas\b/g },
  { id: 'custom-modes', label: 'Cursor Custom Modes', pi: 'persistent `/pstack on` style (U04c)', disposition: 'map', detect: /Custom Modes?\b|Agents Window|Use as Mode|Option\+Enter/g },
  {
    id: 'cursor-ui',
    label: 'Cursor UI affordances',
    pi: 'Pi commands and package install',
    disposition: 'map',
    detect: /Cmd\+Shift|computer preview|chat header|Customize in the sidebar|\bsidebar\b|\/add-plugin|`\/plugin (?:marketplace add|install) [^`]+`|`\/pstack:[a-z-]+`/g,
  },
  { id: 'cursor-builtin-babysit', label: "Cursor's built-in babysit skill", pi: 'none (pstack Babysit playbook only)', disposition: 'map', detect: /Cursor's (?:built-in babysit|own) skill/g },
  { id: 'project-tracker', label: 'Cursor Project tracker, store, and event subscriptions', pi: 'run root files and `pstack-worker` wakes', disposition: 'map', detect: /Project tracker|Project store|event subscriptions|agent'?s? store/g },
  { id: 'host-tool-names', label: 'Cursor tool names (Read, Grep, Glob, Shell)', pi: 'Pi tools read, grep, find, bash', disposition: 'map', detect: /`(?:Read|Grep|Glob|Shell)`|\bRead, Grep, and Glob\b|\(Shell, Grep, MCP/g },
  { id: 'visualize', label: 'Cursor /visualize', pi: 'Mermaid chart blocks', disposition: 'map', detect: /\/visualize\b/g },
  { id: 'cursor-team-kit', label: 'cursor-team-kit plugin', pi: 'team-kit skills shipped in pi-pstack', disposition: 'map', detect: /cursor-team-kit/g },
  { id: 'cursor-mcp-discovery', label: 'Cursor MCP discovery (mcps/ directory)', pi: 'Pi MCP (`pi mcp list`, `mcp__<server>__<tool>` tools)', disposition: 'map', detect: /`mcps\/`/g },
  { id: 'cursor-host', label: 'Cursor as the host product', pi: 'Pi', disposition: 'map', detect: /\bCursor\b|cursor\.com/g },
  { id: 'skill-frontmatter', label: 'Cursor-only skill frontmatter (paths)', pi: 'frontmatter `metadata`', disposition: 'map', detect: /^paths: /gm },
  { id: 'upstream-repo-path', label: 'paths inside the cursor/plugins checkout', pi: '`<pi-pstack>/generated/skills/`', disposition: 'map', detect: /(?<![\w/<>-])pstack\/skills\/|git show origin\/main:/g },
  { id: 'agent-frontmatter', label: 'Cursor agent definition frontmatter', pi: 'role instruction document for `--append-system-prompt`', disposition: 'map', detect: null },
  { id: 'bugbot', label: 'Cursor Bugbot review comments', pi: 'actual forge review comments when present; never fabricated', disposition: 'retain', detect: /\bBugbot\b|\bbugbot\b/g },
  {
    id: 'cursor-model-slug',
    label: 'Cursor model slugs as skill defaults',
    pi: "family and level resolved by `src/models.ts` (U04b); defined in poteto-mode's Workers paragraph",
    disposition: 'retain',
    detect: /\b(?:claude-opus-5-5|grok-4\.7)-(?:max|xhigh|high|medium|low)(?:-fast)?\b/g,
  },
  { id: 'subagent-concept', label: 'subagent as a concept', pi: "a `pstack_worker` worker (defined in poteto-mode's Subagents section)", disposition: 'retain', detect: /\bsub-?agents?\b/gi },
];

export const PRIMITIVE_BY_ID = new Map(PRIMITIVES.map((p) => [p.id, p]));

export interface Benign {
  readonly id: string;
  readonly pattern: RegExp;
  readonly reason: string;
}

export const BENIGN: readonly Benign[] = [
  { id: 'upstream-repo-url', pattern: /github\.com\/cursor\/plugins[\w./#-]*/g, reason: 'link to the pinned upstream source, not a runtime dependency' },
  { id: 'editor-cursor', pattern: /\bcursor location\b/g, reason: 'the editor caret position, not the product' },
  { id: 'model-family-slug', pattern: /`cursor-grok-\*`/g, reason: 'a model slug family name, resolved by the model adapter' },
  { id: 'no-orchestrate-skill', pattern: /`\/orchestrate`/g, reason: 'states that no such command exists in pstack' },
  { id: 'tmp-path', pattern: /\/tmp\b/g, reason: 'a filesystem path, not a slash command' },
  { id: 'ts-readonly', pattern: /\breadonly __brand\b/g, reason: 'TypeScript readonly modifier in code examples' },
  { id: 'code-identifiers', pattern: /`(?:UserService|UserId|OrderId|NoDeadlock|PeleError|ReturnType|DerivedData)`/g, reason: 'identifiers in code examples, not host tools' },
  { id: 'plan-template-heading', pattern: /<Task as a verb phrase>/g, reason: 'placeholder heading in the plan template' },
];

export const SENTINELS: readonly RegExp[] = [
  /\bcursor/gi,
  /\bTask\b/g,
  /`[A-Z][a-z]+(?:[A-Z][a-z]+)+`/g,
  /(?<![\w./~:<>-])\/[a-z][a-z-]*[a-z](?![\w./-])/g,
  /\breadonly\b|\bsubagent_type\b|\brun_in_background\b|\benvironment: "/g,
  /`[a-z]+(?:_[a-z]+)+:/g,
];

export interface Rule {
  readonly id: string;
  readonly primitives: readonly PrimitiveId[];
  readonly find: string;
  readonly replace: string;
  readonly files: Readonly<Record<string, number>>;
}

export interface Keep {
  readonly file: string;
  readonly text: string;
  readonly count: number;
  readonly primitive: PrimitiveId;
  readonly reason: string;
}

const SK = (path: string) => `vendor/upstream-pstack/skills/${path}`;
const PB = (name: string) => SK(`poteto-mode/playbooks/${name}.md`);
const AG = (name: string) => `vendor/upstream-pstack/agents/${name}.md`;
const SC = (path: string) => SK(`poteto-mode/scripts/${path}`);

const PI_PSTACK_PUBLIC = 'https://github.com/just-joshn/pi-customizations/tree/main/extensions/pi-pstack';
const UPSTREAM_PSTACK = 'https://github.com/cursor/plugins/blob/a5539b15a3d56e04992565aafee2b37051329ce3/pstack';
const PI_SKILL_DOCS = "Pi's Agent Skills documentation (`docs/skills.md` in the installed `@earendil-works/pi-coding-agent` package)";
const AUTHORING = 'the Authoring a skill playbook (`../poteto-mode/playbooks/authoring-a-skill.md`)';
const SESSION_FOLDER = "this workspace's Pi session folder (the directory of `$PI_SESSION_FILE`, under `~/.pi/agent/sessions/`)";
const WORKER_SESSIONS = '`.pi/pstack/runs/<runId>/workers/<workerId>/session/`';
const ASSIGNMENT_REF = '`<pi-pstack>/generated/skills/poteto-mode/references/worker-assignment.md`';
const POTETO_SCRIPTS = '<pi-pstack>/generated/skills/poteto-mode/scripts';
const U08 = '`<pi-pstack>/adapters/automation-events.ts`';
const READONLY_AT_ROOT = '`workspace: { mode: "readonly", path: "<absolute repository root>" }`';
const watchWorker = (argv: string) =>
  `a \`kind: "watch"\` worker with \`role: "watcher"\`, \`watch.argv: ${argv}\`, and \`watch.cwd: "<absolute repository root>"\`, every other field as in the watch example of ${ASSIGNMENT_REF}`;

export const WORKER_CONTRACT = `## Pi worker

You run as a pstack worker: an independent Pi process in tmux that a parent session started with the \`pstack_worker\` tool. Your brief is your whole task. Read every skill the brief names before other work. You have no \`pstack_worker\` tool by default. Without it, when the brief or a skill asks for another worker, do that work yourself, or name the request in your report and stop. When your assignment sets \`capabilities.spawn: true\`, as for a sub-coordinator, you have \`pstack_worker\` and own your children's runs. They live under your workspace's \`.pi/pstack/runs/\`, their wakes come to you, and you collect and judge their results yourself. Nesting stops at three levels (root, sub-coordinator, worker), so your children cannot get \`capabilities.spawn: true\`. Write your final report to \`report.md\` in the worker directory the brief names. Save each check you ran as a receipt under that directory's \`evidence/\`, and register it with \`pstack_evidence\` \`record\`. A readonly worker cannot write files. Its final reply is its report, and it names each check it ran there, with the command and its result, in place of receipts. Never claim a check you did not run. The parent reads your report, your receipts, and your session file after you settle.
`;

const WORKERS = `**Workers.** A subagent here is a pstack worker: an independent Pi process in tmux. To spawn one, write \`brief.md\` and \`assignment.json\` under \`.pi/pstack/runs/<runId>/workers/<workerId>/\` and call \`pstack_worker\` with \`{ action: "spawn", runId, assignmentPath }\`. Every assignment has \`schemaVersion: 1\`, \`runId\`, \`workerId\`, \`kind\` (\`"pi"\` for a Pi worker, \`"watch"\` for a watch), \`role\`, \`model\`, \`thinkingLevel\`, \`workspace\`, and \`skills\`. \`skills\` and \`thinkingLevel\` are optional. \`skills\` defaults to \`[]\`, for a brief that names no skill, and \`thinkingLevel\` to \`null\`, the model's default level. A \`"pi"\` worker adds \`brief: "brief.md"\`, and a watch adds \`watch: { argv, cwd }\` with an absolute \`cwd\` and an absolute path for any script in \`argv\`. \`references/worker-assignment.md\` holds one complete example per workspace mode and kind, so start from the closest one. The assignment's \`role\` picks the role instruction: \`poteto\`, \`explorer\`, \`investigator\`, \`candidate\`, \`judge\`, \`verifier\`, \`reviewer\`, \`owner\`, \`watcher\`, \`comment-sicko\`, or \`general\`. Its \`workspace\` is \`{ mode: "worktree", inputCommit }\` for a writable worker or \`{ mode: "readonly", path }\`, with an absolute \`path\`, for a worker limited to \`read\`, \`grep\`, \`find\`, \`ls\`, \`bash_readonly\`, and MCP tools. \`bash_readonly\` is an OS-sandboxed read-only shell that allows \`git\`, \`gh\`, and network reads and blocks writes. Its \`model\` is a model spec or \`inherit-parent\`. Its \`capabilities\` default to \`{ mcp: "inherit", env: "inherit", externalWrite: false }\`, with \`spawn\` false. A default written as a family and level, such as \`claude-opus-5-5-xhigh\` or \`grok-4.7-xhigh-fast\`, means that family's model at that thinking level, fast variant included. Spawn returns at once with a tmux attach command. A \`pstack-worker\` wake message reports each worker that settles. Then call \`collect\` for its report. Use \`inspect\` for live state, \`steer\` to redirect a live worker, and \`abort\` to stop one. A worker has no \`pstack_worker\` tool by default, so it does delegated work itself. A worker you assign \`capabilities.spawn: true\` has \`pstack_worker\` within the depth limit of three levels (you, it, and its workers). It owns its children's runs and receives their wakes, and its own children cannot get \`capabilities.spawn: true\`. A container worker has \`workspace: { mode: "container", inputCommit }\` and runs a writable clone of the pushed remote inside the container that \`.pi/environment.json\` configures, so \`inputCommit\` must be pushed first. Spawn refuses it with \`ContainerUnavailable\` when no container engine answers. Then a step that names a local fallback uses it, and a step without one reports itself blocked. A watch loop is a \`pstack_worker\` spawn with \`kind: "watch"\`. Its \`watch.argv\` runs in tmux in its \`watch.cwd\`, and its exit wakes you. A fixed interval uses \`["sleep", "<seconds>"]\`, and an event uses the watcher's command. A watch fires once. Spawn it again after each wake until the stop predicate holds. After a parent restart, re-arm each open watch loop from the run's \`TODO.md\` or plan, because nothing spawns it again on its own. The model rule is \`~/.pi/agent/pstack/models.json\`, and each of its role keys is a line.

**Defaults for every \`pstack_worker\` spawn.** Keep working after the spawn returns (a \`steer\` of a live worker too), because waiting on one worker holds your turn while other reports wait. Use \`workspace.mode: "worktree"\` unless the step asks for a readonly worker, file pointers not inlined context,`;

const TODO = `Start the run with \`node <pi-pstack>/scripts/start-run.mjs --playbook <name> --title <text>\`, where \`<pi-pstack>\` is the pi-pstack package root (\`pi list\` names it). It writes the run's \`TODO.md\` under \`.pi/pstack/runs/<runId>/\`, whose first items are the matched playbook's steps, copied in verbatim, before any task-specific todos under \`## Task-specific work\`. You are its only writer. Check a step as \`- [x] N. <text> (evidence: <receipt id>)\` once \`pstack_evidence\` \`verify\` passes for it. A step you choose not to do stays in the list as \`- [~] N. <text> (skip: <reason>)\`. A skill outside a playbook keeps its list under \`## Task-specific work\` in the active run's \`TODO.md\`. With no active run, it keeps the list in its reply and updates it at each phase.`;

const MODELS_JSON = `{
  "schemaVersion": 1,
  "budget": "large",
  "budgetLine": "large (xhigh)",
  "roles": {
    "feature, refactoring": "<provider>/grok-4.7-fast:xhigh",
    "bug-fix": "<provider>/grok-4.7-fast:xhigh",
    "perf-issue": "<provider>/grok-4.7-fast:xhigh",
    "hillclimb": "<provider>/grok-4.7-fast:xhigh",
    "judgment and prose": "<provider>/claude-opus-5-5:xhigh",
    "hardest tasks": "<provider>/claude-opus-5-5:xhigh",
    "how explorer": "<provider>/grok-4.7-fast:xhigh",
    "how explainer": "<provider>/claude-opus-5-5:xhigh",
    "why investigators": "<provider>/grok-4.7-fast:xhigh",
    "why synthesizer": "<provider>/claude-opus-5-5:xhigh",
    "reflect tooling": "<provider>/grok-4.7-fast:xhigh",
    "reflect judgment, divergent, synthesizer": "<provider>/claude-opus-5-5:xhigh",
    "arena runners": ["<provider>/claude-opus-5-5:xhigh", "<provider>/grok-4.7-fast:xhigh"],
    "arena cross-judge pool": ["<provider>/claude-opus-5-5:xhigh", "<provider>/grok-4.7-fast:xhigh"],
    "swarm workers": "<provider>/grok-4.7-fast:xhigh",
    "architect runners": ["<provider>/claude-opus-5-5:xhigh", "<provider>/grok-4.7-fast:xhigh"],
    "interrogate reviewers": ["<provider>/claude-opus-5-5:xhigh", "<provider>/grok-4.7-fast:xhigh"]
  }
}`;

const MDC_BLOCK = `---
description: pstack per-role model choices (overrides skill defaults)
alwaysApply: true
---
# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# \`inherit-parent\` or \`auto\` as a value: the role runs on the parent chat model (omit Task \`model\`). Alias entries in a panel list still count toward its fan-out.
# budget: large (xhigh)
feature, refactoring: grok-4.7-xhigh-fast
bug-fix: grok-4.7-xhigh-fast
perf-issue: grok-4.7-xhigh-fast
hillclimb: grok-4.7-xhigh-fast
judgment and prose: claude-opus-5-5-xhigh
hardest tasks: claude-opus-5-5-xhigh
how explorer: grok-4.7-xhigh-fast
how explainer: claude-opus-5-5-xhigh
why investigators: grok-4.7-xhigh-fast
why synthesizer: claude-opus-5-5-xhigh
reflect tooling: grok-4.7-xhigh-fast
reflect judgment, divergent, synthesizer: claude-opus-5-5-xhigh
arena runners: claude-opus-5-5-xhigh, grok-4.7-xhigh-fast
arena cross-judge pool: claude-opus-5-5-xhigh, grok-4.7-xhigh-fast
swarm workers: grok-4.7-xhigh-fast
architect runners: claude-opus-5-5-xhigh, grok-4.7-xhigh-fast
interrogate reviewers: claude-opus-5-5-xhigh, grok-4.7-xhigh-fast`;

function rule(id: string, primitives: PrimitiveId | PrimitiveId[], files: string | Record<string, number>, find: string, replace: string): Rule {
  return { id, primitives: Array.isArray(primitives) ? primitives : [primitives], find, replace, files: typeof files === 'string' ? { [files]: 1 } : files };
}

export const RULES: readonly Rule[] = [
  rule(
    'statechart.installed-entry',
    'cursor-path',
    SK('statechart/scripts/statechart'),
    'entry=$(dirname "$self")/statechart.ts',
    'entry=$(dirname "$self")/../../../../dist/statechart.js',
  ),
  rule(
    'statechart.installed-entry-test',
    'cursor-path',
    SK('statechart/scripts/test/cli.test.ts'),
    '`${path.join(here, "../statechart.ts")}\\n`',
    '`${path.dirname(launcher)}/../../../../dist/statechart.js\\n`',
  ),
  rule('statechart.bundled-worker', 'cursor-path', SK('statechart/scripts/statechart.ts'),
    'path.join(import.meta.dirname, "worker.ts"),',
    'path.join(import.meta.dirname, import.meta.url.endsWith(".js") ? "worker.js" : "worker.ts"),',
  ),
  rule('statechart.preinstalled-renderers', 'cursor-path', SK('statechart/scripts/test/render.test.ts'),
    "const cache = path.join(\n  process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), \".cache\"),\n  \"statechart\",\n);\nconst install = (name: string, ...packages: string[]) => {\n  const dir = path.join(cache, name);\n  execFileSync(\n    \"npm\",\n    [\"install\", \"--prefix\", dir, \"--no-audit\", \"--no-fund\", \"--save-exact\", ...packages],\n    { stdio: [\"ignore\", \"pipe\", \"pipe\"] },\n  );\n  return createRequire(path.join(dir, \"package.json\"));\n};\n",
    'const install = (_name: string, ..._packages: string[]) => createRequire(import.meta.url);\n',
  ),
  rule('statechart.no-renderer-child-process', 'cursor-path', SK('statechart/scripts/test/render.test.ts'),
    'import { execFileSync } from "node:child_process";\n', '',
  ),
  rule('statechart.no-renderer-cache-home', 'cursor-path', SK('statechart/scripts/test/render.test.ts'),
    'import os from "node:os";\n', '',
  ),
  rule(
    'watch-pr.installed-launcher',
    'cursor-path',
    SC('watch-pr/watch-pr'),
    '#!/usr/bin/env bun\nimport { ensureDependenciesInstalled } from "../bootstrap.ts";\n\nensureDependenciesInstalled();\nconst { main } = await import("./cli.ts");\nprocess.exitCode = await main(process.argv.slice(2));',
    '#!/usr/bin/env node\nif (process.versions.bun) {\n  const { main } = await import("./cli.ts");\n  process.exitCode = await main(process.argv.slice(2));\n} else {\n  await import("../../../../../dist/watch-pr.js");\n}',
  ),
  rule('watch-pr.bundle-entry', 'cursor-path', SC('watch-pr/cli.ts'),
    '  runtime.stdout(render(verdict));\n  return verdict.exitCode;\n}',
    '  runtime.stdout(render(verdict));\n  return verdict.exitCode;\n}\n\nif (import.meta.main) process.exitCode = await main(process.argv.slice(2));',
  ),
  // Shared constructs, each with an expected count per file.
  rule(
    'shared.task-tool-rejects',
    'task-tool',
    { [SK('poteto-mode/SKILL.md')]: 2, [SK('arena/SKILL.md')]: 3, [SK('swarm/SKILL.md')]: 1, [SK('how/SKILL.md')]: 1, [SK('why/SKILL.md')]: 1, [SK('reflect/SKILL.md')]: 1 },
    'the Task tool rejects',
    '`pstack_worker` spawn rejects',
  ),
  rule(
    'shared.model-unset',
    'task-tool',
    { [SK('how/SKILL.md')]: 1, [SK('why/SKILL.md')]: 1, [SK('reflect/SKILL.md')]: 1 },
    'Leave `model` unset when the value is `auto` or `inherit-parent`.',
    'Set `model` to `inherit-parent` when the value is `auto` or `inherit-parent`.',
  ),
  rule(
    'shared.models-mdc-path',
    'cursor-model-rule',
    { [SK('arena/SKILL.md')]: 2, [SK('swarm/SKILL.md')]: 1, [SK('setup-pstack/SKILL.md')]: 3, [SK('poteto-help/SKILL.md')]: 1 },
    '~/.cursor/rules/pstack-models.mdc',
    '~/.pi/agent/pstack/models.json',
  ),
  rule(
    'shared.models-mdc-rule',
    'cursor-model-rule',
    { [SK('architect/SKILL.md')]: 1, [SK('how/SKILL.md')]: 1, [SK('why/SKILL.md')]: 1, [SK('reflect/SKILL.md')]: 1 },
    'the `pstack-models.mdc` rule',
    'the model rule (`~/.pi/agent/pstack/models.json`)',
  ),
  rule(
    'shared.projects-glob',
    'cursor-transcripts',
    { [SK('reflect/SKILL.md')]: 1, [SK('automate-me/SKILL.md')]: 1, [SK('show-me-your-work/SKILL.md')]: 1, [PB('session-pickup')]: 1, [PB('eval')]: 1 },
    '`~/.cursor/projects/*/`',
    '`~/.pi/agent/sessions/*/`',
  ),
  rule(
    'shared.project-skills-path',
    'cursor-path',
    { [SK('automate-me/SKILL.md')]: 4, [SK('reflect/SKILL.md')]: 1, [SK('create-verification-skill/SKILL.md')]: 3, [SK('maintain-verification-skill/SKILL.md')]: 1 },
    '`.cursor/skills/',
    '`.pi/skills/',
  ),
  rule('shared.user-skills-path', 'cursor-path', { [SK('automate-me/SKILL.md')]: 2, [SK('reflect/SKILL.md')]: 1 }, '`~/.cursor/skills/', '`~/.pi/agent/skills/'),
  rule('shared.deslop-plugin', 'cursor-team-kit', { [SK('poteto-mode/SKILL.md')]: 1, [PB('autopilot-full')]: 1 }, 'the `deslop` skill from the `cursor-team-kit` plugin (`/deslop`)', 'the `deslop` skill shipped with pi-pstack (`/deslop`)'),
  rule(
    'shared.control-skill-plugin',
    'cursor-team-kit',
    { [PB('autopilot-full')]: 1, [PB('shipping')]: 1 },
    '(such as `control-ui` or `control-cli` from `cursor-team-kit`)',
    '(such as `control-ui` or `control-cli`, shipped with pi-pstack)',
  ),
  rule(
    'shared.phase-todolist',
    'todolist',
    { [SK('swarm/SKILL.md')]: 1, [SK('architect/SKILL.md')]: 1 },
    'Open a todolist with one entry per phase before',
    'Add one `TODO.md` entry per phase (the Playbooks section of the **poteto-mode** skill) before',
  ),
  rule(
    'shared.skill-used-evidence',
    ['host-tool-names', 'cursor-path', 'task-tool'],
    { [SK('reflect/references/judgment-reviewer.md')]: 1, [SK('reflect/references/tooling-reviewer.md')]: 1, [SK('reflect/references/divergent-reviewer.md')]: 1 },
    'a `Read` of its `SKILL.md` (under `.cursor/skills/`, `~/.cursor/skills/`, or `~/.cursor/plugins/`), a `Task` prompt naming its path, or a tool call (Shell, Grep, MCP, etc.)',
    'a `read` of its `SKILL.md` (under `.pi/skills/`, `~/.pi/agent/skills/`, `.agents/skills/`, `~/.agents/skills/`, or an installed Pi package), a `pstack_worker` brief naming its path, or a tool call (bash, grep, MCP, etc.)',
  ),
  rule('shared.prefer-askquestion', 'ask-question', { [SK('setup-pstack/SKILL.md')]: 2 }, 'Prefer AskQuestion over free text.', 'Prefer a multiple-choice question in the conversation over free text.'),

  // poteto-mode
  rule('poteto-mode.frontmatter-metadata', 'skill-frontmatter', SK('poteto-mode/SKILL.md'), 'icon: crown\ncolor: yellow\n', 'metadata:\n  icon: crown\n  color: yellow\n'),
  rule('poteto-mode.agent-prompt', 'subagent-type', SK('poteto-mode/SKILL.md'), 'in every `poteto-agent` prompt.', 'in every `role: "poteto"` worker brief.'),
  rule('poteto-mode.askquestion-fork', 'ask-question', SK('poteto-mode/SKILL.md'), '- About to `AskQuestion` on a', '- About to ask the user a question in the conversation on a'),
  rule(
    'poteto-mode.create-skill',
    'create-skill-builtin',
    SK('poteto-mode/SKILL.md'),
    "Agent-facing prose also follows the **create-skill** skill (Cursor's built-in for authoring SKILL.md files).",
    `Agent-facing prose also follows ${PI_SKILL_DOCS} for authoring SKILL.md files.`,
  ),
  rule('poteto-mode.control-plugin', 'cursor-team-kit', SK('poteto-mode/SKILL.md'), '`cursor-team-kit` publishes `control-cli`', 'pi-pstack ships `control-cli`'),
  rule(
    'poteto-mode.builtin-babysit',
    'cursor-builtin-babysit',
    SK('poteto-mode/SKILL.md'),
    "not Cursor's built-in babysit skill, whose description matches the same words",
    'not any other babysit skill whose description matches the same words',
  ),
  rule('poteto-mode.loop-phrase', 'loop', { [SK('poteto-mode/SKILL.md')]: 2 }, '"/loop until X"', '"loop until X"'),
  rule(
    'poteto-mode.subagent-role',
    'subagent-type',
    SK('poteto-mode/SKILL.md'),
    '**Use `subagent_type: "poteto-agent"` for any subagent you spawn inside a playbook step**',
    '**Use `role: "poteto"` in the assignment of any worker you spawn inside a playbook step**',
  ),
  rule(
    'poteto-mode.subagent-overrides',
    'subagent-type',
    SK('poteto-mode/SKILL.md'),
    "Never spawn a `poteto-agent` to run the playbook itself. Routed workflow skills (`how`, `why`, `interrogate`, `reflect`, `swarm`) set their own `subagent_type` for diverse-model review. Respect what the skill prescribes, don't override to `poteto-agent`.",
    'Never spawn a `role: "poteto"` worker to run the playbook itself. Routed workflow skills (`how`, `why`, `interrogate`, `reflect`, `swarm`) set their own `role` for diverse-model review. Respect what the skill prescribes, don\'t override to `poteto`.',
  ),
  rule(
    'poteto-mode.task-defaults',
    ['task-tool', 'run-in-background', 'task-resume', 'readonly', 'cloud-environment', 'loop'],
    SK('poteto-mode/SKILL.md'),
    '**Defaults for every `Task` call.** `run_in_background: true` (a steer or resume of a running agent too, because a foreground call holds your turn while other reports wait), agent mode (readonly strips MCP), file pointers not inlined context,',
    WORKERS,
  ),
  rule('poteto-mode.omit-model', 'task-tool', SK('poteto-mode/SKILL.md'), '(omit Task `model`)', '(assignment `model: "inherit-parent"`)'),
  rule('poteto-mode.task-error', 'task-tool', SK('poteto-mode/SKILL.md'), 'once a Task error says', 'once a `pstack_worker` error says'),
  rule(
    'poteto-mode.parent-model-fallback',
    'task-tool',
    SK('poteto-mode/SKILL.md'),
    "or omit `model` so the subagent runs on the parent model when the list has none. When the calling skill's fallback runs out of slugs without saying what to do next, omit `model` too.",
    'or set `model: "inherit-parent"` so the worker runs on the parent model when the list has none. When the calling skill\'s fallback runs out of slugs without saying what to do next, set `model: "inherit-parent"` too.',
  ),
  rule('poteto-mode.reuse', 'task-resume', SK('poteto-mode/SKILL.md'), 'Resume, message, or queue a follow-up on an existing subagent only when', '`steer` an existing worker only when'),
  rule('poteto-mode.interrupt-chained', 'task-resume', SK('poteto-mode/SKILL.md'), 'Interrupt-chained resumes', 'Interrupt-chained steers'),
  rule(
    'poteto-mode.todolist',
    'todolist',
    SK('poteto-mode/SKILL.md'),
    "Open a todolist whose first items are the matched playbook's steps, copied in verbatim, before any task-specific todos. A step you choose not to do stays in the list with a one-line `skip: <reason>`.",
    TODO,
  ),
  rule('poteto-mode.pickup-sources', ['cloud-environment'], SK('poteto-mode/SKILL.md'), 'from a transcript, cloud-agent URL, or pushed branch.', "from a session transcript, a worker's run directory, or pushed branch."),
  rule('poteto-mode.restart', 'cursor-host', SK('poteto-mode/SKILL.md'), 'a Cursor restart', 'a Pi restart'),

  // poteto-mode playbooks
  rule('authoring-a-skill.create-skill', 'create-skill-builtin', PB('authoring-a-skill'), "1. Use the **create-skill** skill (Cursor's built-in for authoring SKILL.md files).", `1. Follow ${PI_SKILL_DOCS} for authoring SKILL.md files.`),
  rule(
    'autonomous-run.wake',
    'loop',
    PB('autonomous-run'),
    "Pick the wake mechanism using Cursor's `/loop` command (a built-in, not a pstack skill).",
    `Pick the wake mechanism as a watch loop, ${watchWorker('["sleep", "<seconds>"]')}. A watch on an event puts the watcher's command, with absolute script paths, in place of \`sleep\` (the Subagents section).`,
  ),
  rule('autonomous-run.askquestion', 'ask-question', PB('autonomous-run'), 'or use `AskQuestion`.', 'or stop to ask the user a question.'),
  rule(
    'autopilot-full.owner',
    'cloud-environment',
    PB('autopilot-full'),
    'Each owner is a Cursor cloud agent that builds, opens its PR per `playbooks/opening-a-pr.md`, proves the change on the real artifact, babysits to green per `playbooks/babysit.md`, and merges once steps 4 and 5 clear it.',
    'Each owner is a container worker (`role: "owner"`, `workspace: { mode: "container", inputCommit }` at trunk) that builds, opens its PR per `playbooks/opening-a-pr.md`, proves the change on the real artifact, babysits to green per `playbooks/babysit.md`, and merges once steps 4 and 5 clear it. When spawn returns `ContainerUnavailable`, this step is blocked. Report it blocked and spawn no owner.',
  ),
  rule(
    'autopilot-full.trail',
    'project-tracker',
    PB('autopilot-full'),
    "start a decision trail in the root agent's store (path in the system prompt) per",
    "start a decision trail in your worker directory under the root's run (`.pi/pstack/runs/<runId>/workers/<workerId>/`, which your brief names) per",
  ),
  rule('autopilot-full.trail-records', 'project-tracker', PB('autopilot-full'), 'in that store, so the root can probe it', 'in that worker directory, so the root can probe it'),
  rule('autopilot-full.vm-dies', 'cloud-environment', PB('autopilot-full'), 'Assume the VM dies.', 'Assume the container dies.'),
  rule(
    'autopilot-full.loop',
    'loop',
    PB('autopilot-full'),
    "On the operator's go, arm `/loop 1h` to audit until no delegated work is left, because long runs drift and agents stall silently.",
    `On the operator's go, arm an hourly watch loop to audit until no delegated work is left, because long runs drift and agents stall silently. Spawn ${watchWorker('["sleep", "3600"]')}, run the tick when it wakes you, and spawn a fresh one after each wake until no delegated work is left. After a parent restart, re-arm it from the run's \`TODO.md\`.`,
  ),
  rule('autopilot-full.tick-from-trunk', 'upstream-repo-path', PB('autopilot-full'), 'Each tick re-reads this playbook from trunk', 'Each tick re-reads this playbook from the installed pi-pstack package'),
  rule('babysit.builtin-babysit', 'cursor-builtin-babysit', PB('babysit'), "This playbook replaces Cursor's built-in babysit skill for these requests", 'This playbook replaces any other babysit skill for these requests'),
  rule('babysit.loop', 'loop', PB('babysit'), 'Run `drive` and `background` under `/loop` in dynamic mode.', `Run \`drive\` and \`background\` under a watch loop, ${watchWorker(`["${POTETO_SCRIPTS}/watch-pr/watch-pr", <args>]`)}.`),
  rule('bug-fix.loop', 'loop', PB('bug-fix'), "Drive a long or stubborn hunt with Cursor's `/loop` command.", `Drive a long or stubborn hunt with a watch loop, ${watchWorker('["sleep", "<seconds>"]')}. To wake on the hunt's own check, put that check, with absolute script paths, in place of \`sleep\` (the Subagents section).`),
  rule(
    'eval.transcripts',
    'cursor-transcripts',
    PB('eval'),
    "Read each candidate's local transcript under the active workspace's `agent-transcripts/` directory (the system prompt names this path).",
    `Read each candidate's Pi session file under its worker directory (${WORKER_SESSIONS}).`,
  ),
  rule('multi-phase-plan.explore-role', 'subagent-type', PB('multi-phase-plan'), 'Explore in subagents with `subagent_type: "poteto-agent"` and', 'Explore in workers with `role: "poteto"` and'),
  rule(
    'multi-phase-plan.plan-path',
    ['plan-mode', 'project-tracker'],
    PB('multi-phase-plan'),
    "Unless the operator names a path, write the file under the agent store's `docs/`.",
    'Unless the operator names a path, write the file to `.pi/pstack/plans/<slug>.md` in the project.',
  ),
  rule('multi-phase-plan.bugbot-triage-path', 'upstream-repo-path', PB('multi-phase-plan'), '`../references/bugbot-triage.md`', '`<pi-pstack>/generated/skills/poteto-mode/references/bugbot-triage.md`'),
  rule('multi-phase-plan.shipping-path', 'upstream-repo-path', { [PB('multi-phase-plan')]: 2 }, '`playbooks/shipping.md`', '`<pi-pstack>/generated/skills/poteto-mode/playbooks/shipping.md`'),
  rule('multi-phase-plan.repo-path', 'upstream-repo-path', { [PB('multi-phase-plan')]: 10 }, 'pstack/skills/', '<pi-pstack>/generated/skills/'),
  rule('multi-phase-plan.git-show', 'upstream-repo-path', { [PB('multi-phase-plan')]: 5 }, 'git show origin/main:', 'cat '),
  rule('multi-phase-plan.read-from-trunk', 'upstream-repo-path', PB('multi-phase-plan'), 'Read these from trunk at program start.', 'Read these from the installed pi-pstack package at program start.'),
  rule('multi-phase-plan.tick-from-trunk', 'upstream-repo-path', PB('multi-phase-plan'), 'Re-read the execution playbook from trunk.', 'Re-read the execution playbook from the installed pi-pstack package.'),
  rule(
    'multi-phase-plan.control-plugin',
    'cursor-team-kit',
    PB('multi-phase-plan'),
    '`control-ui` from `cursor-team-kit`. CLIs and TUIs use `control-cli` from `cursor-team-kit`.',
    '`control-ui`. CLIs and TUIs use `control-cli`. Both ship with pi-pstack.',
  ),
  rule(
    'multi-phase-plan.loop',
    'loop',
    PB('multi-phase-plan'),
    'arm the audit tick as `/loop 1h` with the tick prompt below.',
    `arm the audit tick as an hourly watch loop with the tick prompt below. Spawn ${watchWorker('["sleep", "3600"]')}, run the tick when it wakes you, and spawn a fresh one after each wake until the plan's stop condition holds (every PR merged or at its handoff, or the operator's stand-down). After a parent restart, re-arm it from this plan.`,
  ),
  rule('multi-phase-plan.pr-tool', 'builtin-pr-tool', PB('multi-phase-plan'), "Use the run's built-in PR tool when it has one, else", 'Use the MCP forge tool when there is one, else'),
  rule(
    'multi-phase-plan.lane-vm',
    ['cloud-environment', 'cursor-team-kit'],
    PB('multi-phase-plan'),
    'Each live lane runs on its own cloud VM at the PR head. Drive through `control-ui` or `control-cli` from `cursor-team-kit`.',
    'Each live lane runs as its own container worker (`workspace: { mode: "container", inputCommit: <head SHA> }`). When spawn returns `ContainerUnavailable`, the lane takes the swarm skill\'s local fallback, `workspace: { mode: "worktree", inputCommit: <head SHA> }`. Drive through `control-ui` or `control-cli`.',
  ),
  rule('multi-phase-plan.review-video', 'cloud-environment', PB('multi-phase-plan'), 'on a lane VM.', 'on a lane worker.'),
  rule(
    'opening-a-pr.worktree',
    'task-tool',
    PB('opening-a-pr'),
    'Subagents inherit it. Multiple `Task` calls on the same branch each get their own worktree,',
    "Each worker gets its own worktree at its assignment's `inputCommit`. Multiple workers on the same branch each get their own worktree,",
  ),
  rule('opening-a-pr.deslop', 'cursor-team-kit', PB('opening-a-pr'), 'Run `/deslop` from `cursor-team-kit` over the diff', 'Run `/deslop` over the diff'),
  rule(
    'opening-a-pr.pr-tool',
    'builtin-pr-tool',
    PB('opening-a-pr'),
    '**Built-in PR tool.** When the run provides a built-in PR tool, create, edit, retarget, and mark ready through it, never through a forge CLI. A CLI-made PR misses what the tool tracks. Use the resolved forge for everything the tool does not cover, and for every PR operation when the run has no such tool.',
    '**PR tool.** When a Pi MCP forge tool for this repository is available, create, edit, retarget, and mark ready through it, never through a forge CLI. A CLI-made PR misses what that tool tracks. Use the resolved forge for everything the tool does not cover, and for every PR operation when there is no such tool.',
  ),
  rule('opening-a-pr.without-pr-tool', 'builtin-pr-tool', PB('opening-a-pr'), 'Without a built-in PR tool, per the resolved forge', 'Without an MCP forge tool, per the resolved forge'),
  rule(
    'opening-a-pr.draft',
    'builtin-pr-tool',
    PB('opening-a-pr'),
    'A built-in PR tool can default to draft, so set `draft: false` on every creation call through it.',
    'An MCP forge tool can default to draft, so set `draft: false` on every creation call through it.',
  ),
  rule('opening-a-pr.mark-ready', 'builtin-pr-tool', PB('opening-a-pr'), 'mark it ready through the PR tool', 'mark it ready through the MCP forge tool'),
  rule(
    'orchestrate.tools',
    ['task-tool', 'project-tracker'],
    PB('orchestrate'),
    "Spawn workers with `Task`. Keep the program's state in the Project tracker (`notes.md`) and the Project store. Watch each PR with PR and CI event subscriptions when your harness has them.",
    `Spawn workers with \`pstack_worker\`. Keep the program's state in the run root (\`.pi/pstack/runs/<runId>/\`): \`TODO.md\`, \`decisions.tsv\`, and a \`notes.md\` beside them. Watch each PR with a watch loop, ${watchWorker(`["${POTETO_SCRIPTS}/watch-pr/watch-pr", <args>]`)}. Its exit wakes you. That watch is the harness event, not one of your scripts or polling loops.`,
  ),
  rule(
    'orchestrate.cloud-workers',
    ['cloud-environment', 'cursor-team-kit'],
    PB('orchestrate'),
    'Run workers on a new cloud VM (`environment: "cloud"`) unless the work needs this machine: a `control-ui` or `control-cli` runtime check (from `cursor-team-kit`), local transcripts, a simulator, or auth that exists only here.',
    'Run workers as container workers (`workspace: { mode: "container", inputCommit }`) unless the work needs this machine: a `control-ui` or `control-cli` runtime check, local session files, a simulator, or auth that exists only here. Run those, and every worker while spawn returns `ContainerUnavailable`, on this machine with `workspace: { mode: "worktree", inputCommit }`.',
  ),
  rule(
    'orchestrate.fork',
    'task-resume',
    PB('orchestrate'),
    "**Fork when new work needs a worker's built state,** such as its checkout, uncommitted changes, or a running process. Message a worker only for a follow-up on the same work. Never message one to check on it, because a message restarts an idle agent.",
    "**Fork when new work needs a worker's built state,** such as its checkout, uncommitted changes, or a running process. To fork, once that worker settles, spawn a fresh worker from the source's committed state, with the source's report in its brief. Have the source commit its changes before it settles, and have the new brief restart any process the work needs, because neither carries over otherwise. For a local worktree worker (`workspace.mode: \"worktree\"`), the new `workspace.inputCommit` is the source's worktree `HEAD`. A source in a container has a checkout that is not visible here, so its brief has it push its branch before it settles, and the new `workspace.inputCommit` is that pushed head. When the source has no pushed head, report the fork blocked. Steer a worker only for a follow-up on the same work. Never steer one to check on it, because a steer starts a turn on an idle worker. Use `inspect` instead.",
  ),
  rule(
    'orchestrate.sub-coordinator',
    'task-tool',
    PB('orchestrate'),
    "**A sub-coordinator only when one area has many parallel workers.** It owns",
    "**A sub-coordinator only when one area has many parallel workers.** Spawn it with `capabilities.spawn: true`, which gives it `pstack_worker`. It owns",
  ),
  rule(
    'session-pickup.transcript',
    'cursor-transcripts',
    PB('session-pickup'),
    "A local transcript under the active workspace's `agent-transcripts/` directory (the system prompt names the path.",
    "A local Pi session file in this workspace's session folder (the directory of `$PI_SESSION_FILE`.",
  ),
  rule(
    'session-pickup.cloud-url',
    'cloud-environment',
    PB('session-pickup'),
    ', a cloud-agent URL, or a pushed branch.',
    `, a worker's run directory (\`.pi/pstack/runs/<runId>/workers/<workerId>/\`, with its \`report.md\` and ${WORKER_SESSIONS}), or a pushed branch.`,
  ),
  rule(
    'shipping.verifier',
    'cloud-environment',
    PB('shipping'),
    'One verifier per PR, each a Cursor cloud agent, runs the change',
    'One verifier per PR, each a container worker (`role: "verifier"`, `workspace: { mode: "container", inputCommit }` at the PR head), runs the change',
  ),
  rule(
    'shipping.verifier-unavailable',
    'cloud-environment',
    PB('shipping'),
    'Only a verdict from an agent that did not write the code counts,',
    'When spawn returns `ContainerUnavailable`, this step is blocked. Report it blocked and land nothing. Only a verdict from an agent that did not write the code counts,',
  ),
  rule('shipping.loop', 'loop', PB('shipping'), 'under `/loop` until it reports', `under a watch loop, ${watchWorker(`["${POTETO_SCRIPTS}/watch-pr/watch-pr", "--queued-stack", "--stack-prs", <bottom-to-top>]`)}, until it reports`),
  rule('visual-parity.loop', 'loop', PB('visual-parity'), '`/loop` per component until the diff is zero.', 'Run a watch loop per component until the diff is zero.'),
  rule('worktree-cleanup.worktree-path', 'cursor-path', PB('worktree-cleanup'), 'misses one that lives at `.cursor/worktrees/myrepo/x`', 'misses one that lives at `.pi/pstack/runs/<runId>/workers/<workerId>/worktree`'),
  rule(
    'worktree-cleanup.background',
    'await-shell',
    PB('worktree-cleanup'),
    'The transcript scan is slow, so background it.',
    `The transcript scan is slow, so run it as a watch, ${watchWorker(`["sh", "-c", "${POTETO_SCRIPTS}/worktree-audit.sh <args> > <absolute file>"]`)}. Keep working, and read \`<absolute file>\` when its exit wakes you.`,
  ),
  rule(
    'worktree-cleanup.audit-path',
    'upstream-repo-path',
    PB('worktree-cleanup'),
    'then run `scripts/worktree-audit.sh [-b <pr-base-ref>] [repo-path]`',
    `then run \`${POTETO_SCRIPTS}/worktree-audit.sh [-b <pr-base-ref>] [repo-path]\` from the repository root`,
  ),
  rule('worktree-cleanup.pinned-set', 'cursor-ui', PB('worktree-cleanup'), 'Get that set from the user or sidebar and', 'Get that set from the user and'),
  rule('worktree-cleanup.session-list', 'cursor-ui', PB('worktree-cleanup'), 'even when their names never hit the sidebar.', "even when their names never appear in `/resume`'s session list."),

  // poteto-mode scripts
  rule(
    'worktree-audit.transcripts',
    ['cursor-path', 'cursor-transcripts'],
    SC('worktree-audit.sh'),
    '# Transcripts dir: ~/.cursor/projects/<slugified-repo-path>/agent-transcripts.\nslug=$(printf \'%s\' "$main_wt" | sed \'s#^/##; s#/#-#g\')\ntranscripts="$HOME/.cursor/projects/$slug/agent-transcripts"',
    [
      '# Pi session storage, resolved the way Pi resolves it (docs/sessions.md, docs/environment-variables.md), once per',
      '# directory a session could have started in. Pi reads project settings from the session\'s working directory, so a',
      '# worktree\'s own .pi/settings.json decides where its sessions live. For each directory:',
      '# PI_CODING_AGENT_SESSION_DIR, else the sessionDir setting with the project\'s .pi/settings.json over the agent',
      '# directory\'s settings.json (an empty string in the project file still overrides the global one and means the',
      '# default), else <agent directory>/sessions. A leading ~ is the home directory, file:// is a URL, and a relative',
      '# sessionDir resolves from that directory.',
      'pi_home() {',
      '	case "$1" in',
      '	"~") printf \'%s\\n\' "$HOME" ;;',
      '	"~"/*) printf \'%s\\n\' "$HOME/${1#"~/"}" ;;',
      '	file://*) printf \'%b\\n\' "$(printf \'%s\' "${1#file://}" | sed \'s/%\\(..\\)/\\\\x\\1/g\')" ;;',
      '	*) printf \'%s\\n\' "$1" ;;',
      '	esac',
      '}',
      'agent_dir=$(pi_home "${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}")',
      'pi_session_dir() {',
      '	local cwd=$1 dir="" settings value',
      '	if [ -n "${PI_CODING_AGENT_SESSION_DIR:-}" ]; then',
      '		dir=$(pi_home "$PI_CODING_AGENT_SESSION_DIR")',
      '	else',
      '		for settings in "$cwd/.pi/settings.json" "$agent_dir/settings.json"; do',
      '			[ -f "$settings" ] || continue',
      '			value=$(jq -r \'if (.sessionDir | type) == "string" then "s" + .sessionDir else "" end\' "$settings" 2>/dev/null)',
      '			if [ -n "$value" ]; then dir=$(pi_home "${value#s}"); break; fi',
      '		done',
      '		[ -z "$dir" ] && dir="$agent_dir/sessions"',
      '	fi',
      '	case "$dir" in /*) printf \'%s\\n\' "$dir" ;; *) printf \'%s\\n\' "$cwd/$dir" ;; esac',
      '}',
      'transcript_roots=()',
      'while IFS= read -r start_dir; do',
      '	[ -n "$start_dir" ] || continue',
      '	root=$(pi_session_dir "$start_dir")',
      '	[ -d "$root" ] || continue',
      '	case " ${transcript_roots[*]-} " in *" $root "*) ;; *) transcript_roots+=("$root") ;; esac',
      'done < <(printf \'%s\\n\' "$invoked_from"; git worktree list --porcelain | awk \'/^worktree /{print $2}\')',
    ].join('\n'),
  ),
  rule(
    'worktree-audit.invoked-from',
    'cursor-path',
    SC('worktree-audit.sh'),
    'cd "$repo" || exit 1',
    'invoked_from=$PWD\ncd "$repo" || exit 1',
  ),
  rule(
    'worktree-audit.transcript-search',
    ['cursor-path', 'cursor-transcripts'],
    SC('worktree-audit.sh'),
    'if [ -d "$transcripts" ]; then\n\t\tf=$(rg -l -e "${wt}/" -e "${wt}\\"" "$transcripts" 2>/dev/null',
    'if [ "${#transcript_roots[@]}" -gt 0 ]; then\n\t\tf=$(rg -l -e "${wt}/" -e "${wt}\\"" "${transcript_roots[@]}" 2>/dev/null',
  ),
  rule(
    'check-plan.loop-marker',
    'loop',
    SC('check-plan.mjs'),
    'const PROGRAM_MARKERS = ["git show origin/main:", "/loop 1h", "status message"];',
    'const PROGRAM_MARKERS = ["<pi-pstack>/generated/skills/", \'["sleep", "3600"]\', "status message"];',
  ),
  rule('check-plan.test-fixture', 'loop', SC('check-plan.test.ts'), '\\`git show origin/main:\\` /loop 1h status message', '\\`cat <pi-pstack>/generated/skills/\\` ["sleep", "3600"] status message'),

  // agents
  rule('poteto-agent.owner', ['todolist', 'task-tool'], AG('poteto-agent'), 'owns the playbook, the todo list, and every Task spawn.', "owns the playbook, the run's `TODO.md`, and every `pstack_worker` spawn."),
  rule(
    'poteto-agent.locate',
    'cursor-path',
    AG('poteto-agent'),
    'search `~/.cursor/plugins/` for a file whose path ends in `skills/poteto-mode/SKILL.md`. If more than one file matches, use the copy whose `.cursor-plugin/plugin.json` has the highest `version`.',
    'search the installed Pi packages (`pi list` names them) for a file whose path ends in `generated/skills/poteto-mode/SKILL.md`. If more than one file matches, use the copy whose package `package.json` has the highest `version`.',
  ),
  rule(
    'poteto-agent.worker-contract',
    'task-tool',
    AG('poteto-agent'),
    'Navigate to a leaf `principle-*` skill whenever you apply that principle.\n',
    `Navigate to a leaf \`principle-*\` skill whenever you apply that principle.\n\n${WORKER_CONTRACT}`,
  ),
  rule(
    'comment-sicko.worker-contract',
    'task-tool',
    AG('comment-sicko'),
    'Report only. Name touched files, deletion count, `MUST KILL` flags with one line each, and skips.\n',
    `Report only. Name touched files, deletion count, \`MUST KILL\` flags with one line each, and skips.\n\n${WORKER_CONTRACT}`,
  ),

  // other pstack skills
  rule(
    'arena.todolist',
    'todolist',
    SK('arena/SKILL.md'),
    'Open a todolist with one entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything.',
    'Add one `TODO.md` entry per phase (Frame, Fan out, Cross-judge, Pick, Graft, Verify) before launching anything, per the Playbooks section of the **poteto-mode** skill.',
  ),
  rule('arena.alias-model', 'task-tool', SK('arena/SKILL.md'), 'so omit `model` for it.', 'so set `model: "inherit-parent"` for it.'),
  rule('arena.added-runner-model', 'task-tool', SK('arena/SKILL.md'), 'or omit `model` so it runs on the parent model when none remain', 'or set `model: "inherit-parent"` so it runs on the parent model when none remain'),
  rule(
    'arena.fan-out',
    ['run-in-background', 'task-tool'],
    SK('arena/SKILL.md'),
    'Spawn all N subagents in one message with `run_in_background: true`, each with',
    'Spawn all N workers one after another without waiting, each with `role: "candidate"` in its own worktree, and each with',
  ),
  rule('arena.judge', 'readonly', SK('arena/SKILL.md'), 'Spawn one readonly judge subagent.', `Spawn one judge worker with \`role: "judge"\` and ${READONLY_AT_ROOT}.`),
  rule('automate-me.description', 'create-skill-builtin', SK('automate-me/SKILL.md'), 'via create-skill + unslop', "via Pi's skill authoring docs + unslop"),
  rule('automate-me.orchestrates', 'create-skill-builtin', SK('automate-me/SKILL.md'), "Cursor's built-in `create-skill` (authoring)", `${PI_SKILL_DOCS} with ${AUTHORING} (authoring)`),
  rule('automate-me.confirm-intent', 'ask-question', SK('automate-me/SKILL.md'), 'confirm intent with `AskQuestion` (unless', 'confirm intent with a multiple-choice question in the conversation (unless'),
  rule(
    'automate-me.transcripts',
    'cursor-transcripts',
    SK('automate-me/SKILL.md'),
    "The system prompt names the workspace's `agent-transcripts/` directory. Use only that path.",
    `They are the Pi session files in ${SESSION_FOLDER}. Use only that path.`,
  ),
  rule(
    'automate-me.ask-directly',
    'ask-question',
    SK('automate-me/SKILL.md'),
    'Use the `AskQuestion` tool (structured multi-choice) rather than asking the user to type from scratch.',
    'Ask structured multiple-choice questions in the conversation, with numbered options, rather than asking the user to type from scratch.',
  ),
  rule('automate-me.allow-multiple', 'ask-question', SK('automate-me/SKILL.md'), '`allow_multiple: true` for category questions', 'several picks allowed for category questions'),
  rule('automate-me.draft', 'create-skill-builtin', SK('automate-me/SKILL.md'), "Use Cursor's built-in `create-skill` skill to author the skill.", `Author the skill with ${AUTHORING} and ${PI_SKILL_DOCS}.`),
  rule('automate-me.yaml-rules', 'create-skill-builtin', SK('automate-me/SKILL.md'), "follow `create-skill`'s YAML rules", "follow the frontmatter rules in Pi's Agent Skills documentation"),
  rule('automate-me.writing-guidelines', 'create-skill-builtin', SK('automate-me/SKILL.md'), "and `create-skill`'s writing guidelines to every line", "and the Authoring a skill playbook's writing guidance to every line"),
  rule(
    'automate-me.benchmark-loop',
    'create-skill-builtin',
    SK('automate-me/SKILL.md'),
    "A `create-skill`-style test/iterate benchmark loop isn't useful here.",
    "A test/iterate benchmark loop, like the Authoring a skill playbook's test cases, isn't useful here.",
  ),
  rule('automate-me.task-skill', 'create-skill-builtin', SK('automate-me/SKILL.md'), '`create-skill` alone, no mining required.', 'the Authoring a skill playbook alone, no mining required.'),
  rule(
    'figure-it-out.todolist',
    'todolist',
    SK('figure-it-out/SKILL.md'),
    'Open a todolist whose first item is to read the Principles section of the **poteto-mode** skill.',
    "Open the run's `TODO.md` list (the Playbooks section of the **poteto-mode** skill) with a first item to read the Principles section of the **poteto-mode** skill.",
  ),
  rule('figure-it-out.add-steps', 'todolist', SK('figure-it-out/SKILL.md'), 'Add its steps to the todolist as concrete items', 'Add its steps to `TODO.md` as concrete items'),
  rule(
    'how.spawn',
    ['task-tool', 'subagent-type', 'readonly'],
    SK('how/SKILL.md'),
    'Every spawn is a Task subagent with `subagent_type: generalPurpose` and `readonly: true`.',
    `Every spawn is a \`pstack_worker\` worker with ${READONLY_AT_ROOT}, \`role: "explorer"\` for explorers and \`role: "general"\` for explainers.`,
  ),
  rule('how.explainer-tools', 'host-tool-names', SK('how/references/explainer-prompt.md'), 'Use Read, Grep, and Glob as needed.', 'Use `read`, `grep`, and `find` as needed.'),
  rule(
    'architect.runner-template-path',
    'upstream-repo-path',
    SK('architect/references/runner-prompt.md'),
    'shaped per [`rationale-template.md`](rationale-template.md).',
    'shaped per [`<pi-pstack>/generated/skills/architect/references/rationale-template.md`](rationale-template.md).',
  ),
  rule('why.synthesizer-epistemics-path', 'upstream-repo-path', SK('why/references/synthesizer-prompt.md'), 'You MUST follow `references/epistemics.md`.', 'You MUST follow `<pi-pstack>/generated/skills/why/references/epistemics.md`.'),
  rule('interrogate.adversary-role', 'subagent-type', SK('interrogate/SKILL.md'), 'Spawn each adversary as `generalPurpose`.', 'Spawn each adversary with `role: "reviewer"`.'),
  rule('ketchup.visual', 'visualize', SK('ketchup/SKILL.md'), 'a chart or diagram from `/visualize`,', 'a chart or diagram from a Mermaid block,'),
  rule('ketchup.chart', 'visualize', SK('ketchup/SKILL.md'), 'and a `/visualize` chart for numbers', 'and a Mermaid chart (such as `xychart-beta`) for numbers'),
  rule('make-bot-ui.grok-bot', 'cursor-automations', { [SK('make-bot-ui/SKILL.md')]: 2 }, 'Grok Bot', 'Pi agent session'),
  rule('make-bot-ui.description-key', 'cursor-automations', SK('make-bot-ui/SKILL.md'), 'when the user must provide a webhook sender key', 'when a webhook sender key must be set up'),
  rule(
    'make-bot-ui.create-routine',
    'cursor-automations',
    SK('make-bot-ui/SKILL.md'),
    'Call `update_state` with target `routine` and action `create`. Set these fields:',
    `Write the routine prompt to a local file. Create the routine with \`node <pi-pstack>/scripts/routine-setup.mjs --project <absolute repository root> --name <routine folder slug> --prompt-file <prompt file>\`. Setup preserves existing configuration and credentials. A conflicting configuration fails without replacing it. The routine config lives under \`<project>/.pi/pstack/automation/<name>/config.json\`. The automation event adapter (${U08}) exports \`createRoutine\` and \`startRoutineSource\` for embedded receivers.

A bot UI needs a routine with these fields:`,
  ),
  rule(
    'make-bot-ui.start-routine',
    'cursor-automations',
    SK('make-bot-ui/SKILL.md'),
    'If `update_state` shows a confirm card, wait for the user to confirm.\nThe folder slug is the kebab-case form of the name.\nUse that slug later as the secret `connector`.\nThe create result does not include the sender key.',
    "Use a kebab-case folder slug of at most 40 characters. Start the receiver as a persistent server process with `node <pi-pstack>/scripts/routine-setup.mjs --project <absolute repository root> --name <routine folder slug> --serve`. It reports the actual receiver URL. Use `--port 0` for an available ephemeral port, or a fixed `--port <port>` for restarts. It binds to localhost. A remote deployment must run this receiver on that server and expose it through a trusted proxy. Each accepted event starts a fresh Pi worker. Use the slug as the credential name.",
  ),
  rule(
    'make-bot-ui.copy-url',
    ['cursor-automations', 'cursor-ui'],
    SK('make-bot-ui/SKILL.md'),
    "The webhook URL and the sender key live on that routine's panel after the routine exists. Do not invent other clicks.\n\nTell the user to do this:\n\n1. Click this agent's name in the chat header, or press **Cmd+Shift+I**.\n2. Find the **Routines** list under the computer preview.\n3. Open this webhook routine.\n4. Copy the webhook URL. The user may paste the URL in chat.\n5. Copy the sender key. The user must not paste the sender key in chat.\n\nThe URL looks like `https://api2.cursor.sh/automations/webhook/<id>` with no query string. Copy the URL from the routine. Do not guess the id.",
    "Copy the `url` reported by the running receiver, `http://127.0.0.1:<port>/events`. Do not guess the port. The sender key is the `key` field of `~/.pi/agent/pstack/credentials/<routine folder slug>.json`. The UI server reads that file directly at runtime. Never print its contents or ask the user to paste the key.",
  ),
  rule(
    'make-bot-ui.generate-key',
    'cursor-automations',
    SK('make-bot-ui/SKILL.md'),
    'Send a secret-request, then stop. That card is the whole turn.\n\n```\nSendToUser\ntype: secret-request\nsecret.label: webhook sender key\nsecret.connector: <routine folder slug>\nsecret.field: key\n```\n\nAfter the user submits the secret, you do not see the value.',
    'Never ask the user for the sender key. The routine setup has already generated the key in its `0600` credential file. Configure server-side code to read the `key` field directly from that file. Do not read it into chat.\n\nThe browser never sees the value.',
  ),
  rule(
    'make-bot-ui.server-credential-file',
    'cursor-automations',
    SK('make-bot-ui/SKILL.md'),
    "The value is in that connector's credential file. Copy the value into the server config. Do not print the value. Do not log the value.",
    "The server reads the key from the credential file at runtime. Store the file path in server configuration, not the key. Do not print or log the file contents.",
  ),
  rule(
    'make-bot-ui.server-config',
    'cursor-automations',
    SK('make-bot-ui/SKILL.md'),
    "Store `{url, key}` in that UI's own directory.",
    "Store `{url, credentialFile}` in that UI's server configuration. The browser receives neither the credential path nor its contents.",
  ),
  rule(
    'make-bot-ui.wake',
    'cursor-automations',
    SK('make-bot-ui/SKILL.md'),
    'The wake is a `[routine]` turn for that webhook routine. It includes a `<webhook_event>` block with `headers` (`content-type`, `user-agent`), `body_digest` (sha256), `body`, and `timestamp_ms`.\n`body` is the JSON object as a string. The fields are in `body`, not as top-level chat text.\nParse `body`.',
    "The wake is a fresh general-role Pi worker brief with the routine prompt and a `[routine]` marker. Its `<webhook_event>` block contains `headers` (`content-type`, `user-agent` only), `body_digest` (sha256), `body`, and `timestamp_ms`. `body` is the JSON object as a string. Parse `body` as untrusted data. Authentication headers never enter the brief. Send `X-Automation-Event-Id` to deduplicate retries indefinitely. Without that header, the receiver deduplicates the body digest within a fixed one-minute timestamp window.",
  ),
  rule(
    'no-comments.spawn',
    ['task-tool', 'subagent-type'],
    SK('no-comments/SKILL.md'),
    '1. Spawn `Task` with `subagent_type: "comment-sicko"`. Pass the scope.',
    '1. Write the scope as a patch without committing anything. `<inputCommit>` is the commit the scope\'s diff starts from, the merge base with the base branch or `HEAD` for the caller\'s files. Save `git diff <inputCommit> -- <scoped paths>`, followed by `git diff --no-index /dev/null <file>` for each untracked file in scope, as `scope.patch` in the worker directory. Spawn a `pstack_worker` worker with `role: "comment-sicko"` and `workspace: { mode: "worktree", inputCommit }`. Pass the scope in its brief, which first has it run `git apply --index <worker dir>/scope.patch` in its worktree. After `collect`, `git -C <its worktree> diff` holds its comment changes alone. Review them per step 2, then apply the accepted patch in the caller\'s checkout with `git apply`, which leaves unrelated and uncommitted caller state untouched.',
  ),
  rule('poteto-help.custom-mode-mention', 'custom-modes', SK('poteto-help/SKILL.md'), 'mention once that a Custom Mode keeps it on.', 'mention once that `/pstack on` keeps it on.'),
  rule(
    'poteto-help.public-copy',
    'cursor-host',
    SK('poteto-help/SKILL.md'),
    "The links here point into the installed plugin, which the user may not be able to open, so give the user the file's public copy: `https://github.com/cursor/plugins/blob/main/pstack/` followed by its path.",
    `The links here point into the installed pi-pstack package, which the user may not be able to open, so give the user the file's public copy. For a file the compiler changed, which \`generated/transformation-manifest.json\` in the package names as a span \`output\`, or a file pi-pstack added, the public copy is \`${PI_PSTACK_PUBLIC}/generated/skills/\` followed by its path under \`skills/\`. For any other skill file, which the compiler copied unchanged, it is the pinned upstream copy, \`${UPSTREAM_PSTACK}/skills/\` followed by the same path.`,
  ),
  rule(
    'poteto-help.install',
    'cursor-ui',
    SK('poteto-help/SKILL.md'),
    '1. Install with `/add-plugin pstack` in chat, or from Customize in the sidebar.',
    '1. Install with `pi install npm:@justjoshn/pi-pstack`, then run `/reload` in an open session.',
  ),
  rule('poteto-help.setup-writes', 'cursor-model-rule', SK('poteto-help/SKILL.md'), 'and writes a rule. The rule applies to new chats.', 'and writes `~/.pi/agent/pstack/models.json`. The file applies to every later worker spawn.'),
  rule('poteto-help.readme-link', 'upstream-repo-path', SK('poteto-help/SKILL.md'), '](../../README.md)', `](${UPSTREAM_PSTACK}/README.md)`),
  rule('poteto-help.guide-links', 'upstream-repo-path', { [SK('poteto-help/SKILL.md')]: 7 }, '](../../docs/guide/', `](${UPSTREAM_PSTACK}/docs/guide/`),
  rule(
    'poteto-help.other-hosts',
    ['cursor-host', 'cursor-ui', 'bugbot', 'cursor-automations'],
    SK('poteto-help/SKILL.md'),
    'pstack is built for Cursor, and it also installs in Claude Code with `/plugin marketplace add cursor/plugins`, then `/plugin install pstack@cursor-plugins`. There, each command takes a `pstack:` prefix, such as `/pstack:poteto-mode`. The [Claude Code adapter](../../docs/harness/claude-code.md) maps the Cursor names, and a step that needs a Cursor-only feature, such as Bugbot or Automations, is skipped with a one-line note.',
    'pi-pstack compiles the pstack skills for Pi from a pinned upstream revision and maps each host feature to a Pi mechanism. `generated/transformation-manifest.json` in the package lists every changed span.',
  ),
  rule(
    'poteto-help.agent-skills-format',
    ['cursor-host', 'custom-modes', 'loop'],
    SK('poteto-help/SKILL.md'),
    'spawn Cursor subagents with per-role models, and Custom Modes and `/loop` are Cursor features, so those parts may not work there.',
    'spawn pstack workers through the pi-pstack extension with per-role models, and `/pstack on` and watch loops are pi-pstack features, so those parts may not work there.',
  ),
  rule('poteto-help.todo-list', 'todolist', SK('poteto-help/SKILL.md'), "copies the playbook's steps into the todo list,", "copies the playbook's steps into the run's `TODO.md`,"),
  rule(
    'poteto-help.mode-stays-on',
    ['custom-modes', 'cursor-host'],
    SK('poteto-help/SKILL.md'),
    "- Enter on `/poteto-mode` attaches the skill to one message. It fades as the chat moves on.\n- Option+Enter on Mac or Alt+Enter on Windows, or Use as Mode from the skill entry, makes it a Custom Mode. It stays in context every turn until the user exits the mode, and it stays out of casual turns.\n- Cursor's docs list Custom Modes in the Agents Window and the CLI. Elsewhere, start each new task with `/poteto-mode`.",
    '- `/poteto-mode <task>` attaches the skill to one message. It fades as the chat moves on.\n- `/pstack on` keeps the pstack style on. It applies at each task boundary until `/pstack off`, and it stays out of casual turns.\n- Without the pi-pstack extension, start each new task with `/poteto-mode`.',
  ),
  rule(
    'poteto-help.skills-docs',
    'cursor-host',
    SK('poteto-help/SKILL.md'),
    "Link [Cursor's skills docs](https://cursor.com/docs/skills) when this comes up.",
    "Link [Pi's skills docs](https://github.com/earendil-works/pi/blob/d78a75ecb26d730ad95c407f2e44ce205d5880ce/packages/coding-agent/docs/skills.md) when this comes up.",
  ),
  rule(
    'poteto-help.own-subagent',
    'subagent-type',
    SK('poteto-help/SKILL.md'),
    '`/poteto-mode` already uses `poteto-agent` for the subagents its playbook steps spawn. To get the same style from a subagent of your own, spawn it with `subagent_type: "poteto-agent"`.',
    '`/poteto-mode` already uses the `poteto` worker role for the workers its playbook steps spawn. To get the same style from a worker of your own, spawn it with `role: "poteto"`.',
  ),
  rule('poteto-help.swarm-row', 'cloud-environment', SK('poteto-help/SKILL.md'), 'or race workers, as cloud agents |', 'or race workers, as container workers |'),
  rule('poteto-help.bot-ui-row', 'cursor-automations', SK('poteto-help/SKILL.md'), 'wake a Grok Bot over a webhook', 'wake a Pi agent session over a webhook'),
  rule(
    'poteto-help.not-in-pstack',
    ['cursor-team-kit', 'loop', 'create-skill-builtin', 'cursor-host'],
    SK('poteto-help/SKILL.md'),
    '- `/deslop`, `control-cli`, and `control-ui` ship in the `cursor-team-kit` plugin.\n- `/loop` and `/create-skill` are Cursor built-ins.',
    "- `/deslop`, `control-cli`, `control-ui`, and `verify-this` are team-kit skills that pi-pstack ships beside pstack.\n- Watch loops and `/pstack on` come from the pi-pstack extension, and skill authoring follows Pi's Agent Skills documentation.",
  ),
  rule('poteto-help.own-babysit', 'cursor-builtin-babysit', SK('poteto-help/SKILL.md'), "can start Cursor's own skill for the same job instead.", 'can start another installed skill for the same job instead.'),
  rule(
    'poteto-help.plan-mode',
    'plan-mode',
    SK('poteto-help/SKILL.md'),
    "pstack has no planning skill. Cursor's Plan Mode works alongside it.",
    'pstack has no planning skill, and Pi has no plan mode. A plan is a Markdown file under `.pi/pstack/plans/`.',
  ),
  rule(
    'poteto-help.symptom-mode',
    'custom-modes',
    SK('poteto-help/SKILL.md'),
    '| It was started with Enter. Start it as a Custom Mode, or start each task with `/poteto-mode`. |',
    '| It was attached to one message. Turn it on with `/pstack on`, or start each task with `/poteto-mode`. |',
  ),
  rule(
    'poteto-help.symptom-model',
    'cursor-model-rule',
    SK('poteto-help/SKILL.md'),
    '| The rule from `/setup-pstack` applies to new chats. Start one. |',
    '| `/setup-pstack` writes `~/.pi/agent/pstack/models.json`, which applies at the next worker spawn. Check that file. |',
  ),
  rule('poteto-help.symptom-overwrite', 'cloud-environment', SK('poteto-help/SKILL.md'), 'or run them as cloud agents, which each get their own machine.', 'or run them as container workers, which each get their own filesystem.'),
  rule('poteto-help.symptom-overnight', 'loop', SK('poteto-help/SKILL.md'), '| `/loop` needs a check that can pass or fail', '| A watch loop needs a check that can pass or fail'),
  rule('poteto-help.prompting-loop', 'loop', SK('poteto-help/references/prompting.md'), 'give `/loop` that predicate', 'give the watch loop that predicate'),
  rule('poteto-help.recipe-loop', 'loop', SK('poteto-help/references/recipes.md'), '/loop until done.', 'loop until done.'),
  rule(
    'recall.transcripts',
    ['cursor-path', 'cursor-transcripts'],
    SK('recall/SKILL.md'),
    'Transcripts live at `~/.cursor/projects/<slug>/agent-transcripts/<uuid>/<uuid>.jsonl`, where `<slug>` is the workspace path with the leading slash dropped and each "/" turned into "-" (so `/Users/you/proj` becomes `Users-you-proj`). Every line is one chat message.',
    `Transcripts are Pi session files at \`~/.pi/agent/sessions/--<slug>--/<timestamp>_<uuid>.jsonl\`, where \`<slug>\` is the workspace path with the leading slash dropped and each "/" turned into "-" (so \`/Users/you/proj\` becomes \`--Users-you-proj--\`). Every line is one session entry, and chat messages have \`type: "message"\`. pstack workers keep theirs under ${WORKER_SESSIONS} in the project.`,
  ),
  rule(
    'reflect.locate',
    'cursor-transcripts',
    SK('reflect/SKILL.md'),
    "find this conversation's transcript in the `agent-transcripts/` directory the system prompt names.",
    "find this conversation's Pi session file. `$PI_SESSION_FILE` names it, in this workspace's session folder under `~/.pi/agent/sessions/`.",
  ),
  rule(
    'reflect.ls',
    'cursor-transcripts',
    SK('reflect/SKILL.md'),
    'ls -t <agent-transcripts>/*.jsonl <agent-transcripts>/*/*.jsonl <agent-transcripts>/*/subagents/*.jsonl 2>/dev/null | head -10',
    'ls -t "$(dirname "$PI_SESSION_FILE")"/*.jsonl .pi/pstack/runs/*/workers/*/session/*.jsonl 2>/dev/null | head -10',
  ),
  rule(
    'reflect.layouts',
    'cursor-transcripts',
    SK('reflect/SKILL.md'),
    'That covers the legacy flat (`<id>.jsonl`), current nested (`<id>/<id>.jsonl`), and subagent (`<parent>/subagents/<child>.jsonl`) layouts. For each candidate, read the first JSONL line.',
    "That covers this workspace's sessions and the pstack worker sessions under the project's run root. For each candidate, read its first entry of type `message` whose `message.role` is `user`, because a Pi session file opens with a `system` message.",
  ),
  rule(
    'reflect.reviewers',
    ['task-tool', 'subagent-type', 'readonly'],
    SK('reflect/SKILL.md'),
    'One message, three `Task` calls, `subagent_type: generalPurpose`, agent mode (`readonly: false`). Reviewers need MCP access to look up the tickets, chat threads, and observability traces the transcript references, and readonly strips MCPs.',
    `Three \`pstack_worker\` spawns, one after another without waiting, each with \`role: "reviewer"\`, ${READONLY_AT_ROOT}, and \`capabilities.mcp: "inherit"\`. Reviewers need MCP access to look up the tickets, chat threads, and observability traces the transcript references. A readonly Pi worker keeps its MCP tools, and \`capabilities.mcp: "none"\` would strip them.`,
  ),
  rule('reflect.response-body', 'task-tool', SK('reflect/SKILL.md'), 'Reviewers return findings in the `Task` response body.', 'Reviewers return findings in their final reply, which `collect` returns.'),
  rule('reflect.synth-spawn', ['task-tool', 'subagent-type'], SK('reflect/SKILL.md'), 'One `Task` call, `subagent_type: generalPurpose`, `model`', 'One `pstack_worker` spawn, `role: "general"`, `model`'),
  rule(
    'reflect.synth-mode',
    'readonly',
    SK('reflect/SKILL.md'),
    ', agent mode (`readonly: false`). It spot-verifies citations through MCP, and readonly strips MCPs.',
    `, ${READONLY_AT_ROOT}, \`capabilities.mcp: "inherit"\`. It spot-verifies citations through MCP, which a readonly Pi worker keeps.`,
  ),
  rule('reflect.plugin-cache', 'cursor-path', SK('reflect/SKILL.md'), 'Never edit a skill under `plugins/cache/`.', 'Never edit a skill inside an installed Pi package.'),
  rule('reflect.substantive-edit', 'create-skill-builtin', SK('reflect/SKILL.md'), "hand to Cursor's built-in `create-skill` skill and run its draft / test / iterate loop.", `follow ${AUTHORING}, including its test cases.`),
  rule(
    'reflect.tune-description',
    'create-skill-builtin',
    SK('reflect/SKILL.md'),
    'hand to `create-skill` and run its description-optimization loop.',
    `rewrite the skill's \`description\` per ${PI_SKILL_DOCS}, then check that it triggers on the request it missed.`,
  ),
  rule('reflect.new-skill', 'create-skill-builtin', SK('reflect/SKILL.md'), '`new skill via create-skill: <kebab-name>`: hand creation to `create-skill`.', `\`new skill via authoring playbook: <kebab-name>\`: create it with ${AUTHORING}.`),
  rule('reflect.synthesizer-new-skill', 'create-skill-builtin', { [SK('reflect/references/synthesizer.md')]: 3 }, 'new skill via create-skill', 'new skill via authoring playbook'),
  rule('setup-pstack.description', 'cursor-model-rule', SK('setup-pstack/SKILL.md'), 'writes an always-applied rule that overrides the skill defaults.', 'writes `~/.pi/agent/pstack/models.json`, which overrides the skill defaults.'),
  rule('setup-pstack.purpose', 'cursor-model-rule', SK('setup-pstack/SKILL.md'), ", an always-applied rule that sets pstack's model per role.", ', the model configuration every pstack skill reads to set its model per role.'),
  rule(
    'setup-pstack.detect',
    ['task-tool', 'cursor-host'],
    SK('setup-pstack/SKILL.md'),
    "Enumerate the model slugs you can pass to a `Task` subagent in this session. That is the dependable source. If Cursor also exposes a models API or CLI that lists the user's entitled models, prefer it for completeness.",
    'Enumerate the models you can pass to a `pstack_worker` spawn in this session with `pi --list-models`. That is the dependable source. It prints each model\'s provider, model id, context window, maximum output, whether it supports thinking (`yes` or `no`), and whether it takes images. It lists no thinking levels per model. A model spec is `<provider>/<id>`, with an optional `:<level>` on Pi\'s ladder (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Pi clamps a level the model does not support down to the highest level it supports.',
  ),
  rule('setup-pstack.current-state', 'cursor-model-rule', SK('setup-pstack/SKILL.md'), 'treat its `# budget` line and its role values as the current choices', 'treat its `budget` and its `roles` values as the current choices'),
  rule(
    'setup-pstack.apply-budget',
    'cursor-model-slug',
    SK('setup-pstack/SKILL.md'),
    "`unlimited`, `large`, `medium`, and `small` set the effort token of every real slug, panel entries included, to `max`, `xhigh`, `high`, or `medium`. The effort token is the last token, or the one before a trailing `fast`, on the ladder `max` > `xhigh` > `high` > `medium` > `low`. If the result is not a detected slug, use the same family's detected slug with the highest effort at or below the target, else mark the role as needing a choice. `inherit-parent` and `auto` do not change. So `unlimited` turns `claude-opus-5-5-xhigh` into `claude-opus-5-5-max`. Grok slugs top out at `xhigh`, so under `unlimited` the fallback puts Grok at `xhigh` and keeps `grok-4.7-xhigh-fast` as it is. `large` keeps both defaults. `small` turns them into `claude-opus-5-5-medium` and `grok-4.7-medium-fast`.",
    '`unlimited`, `large`, `medium`, and `small` set the thinking level of every real model spec, panel entries included, to `max`, `xhigh`, `high`, or `medium`. The level is the `:<level>` suffix, on Pi\'s ladder (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Write the target level even when the model may not support it, because `pi --list-models` lists no levels per model and Pi clamps an unsupported level down to the highest one the model supports. A model whose `thinking` column reads `no` takes `:off` under every budget. `inherit-parent` and `auto` do not change. So `unlimited` turns `<provider>/claude-opus-5-5:xhigh` into `<provider>/claude-opus-5-5:max`, and a model whose highest level is `xhigh` runs at `xhigh`. `large` keeps both defaults. `small` sets both to `:medium`.',
  ),
  rule(
    'setup-pstack.write',
    'cursor-model-rule',
    SK('setup-pstack/SKILL.md'),
    '` with `alwaysApply: true`, a `# budget` line with the chosen label and its target effort, and one line per role, using the same labels poteto-mode uses. Overwrite the whole file so re-runs stay idempotent.',
    '` with `schemaVersion: 1`, `budget` set to the chosen label, `budgetLine` naming the label and its target effort, and one `roles` key per role, using the same labels poteto-mode uses. Panel roles take a list. Overwrite the whole file atomically, through a temporary file and a rename, so re-runs stay idempotent.',
  ),
  rule('setup-pstack.shape', ['cursor-model-rule', 'task-tool'], SK('setup-pstack/SKILL.md'), MDC_BLOCK, MODELS_JSON),
  rule(
    'setup-pstack.confirm-detected',
    'cursor-model-slug',
    SK('setup-pstack/SKILL.md'),
    'marking any real slug not in the detected set as needing a choice.',
    'marking as needing a choice any real spec whose `<provider>/<id>` is not in the detected set or whose `:<level>` is not on Pi\'s ladder.',
  ),
  rule(
    'setup-pstack.validate',
    'cursor-model-slug',
    SK('setup-pstack/SKILL.md'),
    'Every real slug written must be in the detected set. `inherit-parent` and `auto` always pass. If a chosen real slug is not available, stop and ask again.',
    'Every real spec written must have its `<provider>/<id>` in the detected set, and its `:<level>`, when present, on Pi\'s ladder (`off`, `minimal`, `low`, `medium`, `high`, `xhigh`, `max`). Do not reject a level because the model may not support it, since Pi clamps it. `inherit-parent` and `auto` always pass. If a chosen real spec fails either check, stop and ask again.',
  ),
  rule(
    'setup-pstack.confirm',
    'cursor-model-rule',
    SK('setup-pstack/SKILL.md'),
    'Tell the user the rule was written and that it applies to new sessions.',
    'Tell the user the file was written and that it applies to every later `pstack_worker` spawn.',
  ),
  rule(
    'show-me-your-work.transcript',
    'cursor-transcripts',
    SK('show-me-your-work/SKILL.md'),
    "Read this run's transcript under the active workspace's `agent-transcripts/` directory (the system prompt names the path).",
    `Read this run's Pi session file (\`$PI_SESSION_FILE\`) and its workers' sessions under ${WORKER_SESSIONS}.`,
  ),
  rule('swarm.parent-model', 'task-tool', SK('swarm/SKILL.md'), 'omit `model` so the workers run on the parent model.', 'set `model: "inherit-parent"` so the workers run on the parent model.'),
  rule(
    'swarm.fan-out',
    ['subagent-type', 'cloud-environment', 'run-in-background'],
    SK('swarm/SKILL.md'),
    'Spawn all N workers in one message with `subagent_type: generalPurpose`, `environment: "cloud"`, `run_in_background: true`, and the step 3 model, left unset for `auto` or `inherit-parent`. Use `environment: "local"` only when the worker needs access to something on the user\'s computer.',
    'Spawn all N workers one after another without waiting, each with `role: "general"`, `workspace: { mode: "container", inputCommit }`, and the step 3 model, `inherit-parent` for `auto` or `inherit-parent`. When a worker needs access to something on the user\'s computer, or spawn returns `ContainerUnavailable`, spawn it with `workspace: { mode: "worktree", inputCommit }` instead.',
  ),
  rule('swarm.base-branch', 'cloud-environment', SK('swarm/SKILL.md'), 'pass `cloud_base_branch`.', "set its `workspace.inputCommit` to that branch's head commit."),
  rule(
    'why.spawn-mode',
    ['subagent-type', 'readonly'],
    SK('why/SKILL.md'),
    "Every spawn is `generalPurpose` with `readonly: false` (agent mode). **Do not use readonly/Ask mode.** It strips MCP access, which disables the MCP-backed investigators and the synthesizer's citation spot-checks.",
    `Every spawn is a \`pstack_worker\` worker with ${READONLY_AT_ROOT} and \`capabilities.mcp: "inherit"\`, \`role: "investigator"\` for investigators and \`role: "general"\` for the synthesizer. A readonly worker runs \`git\` and \`gh\` through \`bash_readonly\` and cannot write files. **Do not set \`capabilities.mcp: "none"\`.** It strips MCP access, which disables the MCP-backed investigators and the synthesizer's citation spot-checks.`,
  ),
  rule(
    'why.mcp-discovery',
    ['cursor-host', 'cursor-mcp-discovery'],
    SK('why/SKILL.md'),
    'list the available MCPs from the Cursor environment. Use the available-tools map when present. Otherwise inspect the `mcps/` directory Cursor exposes for enabled MCP servers.',
    'list the available MCP servers in this Pi session. Use the `mcp_servers` section of the system prompt and the `mcp__<server>__<tool>` tools when present. Otherwise run `pi mcp list` for enabled MCP servers.',
  ),
  rule('typescript-best-practices.paths', 'skill-frontmatter', SK('typescript-best-practices/SKILL.md'), 'paths: ["**/*.ts", "**/*.tsx"]\n', ''),
  rule(
    'typescript-best-practices.paths-metadata',
    'skill-frontmatter',
    SK('typescript-best-practices/SKILL.md'),
    'disable-model-invocation: true\n---\n',
    'disable-model-invocation: true\nmetadata:\n  paths: ["**/*.ts", "**/*.tsx"]\n---\n',
  ),
];

export const KEEPS: readonly Keep[] = [
  { file: PB('worktree-cleanup'), text: 'Cursor', count: 1, primitive: 'cursor-host', reason: "names the Cursor app's cache folder as an optional disk reclaimer; the step works unchanged when the folder is absent" },
];

export const GENERAL_ROLE = `# General worker

You are a delegate in a pstack run. Do exactly the work your brief asks for, inside the paths it allows, and nothing more. When the brief names a skill, read its \`SKILL.md\` in full before you start. Report what you did, what you verified and how, and what you could not do, with file paths and commands rather than summaries.

${WORKER_CONTRACT}`;

export const WORKER_ASSIGNMENT_PATH = 'generated/skills/poteto-mode/references/worker-assignment.md';

const assignmentExample = (fields: Record<string, unknown>) => `\`\`\`json\n${JSON.stringify({ schemaVersion: 1, runId: 'fix-login-redirect', ...fields }, null, 2)}\n\`\`\``;
const EXAMPLE_ROOT = '/Users/you/src/app';
const EXAMPLE_COMMIT = '4f2c1a9e0b7d3c5a8e6f1b2d4c9a7e3f5b1d8c6a';

export const WORKER_ASSIGNMENT_REFERENCE = `# Worker assignment examples

Each block below is a complete \`assignment.json\` for one workspace mode or kind. Write the file to \`.pi/pstack/runs/<runId>/workers/<workerId>/assignment.json\`, where \`runId\` and \`workerId\` name those two directories, then call \`pstack_worker\` with \`{ action: "spawn", runId, assignmentPath }\`. Start from the closest example and change only the values.

Every assignment has every field these examples show. \`skills\` is \`[]\` when the brief names no skill. \`thinkingLevel\` is \`null\` when the model runs at its default level, or one of \`off\`, \`minimal\`, \`low\`, \`medium\`, \`high\`, \`xhigh\`, \`max\`. \`model\` is \`inherit-parent\` or \`<provider>/<id>\`. A \`readonly\` path and a \`watch.cwd\` are absolute, and so is every script path in \`watch.argv\`. \`capabilities\` is optional. Leave it out to keep the role's default, as these examples do.

## Writable worker (\`worktree\`)

The extension creates the worker's git worktree at \`inputCommit\`, a full or abbreviated commit SHA. \`brief\` is relative to the worker directory.

${assignmentExample({ workerId: 'fix', kind: 'pi', role: 'poteto', brief: 'brief.md', model: 'openai/gpt-6.1-sol', thinkingLevel: 'low', workspace: { mode: 'worktree', inputCommit: EXAMPLE_COMMIT }, skills: ['poteto-mode', 'principle-fix-root-causes'] })}

## Readonly worker (\`readonly\`)

The worker reads \`path\` with \`read\`, \`grep\`, \`find\`, \`ls\`, \`bash_readonly\`, and MCP tools, and writes nothing. Its final reply is its report.

${assignmentExample({ workerId: 'explorer-1', kind: 'pi', role: 'explorer', brief: 'brief.md', model: 'inherit-parent', thinkingLevel: null, workspace: { mode: 'readonly', path: EXAMPLE_ROOT }, skills: [] })}

## Container worker (\`container\`)

The worker runs a writable clone at \`inputCommit\` inside the container that \`.pi/environment.json\` configures. The container clones the pushed remote, so push \`inputCommit\` first. Spawn refuses a commit the remote lacks. Spawn refuses it with \`ContainerUnavailable\` when no container engine answers. Then a step that names a local fallback spawns this assignment again with the \`worktree\` workspace above, and a step without one reports itself blocked.

${assignmentExample({ workerId: 'owner-login', kind: 'pi', role: 'owner', brief: 'brief.md', model: 'inherit-parent', thinkingLevel: null, workspace: { mode: 'container', inputCommit: EXAMPLE_COMMIT }, skills: ['poteto-mode'] })}

## Watch on an interval (\`watch\`)

A watch runs \`watch.argv\` in tmux in \`watch.cwd\` and wakes the parent once when it exits. It needs no brief. Spawn a fresh one after each wake until the stop predicate holds.

${assignmentExample({ workerId: 'audit-tick-1', kind: 'watch', role: 'watcher', model: 'inherit-parent', thinkingLevel: null, workspace: { mode: 'readonly', path: EXAMPLE_ROOT }, skills: [], watch: { argv: ['sleep', '3600'], cwd: EXAMPLE_ROOT } })}

## Watch on an event (\`watch\`)

An event watch runs the watcher's command by absolute path. Here \`<pi-pstack>\`, the pi-pstack package root that \`pi list\` names, is \`/Users/you/.pi/agent/npm/node_modules/@justjoshn/pi-pstack\`.

${assignmentExample({ workerId: 'pr-1234-watch', kind: 'watch', role: 'watcher', model: 'inherit-parent', thinkingLevel: null, workspace: { mode: 'readonly', path: EXAMPLE_ROOT }, skills: [], watch: { argv: ['/Users/you/.pi/agent/npm/node_modules/@justjoshn/pi-pstack/generated/skills/poteto-mode/scripts/watch-pr/watch-pr', '--pr', '1234'], cwd: EXAMPLE_ROOT } })}
`;

export const AGENT_OUTPUTS: Readonly<Record<string, string>> = {
  'vendor/upstream-pstack/agents/poteto-agent.md': 'poteto.md',
  'vendor/upstream-pstack/agents/comment-sicko.md': 'comment-sicko.md',
};

export const BUILTIN_COMMANDS: ReadonlySet<string> = new Set([
  'bug',
  'changelog',
  'clone',
  'compact',
  'copy',
  'export',
  'fork',
  'hotkeys',
  'import',
  'llama',
  'login',
  'logout',
  'mcp',
  'model',
  'name',
  'new',
  'quit',
  'reload',
  'resume',
  'scoped-models',
  'session',
  'settings',
  'share',
  'skill',
  'thinking',
  'tree',
  'trust',
  'pstack',
]);

export function promptTemplate(name: string, description: string): string {
  return `---
description: ${JSON.stringify(description.replace(/\s+/g, ' ').trim())}
argument-hint: "[request]"
---
Use the pstack \`${name}\` skill for this request. Read its \`SKILL.md\` in full before anything else: \`generated/skills/${name}/SKILL.md\` under the pi-pstack package root (\`pi list\` names the package). Then follow it.

Request: $@
`;
}
