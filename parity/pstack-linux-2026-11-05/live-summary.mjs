#!/usr/bin/env node
// Summarizes one `pi --mode json` run for the background-ownership scenarios: each Task call's result, then each
// pstack/shell and pstack/task notice the main chat received, with its position relative to the first Task result.
// Usage: live-summary.mjs <events.jsonl>
import { readFileSync } from 'node:fs';

const events = readFileSync(process.argv[2], 'utf8')
  .split('\n')
  .filter((line) => line.trim().startsWith('{'))
  .map((line) => JSON.parse(line));
const text = (content) => (typeof content === 'string' ? content : (content ?? []).map((part) => part.text ?? '').join(''));
const taskEnd = events.findIndex((event) => event.type === 'tool_execution_end' && event.toolName === 'Task');
console.log(`== ${process.argv[2]}`);
for (const event of events.filter((candidate) => candidate.type === 'tool_execution_end' && candidate.toolName === 'Task')) {
  console.log(`Task result${event.isError ? ' (error)' : ''}:\n${text(event.result?.content).slice(0, 600)}`);
}
events.forEach((event, index) => {
  const entry = event.type === 'entry_appended' ? event.entry : undefined;
  if (entry?.type !== 'custom_message' || !['pstack/shell', 'pstack/task'].includes(entry.customType)) return;
  const fields = Object.fromEntries([...String(entry.content).matchAll(/^(kind|status|task_id|title|detail): (.*)$/gm)].map((match) => [match[1], match[2]]));
  console.log(`${entry.customType} ${index > taskEnd ? 'after' : 'BEFORE'} the Task result: ${JSON.stringify(fields)}`);
});
const finals = events.filter((event) => event.type === 'message_end' && event.message?.role === 'assistant').map((event) => text(event.message.content));
console.log(`assistant turns: ${finals.length}; last: ${(finals.at(-1) ?? '').slice(0, 200).replace(/\n/g, ' ')}`);
