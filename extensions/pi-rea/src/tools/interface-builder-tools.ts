import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import {
  decodeInterfaceBuilderInBundle,
  INTERFACE_BUILDER_ENVELOPE_LIMITATIONS,
  INTERFACE_BUILDER_RESULT_LIMITATIONS,
} from '../analysis/interface-builder.ts';
import { targetUnavailable } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';

export interface DecodeInterfaceBuilderParams {
  readonly max_documents?: number;
  readonly max_objects?: number;
  readonly max_connections?: number;
  readonly detail?: 'complete' | 'summary';
}

export const decodeInterfaceBuilder = async (
  session: ReaSession,
  params: DecodeInterfaceBuilderParams = {},
): Promise<AgentToolResult<unknown>> => {
  const bundle = session.bundleResources;
  const appPath = bundle?.canonicalPath ?? (session.target?.identity.format === 'app' ? session.target.identity.path : undefined);
  if (appPath === undefined || bundle === undefined) {
    throw targetUnavailable('No app is open. Ask the user which app to investigate, then call open_binary with its local path.');
  }

  const maxDocuments = params.max_documents ?? 64;
  const maxObjects = params.max_objects ?? 20_000;
  const maxConnections = params.max_connections ?? 40_000;

  const inspection = await decodeInterfaceBuilderInBundle(appPath, {
    maxDocuments,
    maxObjects,
    maxConnections,
    resourceRoot: {
      caller_path: bundle.callerPath,
      canonical_path: bundle.canonicalPath,
      info_plist_path: bundle.infoPlistPath,
      layout: bundle.layout,
      executable_sha256: null,
    },
  });

  const normalized = {
    target_sha256: inspection.target_sha256,
    resource_root: inspection.resource_root,
    documents: inspection.documents,
    graph: inspection.graph,
    limitations: [...INTERFACE_BUILDER_RESULT_LIMITATIONS],
  };

  const record = createEvidence({
    subject: null,
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'decode_interface_builder',
    parameters: {
      max_documents: maxDocuments,
      max_objects: maxObjects,
      max_connections: maxConnections,
      input_path: bundle.callerPath,
    },
    raw_result: null,
    normalized_result: normalized,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...INTERFACE_BUILDER_ENVELOPE_LIMITATIONS],
    locations: [],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};
