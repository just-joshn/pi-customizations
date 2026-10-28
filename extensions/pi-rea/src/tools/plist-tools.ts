import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { decodePlist, type PlistValue, plistInputError, projectBundle } from '../analysis/plist.ts';
import { targetUnavailable } from '../contract/errors.ts';
import { evidenceResult } from '../contract/results.ts';
import { PI_REA_VERSION, type ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';

export const PLIST_PARSER_PROVIDER = { id: 'pi-rea-in-process', name: 'pi-rea in-process analysis', version: PI_REA_VERSION } as const;

export interface InspectPlistParams {
  readonly path?: string;
  readonly input_path?: string;
}

export interface PlistToolContext {
  readonly cwd?: string;
}

const resolvePath = (path: string, cwd: string | undefined): string => (isAbsolute(path) ? path : resolve(cwd ?? process.cwd(), path));

export const inspectPlist = async (session: ReaSession, params: InspectPlistParams, context: PlistToolContext = {}): Promise<AgentToolResult<unknown>> => {
  const target = session.target;
  if (target === undefined) {
    throw targetUnavailable('No target is open. Call open_binary with a local path before inspecting a property list.');
  }
  const requested = params.input_path ?? params.path;
  const fallback = resolve(target.identity.path, 'Contents', 'Info.plist');
  const requestedPath = requested ?? fallback;
  if (requestedPath === undefined) {
    throw plistInputError('<active target>', 'no path was supplied and the active target has no bundle to inspect');
  }
  const path = resolvePath(requestedPath, context.cwd);

  let bytes: Buffer;
  try {
    bytes = await readFile(path);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw plistInputError(requestedPath, reason);
  }

  let decoded: ReturnType<typeof decodePlist>;
  try {
    decoded = decodePlist(bytes);
  } catch (error) {
    throw plistInputError(requestedPath, `it is not a property list (${(error as Error).message})`);
  }

  const record = createEvidence({
    subject: {
      name: path.split('/').pop() ?? path,
      digest: { sha256: createHash('sha256').update(bytes).digest('hex') },
      format: 'plist',
      architecture: null,
      local_path: path,
    },
    provider: PLIST_PARSER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_plist',
    parameters: { input_path: path },
    raw_result: null,
    normalized_result: {
      format: decoded.format,
      value: decoded.value as PlistValue,
      bundle: projectBundle(decoded.value),
      source_path: path,
      limitations: [],
      provenance: [
        {
          tool: 'pi-rea/plist-parser',
          command: [],
          tool_version: PI_REA_VERSION,
          version_reason: 'pi-rea decodes the property list in process; no external tool ran or was sampled.',
          executable_sha256: null,
          exit: { code: 0, signal: null },
          stdout_bytes: 0,
          stderr_bytes: 0,
        },
      ],
    },
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [],
    locations: [{ kind: 'artifact-path', path }],
    evidence_links: [],
  });

  session.evidence.record(record);
  return evidenceResult(record);
};
