#!/usr/bin/env node
// Compares two Cursor CLI installs without running them: the bundled source modules, the agent ToolCall kinds, and the
// protobuf field lists of the messages pstack's host features use. Usage: cli-diff.mjs <old-version-dir> <new-version-dir>
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const [oldDir, newDir] = process.argv.slice(2);

function bundle(dir) {
  return readdirSync(dir)
    .filter((name) => name.endsWith('.js'))
    .map((name) => readFileSync(join(dir, name), 'utf8'))
    .join('\n');
}

function modules(text) {
  return new Set([...text.matchAll(/"(\.\/src\/[^"]+\.tsx?)"/g)].map((match) => match[1]));
}

/** `static $(){return["Name|1 field 9|..."` protobuf descriptors, keyed by message name. */
function messages(text) {
  const map = new Map();
  for (const match of text.matchAll(/return\["([A-Z][A-Za-z0-9_.]*)((?:\|[^"|]+)+)"/g)) map.set(match[1], match[2].slice(1).split('|').sort().join('|'));
  return map;
}

const [before, after] = [bundle(oldDir), bundle(newDir)];
const [modsBefore, modsAfter] = [modules(before), modules(after)];
const added = [...modsAfter].filter((name) => !modsBefore.has(name)).sort();
const removed = [...modsBefore].filter((name) => !modsAfter.has(name)).sort();
console.log(`modules: ${modsBefore.size} -> ${modsAfter.size}; added ${added.length}, removed ${removed.length}`);
console.log(`added:\n  ${added.join('\n  ')}`);
console.log(`removed:\n  ${removed.join('\n  ')}`);

const [msgBefore, msgAfter] = [messages(before), messages(after)];
const watch = /Task|Subagent|Shell|Await|Todo|Question|SwitchMode|Plan|Subscri|SendToUser|Goal|Skill|Mode|Loop|Agent(Args|Result)|ToolCall$|Canvas|Image|Video|Automation|Routine|Project/;
const changed = [...msgAfter.keys()].filter((name) => watch.test(name) && msgBefore.has(name) && msgBefore.get(name) !== msgAfter.get(name)).sort();
const newMessages = [...msgAfter.keys()].filter((name) => watch.test(name) && !msgBefore.has(name)).sort();
console.log(`\nchanged messages (${changed.length}):`);
for (const name of changed) {
  const old = new Set(msgBefore.get(name).split('|'));
  const now = new Set(msgAfter.get(name).split('|'));
  console.log(`  ${name}: +[${[...now].filter((f) => !old.has(f)).join(', ')}] -[${[...old].filter((f) => !now.has(f)).join(', ')}]`);
}
console.log(`\nnew messages (${newMessages.length}):\n  ${newMessages.map((name) => `${name}: ${msgAfter.get(name).slice(0, 200)}`).join('\n  ')}`);
