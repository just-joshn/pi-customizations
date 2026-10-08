import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const base = resolve(process.argv[2] ?? 'artifacts/user-perspective');
const captures = [
  ...['setup', 'greeting-cli', 'greeting-library', 'greeting-cleanup', 'greeting-command', 'greeting-port'].map((name) => join(base, 'resource-workflows-local-final', name, 'rpc.jsonl')),
  ...['cli', 'electron', 'library', 'playwright', 'server', 'tui'].map((name) => join(base, 'resource-workflows-recipes-final', name, 'rpc.jsonl')),
  join(base, 'resource-workflows-contract-final', 'rpc.jsonl'),
];
const ownedCwds = new Set();
const report = captures.map((path) => {
  if (!existsSync(path)) return { path, missing: true };
  const records = readFileSync(path, 'utf8').trim().split('\n').filter(Boolean).map((line) => JSON.parse(line));
  for (const record of records) {
    if (record.type !== 'message_end' || record.message?.role !== 'system') continue;
    const cwd = record.message.sections?.cwd?.match(/<cwd>\s*(.*?)\s*<\/cwd>/s)?.[1];
    if (cwd) ownedCwds.add(cwd);
  }
  const assistantMessages = records.filter((record) => record.type === 'message_end' && record.message?.role === 'assistant');
  const calls = assistantMessages.flatMap((record) => (record.message.content ?? []).filter((part) => part.type === 'toolCall').map((part) => ({ ...part, timestamp: record.message.timestamp })));
  const taskNames = new Set(['task', 'Task']);
  const started = records.filter((record) => record.type === 'tool_execution_start' && taskNames.has(record.toolName));
  const finished = records.filter((record) => record.type === 'tool_execution_end' && taskNames.has(record.toolName));
  const errors = records.filter((record) => record.type === 'tool_execution_end' && record.isError).map((record) => ({ name: record.toolName, content: record.result?.content }));
  return { path, modelsObserved: [...new Set(assistantMessages.map((record) => `${record.message.provider}/${record.message.model}`))], toolCalls: calls,
    reviewerCallsRequested: calls.filter((call) => taskNames.has(call.name)).length, reviewerExecutionsStarted: started.length, reviewerExecutionsFinished: finished.length, toolErrors: errors };
});
const processes = spawnSync('/usr/sbin/lsof', ['-n', '-d', 'cwd', '-Fpcn'], { encoding: 'utf8' });
let pid;
let command;
const live = [];
for (const line of (processes.stdout ?? '').split('\n')) {
  if (line.startsWith('p')) pid = line.slice(1);
  else if (line.startsWith('c')) command = line.slice(1);
  else if (line.startsWith('n')) {
    const cwd = line.slice(1).replace(/ \(deleted\)$/, '');
    if (ownedCwds.has(cwd)) live.push({ pid, command, cwd });
  }
}
writeFileSync(join(base, 'resource-workflows-process-audit.json'), `${JSON.stringify({ ownedFixtureCwds: [...ownedCwds], liveProcessesWithOwnedFixtureCwd: live, lsofExitCode: processes.status }, null, 2)}\n`);
const path = join(base, 'resource-workflows-audit.json');
writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report.map(({ path, modelsObserved, reviewerCallsRequested, reviewerExecutionsStarted, reviewerExecutionsFinished, toolErrors }) => ({ path, modelsObserved, reviewerCallsRequested, reviewerExecutionsStarted, reviewerExecutionsFinished, toolErrorCount: toolErrors?.length })), null, 2));
