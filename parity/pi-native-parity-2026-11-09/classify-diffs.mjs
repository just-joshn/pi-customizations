#!/usr/bin/env node
/**
 * Classify each changed text file from tree-map as HOST_TRANSLATION, CONTENT_DRIFT,
 * MIXED, or PACKAGING by scoring known host-substitution patterns vs other hunks.
 * Root LICENSE files are PACKAGING: one shipped notice holds every upstream copyright
 * plus the port author. Usage: node classify-diffs.mjs <tree-map-dir> <out.json>
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const [mapDir, outPath] = process.argv.slice(2);
if (!mapDir || !outPath) throw new Error('usage: classify-diffs.mjs <tree-map-dir> <out.json>');

const map = JSON.parse(readFileSync(join(mapDir, 'tree-map.json'), 'utf8'));
const HOST_PATTERNS = [
  /~\/\.cursor\/rules\/pstack-models\.mdc/,
  /pstack-models\.mdc/,
  /cursor-team-kit/,
  /Cursor's built-in/,
  /built-in babysit/,
  /agent mode \(readonly strips MCP\)/,
  /`readonly` unset \(readonly strips MCP\)/,
  /grok-4\.7-xhigh-fast/,
  /grok-4\.7\[effort=xhigh,fast=true\]/,
  /claude-opus-5-5-xhigh/,
  /claude-opus-5-5:xhigh/,
  /claude-opus-5-5-max/,
  /claude-opus-5-5:max/,
  /icon: crown/,
  /color: yellow/,
  /metadata:/,
  /paths:/,
  /disable-model-invocation/,
  /system prompt names/,
  /model rule at the path/,
  /pi-pstack/,
  /shipped with pi-pstack/,
  /control-ui/,
  /in-app browser/,
  /system browser/,
  /\.cursor\/plugins/,
  /package directory the system prompt names/,
  /Cursor CLI/,
  /Custom Mode/,
  /\/setup-pstack/,
  /AskQuestion/,
  /Task tool/,
  /fast=true/,
  /effort=/,
  /:<level>/,
  /-fast` variant/,
  /without `-fast`/,
  /the model rather than its `-fast` variant/,
  /Auto users stay on Auto/,
  /follows the chat model when the user switches/,
  /recent Pi chats/,
  /\.pi\/(?:skills|automations|benny)\//,
  /\.pi\/settings\.json/,
  /prefer_pi_pstack_slack_tools/,
  /`read`, `grep`, and `find`/,
  /system player/,
  /OS player/,
  /statechart\.js/,
  /--single-threaded/,
  /realpathSync\(fs\.mkdtempSync/,
  /draft entry that is gone/,
  /<pstack_subagents>/,
  /pi --list-models/,
  /subscribe_webhook/,
  /routine accepts the event/,
  /this whole package/,
  /Install the package/,
  /#cloud-agents/,
  /\/project new /,
  /wake the Pi session/,
  /cloud agent's ID/,
  /a Pi restart/,
  /stop_agent/,
  /<SKILLS>/,
  /pi_chat_dirs/,
  /pi mcp list/,
  /Treating `auto` as a model/,
];

function classifyDiff(diffText) {
  const hunks = [];
  let cur = [];
  for (const line of diffText.split('\n')) {
    if (line.startsWith('@@')) {
      if (cur.length) hunks.push(cur);
      cur = [line];
    } else if (cur.length) cur.push(line);
  }
  if (cur.length) hunks.push(cur);

  let host = 0;
  let other = 0;
  const otherSamples = [];
  for (const hunk of hunks) {
    const changed = hunk.filter((l) => /^[+-]/.test(l) && !/^[+-]{3}/.test(l));
    if (!changed.length) continue;
    const text = changed.join('\n');
    const isHost = HOST_PATTERNS.some((re) => re.test(text));
    if (isHost) host++;
    else {
      other++;
      if (otherSamples.length < 5) otherSamples.push(changed.slice(0, 12).join('\n'));
    }
  }
  let klass = 'IDENTICAL_EMPTY';
  if (host && !other) klass = 'HOST_TRANSLATION';
  else if (!host && other) klass = 'CONTENT_DRIFT';
  else if (host && other) klass = 'MIXED';
  else if (!hunks.length && diffText.trim()) klass = 'UNPARSED';
  return { klass, hostHunks: host, otherHunks: other, otherSamples };
}

const results = [];
for (const row of map.rows.filter((r) => r.status === 'changed')) {
  if (row.file === 'LICENSE') {
    results.push({
      plugin: row.plugin,
      file: row.file,
      diffLines: row.diffLines,
      klass: 'PACKAGING',
      hostHunks: 0,
      otherHunks: 0,
      otherSamples: [],
    });
    continue;
  }
  const diffPath = join(mapDir, 'diffs', row.plugin, `${row.file}.diff`);
  if (!existsSync(diffPath)) {
    results.push({ ...row, klass: 'NO_DIFF_FILE' });
    continue;
  }
  const diff = readFileSync(diffPath, 'utf8');
  results.push({ plugin: row.plugin, file: row.file, diffLines: row.diffLines, ...classifyDiff(diff) });
}

const summary = {};
for (const r of results) summary[r.klass] = (summary[r.klass] ?? 0) + 1;
const out = { summary, results };
writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`);
console.log(JSON.stringify(summary));
for (const r of results.filter((x) => x.klass === 'CONTENT_DRIFT' || x.klass === 'MIXED' || x.klass === 'NO_DIFF_FILE')) {
  console.log(`${r.klass}\t${r.diffLines}\t${r.plugin}/${r.file}\thost=${r.hostHunks} other=${r.otherHunks}`);
}
