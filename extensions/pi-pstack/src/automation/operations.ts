// The operations status protocol of the repro workflow. A worker has no Slack tool, so it reports where it is by appending
// one JSON line per change to `status.jsonl` in its own worker directory. The parent reads the latest valid line and edits
// the operations root message to match. A line that is not one of the status strings is ignored, so a worker cannot make the
// parent write arbitrary text, and its note is cleaned before it is shown.
import { existsSync, readFileSync } from 'node:fs';

import { statusFile } from './dispatch.ts';
import { isOpsStatus, type OpsStatus, type RunId } from './model.ts';

export function latestStatus(projectRoot: string, runId: RunId): { status: OpsStatus; note?: string } | undefined {
  const file = statusFile(projectRoot, runId);
  if (!existsSync(file)) return undefined;
  let latest: { status: OpsStatus; note?: string } | undefined;
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    try {
      const parsed = JSON.parse(line) as { status?: unknown; note?: unknown };
      if (isOpsStatus(parsed.status)) latest = { status: parsed.status, ...(typeof parsed.note === 'string' && parsed.note.trim() !== '' ? { note: parsed.note } : {}) };
    } catch {}
  }
  return latest;
}
