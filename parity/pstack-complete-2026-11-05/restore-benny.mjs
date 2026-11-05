#!/usr/bin/env node
// Rebuilds pi-pstack's benny pack from upstream pstack's, now that Pi has every mechanism benny uses: a Slack channel
// trigger (subscribe_slack), Slack tools, automations that run on cloud machines with memories, and /automate plus
// /automations. Only Cursor product names and paths change; every rule, step, and boundary stays upstream's.
// Usage: restore-benny.mjs <plugins-checkout> <pi-pstack-dir>
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [plugins, pi] = process.argv.slice(2);
if (!plugins || !pi) throw new Error('usage: restore-benny.mjs <plugins-checkout> <pi-pstack-dir>');
const source = join(plugins, 'pstack/automations/benny');
const target = join(pi, 'automations/benny');

const PLUGIN_JSON = '{\n\t"plugins": {\n\t\t"pstack": { "enabled": true }\n\t}\n}';
const PACKAGE_JSON = '{\n\t"packages": ["npm:@justjoshn/pi-pstack"]\n}';

// Ordered: longer phrases first, so a later, shorter rule never splits one.
const RULES = [
  [PLUGIN_JSON, PACKAGE_JSON],
  ['If `plugins.pstack` already exists, change only its `enabled` value.', 'If `packages` already lists pi-pstack (by npm name, git URL, or path), leave that entry as it is.'],
  ['Preserve every unrelated top-level setting and every other plugin entry.', 'Preserve every unrelated top-level setting and every other package entry.'],
  ['preserve every unrelated setting and plugin.', 'preserve every unrelated setting and package.'],
  ['Add pstack to the target repository\'s `.cursor/settings.json`.', 'Add pi-pstack to the target repository\'s `.pi/settings.json` (what `pi install -l npm:@justjoshn/pi-pstack` writes).'],
  ['enables pstack in the target repository\'s', 'enables pi-pstack in the target repository\'s'],
  ['let setup enable pstack in the target repository\'s', 'let setup enable pi-pstack in the target repository\'s'],
  ['i want pstack enabled through the target repository\'s committed', 'i want pi-pstack enabled through the target repository\'s committed'],
  ['i want this merge entry in the target repository\'s', 'i want this merge entry in the target repository\'s'],
  ['i want you to merge this entry into the target repository\'s `.cursor/settings.json`:', 'i want you to merge this entry into the target repository\'s `.pi/settings.json` (what `pi install -l npm:@justjoshn/pi-pstack` writes):'],
  ['The plugin manifest exposes only pstack\'s normal skill root; this file and the two operational files are not slash skills.', 'The pi-pstack package exposes only its normal skill root; this file and the two operational files are not slash skills.'],
  ['do not add `.cursor/automations/benny/skills/` to a plugin manifest or expect its files to appear in the slash-skill list.', 'do not add `.pi/automations/benny/skills/` to a skill path or expect its files to appear in the slash-skill list.'],
  ['Do not add that directory to a plugin', 'Do not add that directory to a skill path or a'],
  ['if project-scoped plugins are unavailable', 'if project-scoped packages are unavailable'],
  ['If project-scoped plugin installation is unavailable', 'If project-scoped package installation is unavailable'],
  ['a user-scoped plugin', 'a user-scoped install'],
  ['a user-scoped install.', 'a user-scoped install.'],
  ['not registered plugin skills', 'not registered skills'],
  ['plugin cache paths', 'package paths'],
  ['a plugin source or cache path', 'a pi-pstack package path'],
  ['the plugin source directory or a plugin cache path', 'the pi-pstack package directory'],
  ['a plugin cache path', 'a pi-pstack package path'],
  ['plugin files', 'package files'],
  ['Prefer configured Cursor Slack actions for reads and posts.', 'Prefer pi-pstack\'s Slack tools (`slack_read_thread`, `slack_send`, `slack_react`, `slack_update`) for reads and posts; they work once the Slack bot token is stored with `request_secret` (connector `slack`, field `token`).'],
  ['Prefer configured Cursor Slack actions.', 'Prefer pi-pstack\'s Slack tools (`slack_read_thread`, `slack_send`, `slack_react`, `slack_update`).'],
  ['prefer_cursor_actions: true', 'prefer_pi_pstack_slack_tools: true'],
  ['Use only model slugs shown as available in the user\'s Cursor model picker or supported model list.', 'Use only models listed as available in `<pstack_subagents>` or `pi --list-models`.'],
  ['Never call a direct automation backend service or backend automation tool. Never use a browser URL that carries draft fields. Never build or open a Cursor protocol deep link. For new automations, the only finish path is the built-in `automate` skill\'s reviewed Automations editor handoff.', 'Never write the subscription registry, a supervisor file, or a credential file by hand, and never create an automation with a raw `subscribe_*` call that skipped the review. For new automations, the only finish path is the `automate` skill\'s reviewed draft, approval, and `/automations` handoff.'],
  ['Let `automate` show its draft table, obtain approval, ask readiness, and open the Automations editor.', 'Let `automate` show its draft table, obtain approval, ask readiness, create the automation, and hand it to `/automations`.'],
  ['Finish the editor handoff for this automation before starting the next one.', 'Finish the `/automations` handoff for this automation before starting the next one.'],
  ['After the triage editor handoff is complete,', 'After the triage `/automations` handoff is complete,'],
  ['Ask the user to update each existing automation directly in its Automations editor.', 'Ask the user to update each existing automation with `/automations edit <name>`.'],
  ['the draft review, approval, readiness check, and Automations editor handoff', 'the draft review, approval, readiness check, and `/automations` handoff'],
  ['so i can edit each automation directly in its editor.', 'so i can edit each automation with `/automations edit <name>`.'],
  ['review each new automation draft or update existing automations in their editors.', 'review each new automation draft, or update existing automations with `/automations edit <name>`.'],
  ['before invoking the built-in `/automate` skill', 'before invoking the `automate` skill pi-pstack ships (`/automate`)'],
  ['Reference a repository file only after the built-in `/automate` skill confirms', 'Reference a repository file only after the `automate` skill confirms'],
  ['Read and follow the built-in `automate` skill.', 'Read and follow the `automate` skill pi-pstack ships (`/automate`). Create each automation with `sessionStrategy: "new_session"` and `environment: "cloud"`, so every run starts on its own cloud machine with a fresh clone of the configured repository and branch.'],
  ['The built-in `automate` skill is creation-only.', 'The `automate` skill is creation-only.'],
  ['use built-in `/automate` once for triage and once for repro and fix.', 'use `/automate`, the automate skill pi-pstack ships, once for triage and once for repro and fix, each with `sessionStrategy: "new_session"` and `environment: "cloud"`.'],
  ['use these repo-relative paths only after `/automate` confirms', 'use these repo-relative paths only after the automate skill confirms'],
  ['for existing automations, do not use `/automate` to inspect or update them.', 'for existing automations, do not use `/automate` to inspect or update them; use `/automations`.'],
  ['Let `automate` discover Slack channels, the repository, and connected integrations.', 'Let `automate` discover the Slack channel (with `slack_read_channel`), the repository, and connected integrations.'],
  ['Benny needs external configuration and two live Cursor automations.', 'Benny needs external configuration and two live pi-pstack automations.'],
  ['The human enters setup by pointing Cursor at the pack\'s `FOR_AGENTS.md`.', 'The human enters setup by pointing Pi at the pack\'s `FOR_AGENTS.md`.'],
  ['the human enters setup by pointing cursor at this file.', 'the human enters setup by pointing pi at this file.'],
  ['point cursor at', 'point pi at'],
  ['i want two cursor automations that work together in one slack issue channel.', 'i want two pi-pstack automations that work together in one slack issue channel. each runs with no chat open, on its own cloud machine.'],
  ['benny gives you two cursor automations for slack issue reports.', 'benny gives you two pi-pstack automations for slack issue reports.'],
  ['.cursor/automations/benny/', '.pi/automations/benny/'],
  ['.cursor/benny/', '.pi/benny/'],
  ['.cursor/settings.json', '.pi/settings.json'],
  ['`.cursor` directory', '`.pi` directory'],
];

function files(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

const leftovers = [];
for (const path of files(source)) {
  let text = readFileSync(path, 'utf8');
  for (const [from, to] of RULES) text = text.split(from).join(to);
  const rel = relative(source, path);
  for (const line of text.split('\n')) if (/cursor/i.test(line)) leftovers.push(`${rel}: ${line.trim().slice(0, 160)}`);
  writeFileSync(join(target, rel), text);
}
console.log(`rebuilt ${files(source).length} files`);
if (leftovers.length > 0) {
  console.log(`lines that still name Cursor (${leftovers.length}):\n  ${leftovers.join('\n  ')}`);
  process.exitCode = 1;
}
