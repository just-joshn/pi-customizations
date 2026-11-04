#!/usr/bin/env node
// Completeness audit: every host-dependent line in the reference text must map to an inventory ID.
// Usage: node completeness-audit.mjs <cursor/plugins checkout> [~/.cursor/skills-cursor]
// Prints per-ID hit counts, the inventory IDs that no reference line reached, and every line that names Cursor
// or a host concept but matched no rule (those need a new inventory row).
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [plugins, builtins = join(process.env.HOME ?? '', '.cursor/skills-cursor')] = process.argv.slice(2);
const RULES = [
  ['TASK-SCHEMA', /`Task`|\bTask (tool|subagent|call)|subagent_type|run_in_background/],
  ['TASK-RESUME', /`resume`|\bresume\b.*agent|message a worker|steer/i],
  ['TASK-FORK', /\bfork\b/i],
  ['TASK-RO', /readonly|read-only|Ask mode/i],
  ['TASK-ENV', /environment: "(cloud|local)"|cloud_base_branch|cloud VM|own machine|\bVM\b/],
  ['TASK-ATTACH', /file_attachments/],
  ['TASK-MODEL', /\bclaude-[a-z]+-\d|\bgrok-\d|\bgpt-\d|composer-|inherit-parent|\bmodel slug/],
  ['TASK-TYPES', /generalPurpose|\bexplore\b|poteto-agent|comment-sicko|ci-watcher|thermo-nuclear-code-quality-review|subagent_type: "shell"/],
  ['ASK', /AskQuestion|AskUserQuestion/],
  ['TODO', /\btodo ?list\b|TodoWrite/i],
  ['LOOP', /\/loop\b/],
  ['MODE', /custom mode|use as mode|option\+enter|alt\+enter|^\s*(icon|color):/i],
  ['PLAN', /plan mode|CreatePlan|SwitchMode/i],
  ['SHELL-BG', /background it|backgrounded|notify_on_output|watcher output|AwaitShell|block_until_ms/i],
  ['RULE-MODELS', /pstack-models|always-applied rule|alwaysApply/],
  ['STORE', /agent store|agent's store|Project tracker|Project store|Cursor Project/i],
  ['TRANSCRIPTS', /agent-transcripts|\.cursor\/projects|\btranscripts?\b/i],
  ['IMAGE', /GenerateImage|generated image/],
  ['VIZ', /\/visualize/],
  ['CANVAS', /in-app browser|\bcanvas\b/i],
  ['MEDIA', /embed(ded)? (screenshots|the video|video)|inline when the change is visible/i],
  ['MCP', /\bMCPs?\b|mcps\//],
  ['BUGBOT', /bugbot|security[- ]review/i],
  ['PR-TOOL', /built-in PR tool|origin pr\b|gh pr\b|command -v origin/],
  ['CREATE-SKILL', /create-skill|Agent Skills for Cursor/],
  ['AUTO-BENNY', /point cursor at|update_state|SendSlackMessage|PostToSlack|Cursor automations?|automation pack|\/automate\b|Automations editor|api2\.cursor\.sh/i],
  ['AUTO-BOTUI', /SendToUser|secret-request|webhook routine|Grok Bot|routine/i],
  ['CLOUD-CHAT', /\/in-cloud|cloud agents?|laptop (is )?closed/i],
  ['INSTALL', /Cursor-only features|\/add-plugin|Customize in the sidebar|marketplace|Claude Code|\.cursor-plugin|plugins\/cache/i],
  ['SKILL-CMD', /from the `\/` menu|slash[- ]skill|slash menu/i],
  ['SKILL-REF', /the \*\*[a-z0-9-]+\*\* (principle )?skill|principle-[a-z-]+/],
  ['SKILL-CAT', /disable-model-invocation|skill catalog/i],
  ['SKILL-PATHS', /^paths:/],
  ['TOOL-NAMES', /\b(Read|Grep|Glob|Shell)\b(,| tool| and)/],
  ['UI-CURSOR', /Cmd\+Shift\+I|chat header|\bsidebar\b|computer preview|pinned/i],
  ['PATHS', /\.cursor\/(skills|rules|settings|automations|benny|worktrees)|~\/\.cursor\/|Application Support\/Cursor/],
  ['SUBS', /cursor-subscriptions|subscribe_(timer|github|origin)|subscriptionId/],
  ['RULE-TEAMKIT', /no-inline-imports|exhaustive-switch|Always place imports/i],
  ['SCRIPTS', /scripts\/(watch-pr|worktree-audit|check-plan)|\bstatechart\b.*\bscripts\b|bootstrap\.ts/],
  ['TEAMKIT-DEP', /cursor-team-kit/],
  ['HOST-NAME', /Cursor (restart|chats?|Slack actions|Agent Skills)|restart Cursor|Cursor's (own|built-in)|Skills in Cursor|In a Cursor chat|Cursor confirms|\/plugin (install|marketplace)/],
];
// Rows established from captured host behavior rather than a reference text line.
const EVIDENCE_ROWS = new Set(['TASK-FG', 'TASK-BG', 'TASK-PRINT-WAIT', 'TASK-DEPTH', 'SHELL-RO', 'DATE']);
// Lines that name the host without a rule above are reported for review.
const HOST_HINT = /\bcursor\b|\.cursor|cursor-team-kit|cursor\.com|cursor\.sh/i;
const BENIGN =
  /cursor\/plugins|github\.com\/cursor|cursor location|the cursor\b(?! (cli|ide|agent))|\bcursor = |\bcursor\b && |i >= cursor|Meta, Netflix, and Cursor|code at Cursor|cursor into a real|cursor gives you|# Cursor Team Kit plugin/i;

const tracked = execFileSync('git', ['-C', plugins, 'ls-files', 'pstack', 'cursor-team-kit'], { encoding: 'utf8' })
  .split('\n')
  .filter((file) => /\.(md|mdc|ya?ml|sh|mjs)$/.test(file) && !file.includes('statechart/scripts/test/'));
const files = [...tracked.map((file) => [file, join(plugins, file)]), ...['loop', 'create-skill'].map((name) => [`skills-cursor/${name}/SKILL.md`, join(builtins, name, 'SKILL.md')])].filter(([, path]) => existsSync(path));

const hits = new Map(RULES.map(([id]) => [id, 0]));
const unmatched = [];
for (const [file, path] of files) {
  readFileSync(path, 'utf8')
    .split('\n')
    .forEach((line, index) => {
      const ids = RULES.filter(([, rule]) => rule.test(line)).map(([id]) => id);
      for (const id of ids) hits.set(id, (hits.get(id) ?? 0) + 1);
      if (ids.length === 0 && HOST_HINT.test(line) && !BENIGN.test(line)) unmatched.push(`${file}:${index + 1}: ${line.trim().slice(0, 200)}`);
    });
}
const inventory = readFileSync(new URL('./inventory.md', import.meta.url), 'utf8');
const inventoryIds = new Set([...inventory.matchAll(/^\| ([A-Z]+(?:-[A-Z]+)*) \|/gm)].map((match) => match[1]).filter((id) => id !== 'ID'));
const ruleIds = new Set(RULES.map(([id]) => id));
console.log(
  JSON.stringify(
    {
      filesScanned: files.length,
      hitsPerId: Object.fromEntries([...hits].sort()),
      ruleIdsMissingFromInventory: [...ruleIds].filter((id) => !inventoryIds.has(id) && !['TOOL-NAMES', 'UI-CURSOR', 'PATHS'].includes(id)),
      inventoryIdsNoReferenceLineReached: [...inventoryIds].filter((id) => !EVIDENCE_ROWS.has(id) && (!ruleIds.has(id) || hits.get(id) === 0)),
      evidenceRows: [...EVIDENCE_ROWS],
      unmatchedHostLines: unmatched,
    },
    null,
    2,
  ),
);
