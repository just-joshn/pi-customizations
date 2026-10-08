export function ownedTranscriptSource(source) {
  const start = source.indexOf('function childTranscript(agentId) {');
  const end = source.indexOf('\nexport default async function', start);
  if (start < 0 || end < 0) throw new Error('Legacy transcript helper was not found');
  const helpers = `function childTranscript(session, agentId) {
  return session.records
    .filter((record) => record.type === 'entry_appended' && record.entry?.customType === 'reference-assistant-agent')
    .map((record) => record.entry.data)
    .findLast((data) => data?.id === agentId && typeof data?.sessionFile === 'string' && data.sessionFile !== '')?.sessionFile;
}

function childTranscriptText(session, agentId) {
  const path = childTranscript(session, agentId);
  return path && existsSync(path) ? readFileSync(path, 'utf8') : '';
}

async function childTranscriptContains(session, agentId, needle, timeoutMs = 4000) {
  return waitFor(
    () => {
      const path = childTranscript(session, agentId);
      if (!path || !existsSync(path)) return undefined;
      return readFileSync(path, 'utf8').includes(needle) ? true : undefined;
    },
    { timeoutMs, description: \`owned child transcript \${agentId} to contain \${JSON.stringify(needle)}\` },
  );
}
`;
  return (source.slice(0, start) + helpers + source.slice(end))
    .replace('mkdirSync, readdirSync, readFileSync', 'mkdirSync, readFileSync')
    .replace("import { tmpdir } from 'node:os';\n", '')
    .replace('childTranscriptContains(exploreWrite?', 'childTranscriptContains(primary.session, exploreWrite?')
    .replace('childTranscriptText(bashResult?', 'childTranscriptText(primary.session, bashResult?')
    .replace('childTranscriptText(blocked?', 'childTranscriptText(guarded.session, blocked?')
    .replace('childTranscriptText(envResult?', 'childTranscriptText(excluded.session, envResult?')
    .replace('childTranscriptContains(blockedResult?', 'childTranscriptContains(observe.session, blockedResult?')
    .replace('childTranscriptText(blockedResult?', 'childTranscriptText(observe.session, blockedResult?');
}
