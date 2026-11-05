#!/usr/bin/env node
// Usage: host-references.mjs <plugins-checkout> <out.json>
// Scans every reference text file in pstack and cursor-team-kit for the Cursor host mechanisms it names,
// and prints one row per (mechanism, file) with line numbers. The mechanism table is the authority for
// what counts as a host dependency; each pattern names the mechanism the reference text relies on.
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const [plugins, out] = process.argv.slice(2);
const MECHANISMS = {
  'HOST-TASK': /\bTask\b(?! list)|subagent_type|run_in_background|\bresume\b|file_attachments/,
  'HOST-TASK-READONLY': /readonly|read-only subagent|Ask mode/,
  'HOST-TASK-CLOUD': /environment: ?"?cloud|cloud agent|cloud VM|own VM|cloud_base_branch|cloud-agent/i,
  'HOST-TASK-FORK': /\bfork(_turns)?\b/,
  'HOST-TASK-MODEL': /model per role|\bmodel\b.*slug|slug|-xhigh|-fast\b|inherit-parent/,
  'HOST-AGENT-STATUS': /agent status|probe (every|each) agent|stop (it|the agent)|stop order|stuck agent/i,
  'HOST-ASKQUESTION': /AskQuestion|AskUserQuestion/,
  'HOST-TODO': /todo ?list|TodoWrite|todolist/i,
  'HOST-MODE': /custom mode|option\+enter|alt\+enter|Use as Mode|stays in context every turn/i,
  'HOST-PLAN': /plan mode|CreatePlan|SwitchMode/i,
  'HOST-LOOP': /\/loop\b/,
  'HOST-SHELL-BG': /background(ed)? (shell|it|job|terminal)|notify_on_output|block_until_ms|AwaitShell|run this backgrounded|watcher output/i,
  'HOST-SUBSCRIPTION': /subscription|subscribe_/i,
  'HOST-AUTOMATION': /Automations?\b|routine|update_state|SendToUser|api2\.cursor\.sh/,
  'HOST-IMAGE': /GenerateImage|image (tool|model|generation)|generate (an )?image/i,
  'HOST-CANVAS': /canvas/i,
  'HOST-VISUALIZE': /\/visualize|visualize tool/i,
  'HOST-TRANSCRIPTS': /agent-transcripts|transcripts?\b/i,
  'HOST-STORE': /agent('s)? store|root agent's store|Project store|Project tracker|Projects\b/,
  'HOST-RULES': /\.mdc\b|always-applied|alwaysApply|pstack-models/,
  'HOST-SKILL-INVOKE': /disable-model-invocation|slash (menu|command)|`\/[a-z-]+`/,
  'HOST-PLUGIN-PATHS': /~\/\.cursor|\.cursor\/|\.cursor-plugin/,
  'HOST-BUGBOT': /bugbot/i,
  'HOST-ORIGIN': /\borigin pr\b|command -v origin|\bOrigin\b/,
  'HOST-MCP': /\bMCPs?\b|mcp__|mcp_auth/,
  'HOST-BROWSER': /in-app browser|Cursor browser|computer use|browser-use/i,
  'HOST-CREATE-SKILL': /create-skill/,
  'HOST-SECURITY-REVIEW': /agentic security review/i,
  'HOST-DATE': /today's date|current date/i,
  'HOST-VIDEO': /\bvideo\b|\.mp4|ffmpeg/i,
};

function walk(root) {
  const files = [];
  const visit = (dir) => {
    for (const name of readdirSync(dir)) {
      if (name === 'node_modules' || name === '.git') continue;
      const path = join(dir, name);
      if (statSync(path).isDirectory()) visit(path);
      else if (/\.(md|mdc|yaml|json|sh|mjs|js|ts)$/.test(name) && !path.includes('/test/corpus/')) files.push(path);
    }
  };
  visit(root);
  return files.sort();
}

const rows = [];
for (const plugin of ['pstack', 'cursor-team-kit']) {
  for (const path of walk(join(plugins, plugin))) {
    const file = `${plugin}/${relative(join(plugins, plugin), path)}`;
    const lines = readFileSync(path, 'utf8').split('\n');
    for (const [id, pattern] of Object.entries(MECHANISMS)) {
      const hits = lines.flatMap((line, index) => (pattern.test(line) ? [index + 1] : []));
      if (hits.length > 0) rows.push({ mechanism: id, file, lines: hits });
    }
  }
}
const byMechanism = {};
for (const row of rows) (byMechanism[row.mechanism] ??= []).push(`${row.file}:${row.lines.join(',')}`);
writeFileSync(out, `${JSON.stringify({ mechanisms: Object.fromEntries(Object.entries(MECHANISMS).map(([k, v]) => [k, v.source])), byMechanism }, null, 2)}\n`);
for (const [id, list] of Object.entries(byMechanism)) console.log(`${id}\t${list.length} files`);
