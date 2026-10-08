import { cpSync, mkdirSync, readFileSync, realpathSync } from 'node:fs';
import { basename, dirname, isAbsolute, join, relative } from 'node:path';

const angles = ['reuse', 'simplification', 'efficiency', 'altitude'];
function owned(path, root) {
  const rel = relative(realpathSync(root), realpathSync(path));
  return rel !== '..' && !rel.startsWith('../') && !isAbsolute(rel);
}

function reviewFinding(text) {
  if (/\b(?:no cleanup findings|code (?:is|was) already clean)\b/i.test(text)) return true;
  try {
    const findings = JSON.parse(text);
    return (
      Array.isArray(findings) &&
      findings.length > 0 &&
      findings.every((item) => typeof item.file === 'string' && item.file.length > 0 && Number.isInteger(item.line) && item.line > 0 && ['summary', 'cost'].every((key) => typeof item[key] === 'string' && item[key].trim().length > 0))
    );
  } catch {
    return false;
  }
}

export function collectSimplifyEvidence({ records, root, cwd, parentSessionId, out }) {
  const calls = records.filter((record) => record.type === 'tool_execution_start' && record.toolName === 'Task');
  const reviewers = calls.flatMap((call) => {
    const candidates = records.filter((record) => record.type === 'tool_execution_end' && record.isError === false && ['Task', 'TaskOutput'].includes(record.toolName) && record.result?.details?.toolUseId === call.toolCallId);
    const result = candidates.findLast((record) => record.result.details.status === 'settled');
    if (!result) return [];
    const detail = result.result.details;
    try {
      const transcript = detail.sessionFile;
      const metaPath = join(dirname(transcript), `agent-${detail.id}.meta.json`);
      if (!owned(transcript, root) || !owned(metaPath, root) || basename(transcript) !== `agent-${detail.id}.jsonl` || realpathSync(detail.cwd) !== realpathSync(cwd)) return [];
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'));
      const entries = readFileSync(transcript, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const environment = entries.find((entry) => entry.type === 'custom' && entry.customType === 'pstack-agent-environment')?.data;
      if (meta.toolUseId !== call.toolCallId || environment?.agentId !== detail.id || environment?.sessionId !== parentSessionId || realpathSync(entries[0].cwd) !== realpathSync(cwd)) return [];
      const assigned = angles.filter((angle) => new RegExp(`\\b${angle}\\b`, 'i').test(call.args?.prompt ?? ''));
      const messages = entries.filter((entry) => entry.type === 'message').map((entry) => entry.message);
      const assistants = messages.filter((message) => message.role === 'assistant');
      const last = assistants.at(-1);
      const tools = assistants.flatMap((message) => message.content ?? []).filter((part) => part.type === 'toolCall');
      const readonly = detail.readonly === true && call.args?.readonly === true && tools.every((tool) => ['read', 'grep', 'find'].includes(tool.name));
      const findings = (last?.content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
      const endedAt = detail.startedAt + detail.durationMs;
      const resultIndex = records.indexOf(result);
      const firstEditIndex = records.findIndex((record) => record.type === 'tool_execution_start' && ['write', 'edit', 'bash'].includes(record.toolName));
      const ordering = firstEditIndex < 0 || resultIndex < firstEditIndex;
      const destination = join(out, 'reviewers', detail.id);
      mkdirSync(destination, { recursive: true });
      cpSync(transcript, join(destination, 'transcript.jsonl'));
      cpSync(metaPath, join(destination, 'meta.json'));
      return [
        {
          id: detail.id,
          angle: assigned.length === 1 ? assigned[0] : null,
          owned: true,
          readonly,
          successful: !detail.error && last?.stopReason === 'stop' && reviewFinding(findings),
          startedAt: detail.startedAt,
          endedAt,
          findingsAt: endedAt,
          findings,
          transcript: join(destination, 'transcript.jsonl'),
          ordering,
        },
      ];
    } catch {
      return [];
    }
  });
  return { reviewers, orderingComplete: reviewers.length === 4 && reviewers.every((reviewer) => reviewer.ordering), firstEditAt: null };
}
