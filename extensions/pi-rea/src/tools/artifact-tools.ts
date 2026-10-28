import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { extractZipArtifact } from '../analysis/extract-artifact.ts';
import { inspectArtifact as inventoryArtifact } from '../analysis/formats/artifact.mjs';
import { mapAnalyzerError } from '../analysis/map-analyzer-error.ts';
import { targetUnavailable, unsupportedTarget } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence, sha256Hex } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';

const ZIP_FAMILY = new Set(['zip', 'apk', 'ipa', 'msix']);

const INSPECTION_LIMITATION =
  'Inspection derives bounded static hypotheses and next probes; it does not execute the artifact or claim format-specific semantics.';

export interface ExtractArtifactParams {
  readonly integrity_policy?: 'fail' | 'record-and-continue';
}

export interface InspectArtifactParams {
  readonly integrity_policy?: 'fail' | 'record-and-continue';
  readonly detail?: 'complete' | 'summary';
}

const digestOf = (input: string | Uint8Array): string =>
  typeof input === 'string' ? sha256Hex(input) : createHash('sha256').update(input).digest('hex');

export const inspectArtifact = async (session: ReaSession, params: InspectArtifactParams = {}): Promise<AgentToolResult<unknown>> => {
  const target = session.target;
  if (target === undefined) {
    throw targetUnavailable('No target is open. Call open_binary with a ZIP-family archive before inspect_artifact.');
  }
  if (!ZIP_FAMILY.has(target.identity.format)) {
    throw unsupportedTarget('Only ZIP-family containers are inventoried by inspect_artifact.', {
      path: target.identity.path,
      detected: target.identity.format,
    });
  }

  const integrityPolicy = params.integrity_policy ?? 'fail';
  const subject = {
    name: target.identity.path.split('/').pop() ?? target.identity.path,
    digest: { sha256: target.identity.sha256 },
    format: target.identity.format,
    architecture: target.identity.architecture,
    local_path: target.identity.path,
  };

  let inventoryResult: Awaited<ReturnType<typeof inventoryArtifact>>;
  try {
    const bytes = await readFile(target.identity.path);
    inventoryResult = inventoryArtifact({ bytes, subject, integrityPolicy });
  } catch (error) {
    mapAnalyzerError(error);
  }

  const inventoryEvidence = createEvidence({
    subject,
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inventory_artifact',
    parameters: {
      integrity_policy: integrityPolicy,
    },
    raw_result: null,
    normalized_result: inventoryResult.inventory,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inventoryResult.inventory.limitations],
    locations: [],
    evidence_links: [],
  });
  session.evidence.record(inventoryEvidence);

  const manifest = inventoryResult.inventory.manifest;
  const observationId = `aio_${digestOf(`observation:${manifest.manifest_id}:${inventoryEvidence.evidence_id}`)}`;
  const substepId = `ais_${digestOf(`substep:${manifest.manifest_id}:${inventoryEvidence.evidence_id}`)}`;
  const inspectionId = `ai_${digestOf(`inspection:${manifest.manifest_id}:${target.identity.sha256}`)}`;

  const limitations = [INSPECTION_LIMITATION, inventoryResult.zip_limitation];
  const normalizedResult = {
    inspection_id: inspectionId,
    subject: {
      manifest_id: manifest.manifest_id,
      root_artifact_id: manifest.root_artifact_id,
      root_sha256: manifest.root_sha256,
      root_format: manifest.root_format,
    },
    substeps: [
      {
        substep_id: substepId,
        operation: 'inventory_artifact',
        status: 'completed',
        evidence_id: inventoryEvidence.evidence_id,
        evidence: inventoryEvidence,
      },
    ],
    observations: [
      {
        observation_id: observationId,
        kind: 'root-manifest',
        subject: manifest.root_artifact_id,
        value: {
          manifest_id: manifest.manifest_id,
          root_artifact_id: manifest.root_artifact_id,
          root_sha256: manifest.root_sha256,
          root_format: manifest.root_format,
          graph_sha256: manifest.graph_sha256,
          node_count: manifest.node_count,
          occurrence_count: manifest.occurrence_count,
          edge_count: manifest.edge_count,
        },
        evidence_id: inventoryEvidence.evidence_id,
      },
    ],
    hypotheses: [],
    contradictions: [],
    unexplored_branches: [],
    next_probes: [],
    coverage: {
      status: 'complete-within-substeps',
      substeps_completed: 1,
      observations_retained: 1,
      observations_omitted: 0,
      hypotheses_retained: 0,
      hypotheses_omitted: 0,
      unexplored_branches_retained: 0,
      unexplored_branches_omitted: 0,
      next_probes_retained: 0,
      next_probes_omitted: 0,
    },
    evidence_links: [inventoryEvidence.evidence_id],
    limitations,
  };

  const record = createEvidence({
    subject,
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_artifact',
    parameters: {
      integrity_policy: integrityPolicy,
      input_path: target.identity.path,
      ...(params.detail === undefined ? {} : { detail: params.detail }),
    },
    raw_result: null,
    normalized_result: normalizedResult,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations,
    locations: [],
    evidence_links: [inventoryEvidence.evidence_id],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};

export const extractArtifact = async (session: ReaSession, params: ExtractArtifactParams = {}): Promise<AgentToolResult<unknown>> => {
  const target = session.target;
  if (target === undefined) {
    throw targetUnavailable('No app is open. Ask the user which app to investigate, then call open_binary with its local path.');
  }
  if (!ZIP_FAMILY.has(target.identity.format)) {
    throw unsupportedTarget('Only ZIP-family containers are extracted by extract_artifact.', {
      path: target.identity.path,
      detected: target.identity.format,
    });
  }

  const integrityPolicy = params.integrity_policy ?? 'fail';
  const bytes = await readFile(target.identity.path);
  let inspection: Awaited<ReturnType<typeof extractZipArtifact>>;
  try {
    inspection = await extractZipArtifact(bytes, {
      rootSha256: target.identity.sha256,
      rootFormat: target.identity.format,
      integrityPolicy,
    });
  } catch (error) {
    mapAnalyzerError(error);
  }

  const subject = {
    name: target.identity.path.split('/').pop() ?? target.identity.path,
    digest: { sha256: target.identity.sha256 },
    format: target.identity.format,
    architecture: target.identity.architecture,
    local_path: target.identity.path,
  };
  const record = createEvidence({
    subject,
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'extract_artifact',
    parameters: {
      integrity_policy: integrityPolicy,
      input_path: target.identity.path,
      output_root: inspection.output_root,
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};
