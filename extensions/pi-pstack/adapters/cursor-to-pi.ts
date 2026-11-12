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
    detect: /Cmd\+Shift|computer preview|chat header|Customize in the sidebar|\/add-plugin|`\/plugin (?:marketplace add|install) [^`]+`|`\/pstack:[a-z-]+`/g,
  },
  { id: 'cursor-builtin-babysit', label: "Cursor's built-in babysit skill", pi: 'none (pstack Babysit playbook only)', disposition: 'map', detect: /Cursor's (?:built-in babysit|own) skill/g },
  { id: 'project-tracker', label: 'Cursor Project tracker, store, and event subscriptions', pi: 'run root files and `pstack-worker` wakes', disposition: 'map', detect: /Project tracker|Project store|event subscriptions|agent store/g },
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
