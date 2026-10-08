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

export function collectSimplifyEvidence({ records, root, cwd, parentSessionId, out, parentSessionFile, parentToolObservations = [] } = {}) {
  if (!Array.isArray(records) || !Array.isArray(parentToolObservations)) return { reviewers: [], orderingComplete: false, firstEditAt: null };
  let parentEntries = [];
  try {
    if (parentSessionFile && owned(parentSessionFile, root)) {
      const entries = readFileSync(parentSessionFile, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      if (entries[0]?.type === 'session' && entries[0].id === parentSessionId && realpathSync(entries[0].cwd) === realpathSync(cwd)) parentEntries = entries;
    }
  } catch {
    parentEntries = [];
  }
  const calls = records.filter((record) => record?.type === 'tool_execution_start' && typeof record.toolCallId === 'string' && record.toolCallId.length > 0 && ['Task', 'task'].includes(record.toolName));
  const reviewers = calls.flatMap((call) => {
    const lower = call.toolName === 'task';
    const launch = records.find((record) => record?.type === 'tool_execution_end' && record.toolCallId === call.toolCallId && record.toolName === call.toolName && record.isError === false);
    const node = lower
      ? parentEntries.findLast((entry) => entry?.type === 'custom' && entry.customType === 'reference-assistant-agent' && entry.data?.toolCallId === call.toolCallId && entry.data.id === launch?.result?.details?.agent_id)?.data
      : null;
    if (lower && !node) return [];
    const candidates = records.filter(
      (record) =>
        record?.type === 'tool_execution_end' &&
        record.isError === false &&
        (lower
          ? record.toolName === 'read_agent' && record.result?.details?.agent_id === node?.id && ['idle', 'completed'].includes(record.result.details.status)
          : ['Task', 'TaskOutput'].includes(record.toolName) && record.result?.details?.toolUseId === call.toolCallId && record.result.details.status === 'settled'),
    );
    const result = candidates.at(-1);
    if (!result || (lower && (node?.depth !== 1 || !['idle', 'completed'].includes(node.status) || node.mode !== 'background' || call.args?.mode !== 'background' || node.agentType !== call.args?.agent_type))) return [];
    const detail = lower ? { ...node, durationMs: node.endedAt - node.startedAt } : result.result.details;
    try {
      const transcript = detail.sessionFile;
      const metaPath = join(dirname(transcript), `agent-${detail.id}.meta.json`);
      if (!owned(transcript, root) || (!lower && !owned(metaPath, root)) || basename(transcript) !== `agent-${detail.id}.jsonl` || realpathSync(detail.cwd) !== realpathSync(cwd)) return [];
      const meta = lower ? null : JSON.parse(readFileSync(metaPath, 'utf8'));
      const entries = readFileSync(transcript, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line));
      const environment = entries.find((entry) => entry.type === 'custom' && entry.customType === 'pstack-agent-environment')?.data;
      if (environment?.agentId !== detail.id || environment?.sessionId !== parentSessionId || realpathSync(entries[0].cwd) !== realpathSync(cwd)) return [];
      if (lower) {
        const context = entries.find((entry) => entry.type === 'custom' && entry.customType === 'reference-assistant-child-context')?.data;
        if (
          context?.agentId !== detail.id ||
          context.registryId !== node.registryId ||
          context.rootSessionId !== parentSessionId ||
          context.depth !== 1 ||
          realpathSync(entries[0].parentSession) !== realpathSync(parentSessionFile) ||
          realpathSync(dirname(transcript)) !== realpathSync(join(dirname(parentSessionFile), parentSessionId, 'subagents'))
        )
          return [];
      } else if (meta.toolUseId !== call.toolCallId) return [];
      const assigned = angles.filter((angle) => new RegExp(`\\b${angle}\\b`, 'i').test(call.args?.prompt ?? ''));
      const messages = entries.filter((entry) => entry.type === 'message').map((entry) => entry.message);
      const assistants = messages.filter((message) => message.role === 'assistant');
      const last = assistants.at(-1);
      const tools = assistants.flatMap((message) => message.content ?? []).filter((part) => part.type === 'toolCall');
      const readonly = (lower || (detail.readonly === true && call.args?.readonly === true)) && tools.every((tool) => ['read', 'grep', 'find', 'ls'].includes(tool.name));
      const findings = (last?.content ?? [])
        .filter((part) => part.type === 'text')
        .map((part) => part.text)
        .join('\n');
      const endedAt = detail.startedAt + detail.durationMs;
      const resultIndex = records.indexOf(result);
      const firstEditIndex = records.findIndex((record) => {
        if (record?.type !== 'tool_execution_start' || !['write', 'edit', 'bash'].includes(record.toolName)) return false;
        if (record.toolName !== 'bash') return true;
        const observations = parentToolObservations.filter((item) => item?.toolCallId === record.toolCallId);
        const end = records.find((item) => item?.type === 'tool_execution_end' && item.toolCallId === record.toolCallId && item.toolName === 'bash' && item.isError === false);
        return observations.length !== 1 || observations[0].complete !== true || observations[0].sourceEdit !== false || !end;
      });
      const ordering = firstEditIndex < 0 || resultIndex < firstEditIndex;
      const destination = join(out, 'reviewers', detail.id);
      mkdirSync(destination, { recursive: true });
      cpSync(transcript, join(destination, 'transcript.jsonl'));
      if (lower) cpSync(parentSessionFile, join(destination, 'parent-transcript.jsonl'));
      else cpSync(metaPath, join(destination, 'meta.json'));
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
