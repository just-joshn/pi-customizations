import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectSqliteDatabaseFromPath } from '../analysis/sqlite-database.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

export interface InspectSqliteDatabaseParams {
  readonly path: string;
  readonly worker_timeout_ms?: number;
  readonly table?: string;
  readonly columns?: readonly string[];
  readonly schema_scope?: string;
  readonly row_limit?: number;
}

export const inspectSqliteDatabase = async (
  session: ReaSession,
  params: InspectSqliteDatabaseParams,
  context: ToolCallContext = {},
): Promise<AgentToolResult<unknown>> => {
  const schemaScope =
    params.schema_scope === 'inventory' || params.schema_scope === 'selected_table' || params.schema_scope === 'database'
      ? params.schema_scope
      : undefined;
  const { record: inspection, path, resolvedPath } = await inspectSqliteDatabaseFromPath(params.path, {
    ...(params.worker_timeout_ms === undefined ? {} : { workerTimeoutMs: params.worker_timeout_ms }),
    ...(params.table === undefined ? {} : { table: params.table }),
    ...(params.columns === undefined ? {} : { columns: params.columns }),
    ...(schemaScope === undefined ? {} : { schemaScope }),
    ...(params.row_limit === undefined ? {} : { rowLimit: params.row_limit }),
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
  });

  const record = createEvidence({
    subject: {
      name: resolvedPath.split('/').pop() ?? resolvedPath,
      digest: { sha256: inspection.artifact.sha256 },
      format: 'file',
      architecture: null,
      local_path: resolvedPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_sqlite_database',
    parameters: {
      path,
      ...(params.worker_timeout_ms === undefined ? {} : { worker_timeout_ms: params.worker_timeout_ms }),
      ...(params.table === undefined ? {} : { table: params.table }),
      ...(params.columns === undefined ? {} : { columns: params.columns }),
      ...(params.schema_scope === undefined ? {} : { schema_scope: params.schema_scope }),
      ...(params.row_limit === undefined ? {} : { row_limit: params.row_limit }),
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [{ kind: 'artifact-path', path }],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
