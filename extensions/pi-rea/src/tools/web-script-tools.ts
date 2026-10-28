import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { exportWebScripts } from '../analysis/export-web-scripts.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';

export interface ExportWebScriptsParams {
  readonly capture_path: string;
  readonly output_directory: string;
}

export const exportWebScriptsTool = async (session: ReaSession, params: ExportWebScriptsParams): Promise<AgentToolResult<unknown>> => {
  const inspection = await exportWebScripts(params);
  const record = createEvidence({
    subject: null,
    provider: { id: 'pi-rea-web-workflows', name: 'pi-rea web workflows', version: '1' },
    analysis_profile: null,
    predicate_type: 'rea.web-script-export',
    operation: 'export_web_scripts',
    parameters: {
      capture_path: params.capture_path,
      output_directory: params.output_directory,
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'derived',
    authority: 'historical-reference',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [{ kind: 'artifact-path', path: params.output_directory }],
    evidence_links: inspection.source_evidence_id === null ? [] : [inspection.source_evidence_id],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};
