import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, realpath, stat } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';

import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { inspectAssetCatalogInBundle } from '../analysis/asset-catalog.ts';
import { inspectKeyedArchiveFromPath } from '../analysis/keyed-archive.ts';
import { invalidRequest, targetUnavailable, unreadableOutput } from '../contract/errors.ts';
import { evidenceResult, operationResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';
import { createEvidence } from '../session/evidence.ts';
import { ANALYZER_PROVIDER } from './analyzer-provider.ts';
import type { ToolCallContext } from './session-tools.ts';

const execFileAsync = promisify(execFile);
const ASSETUTIL = '/usr/bin/assetutil';

export interface OpenBundleResourcesParams {
  readonly path: string;
}

export interface InspectKeyedArchiveParams {
  readonly path?: string;
  readonly root?: string;
  readonly offset?: number;
  readonly limit?: number;
}

export interface InspectAssetCatalogParams {
  readonly offset?: number;
  readonly limit?: number;
}

const resolveInfoPlist = async (root: string): Promise<{ readonly infoPlistPath: string | null; readonly layout: 'root' | 'contents' }> => {
  const contents = join(root, 'Contents', 'Info.plist');
  const rootInfo = join(root, 'Info.plist');
  try {
    await access(contents);
    return { infoPlistPath: contents, layout: 'contents' };
  } catch {}
  try {
    await access(rootInfo);
    return { infoPlistPath: rootInfo, layout: 'root' };
  } catch {
    return { infoPlistPath: null, layout: 'root' };
  }
};

export const openBundleResources = async (session: ReaSession, params: OpenBundleResourcesParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  if (typeof params.path !== 'string' || params.path.length === 0) {
    throw invalidRequest('Invalid arguments for tool open_bundle_resources: path: Invalid input: expected string, received undefined', {
      parameter: 'path',
    });
  }
  if (!isAbsolute(params.path)) {
    throw invalidRequest('open_bundle_resources rejects relative paths; supply an absolute filesystem path.', {
      parameter: 'path',
    });
  }
  void context;
  let canonical: string;
  try {
    canonical = await realpath(params.path);
  } catch (error) {
    throw invalidRequest(`Cannot open bundle resources: ${(error as Error).message}`, { parameter: 'path' });
  }
  const stats = await stat(canonical);
  if (!stats.isDirectory()) {
    throw invalidRequest('open_bundle_resources requires a directory app bundle root.', { parameter: 'path' });
  }
  const info = await resolveInfoPlist(canonical);
  const binding = session.openBundleResources({
    callerPath: params.path,
    canonicalPath: canonical,
    infoPlistPath: info.infoPlistPath,
    layout: info.layout,
  });
  return operationResult(
    {
      caller_path: binding.callerPath,
      canonical_path: binding.canonicalPath,
      info_plist_path: binding.infoPlistPath,
      layout: binding.layout,
      executable_sha256: null,
      run_id: binding.runId,
    },
    { provenance: true },
  );
};

export const inspectKeyedArchive = async (session: ReaSession, params: InspectKeyedArchiveParams, context: ToolCallContext = {}): Promise<AgentToolResult<unknown>> => {
  const bundle = session.bundleResources;
  if (bundle === undefined) {
    throw targetUnavailable('No bundle-resource session is open. Call open_bundle_resources first.');
  }
  const relative = params.path ?? '.';
  const archivePath = isAbsolute(relative) ? relative : resolve(bundle.canonicalPath, relative);
  const displayPath = isAbsolute(relative) ? (relative.startsWith(`${bundle.canonicalPath}/`) ? relative.slice(bundle.canonicalPath.length + 1) : relative) : relative;
  const { record: inspection } = await inspectKeyedArchiveFromPath(archivePath, {
    ...(context.cwd === undefined ? {} : { cwd: context.cwd }),
    ...(params.root === undefined ? {} : { root: params.root }),
    ...(params.offset === undefined ? {} : { offset: params.offset }),
    ...(params.limit === undefined ? {} : { limit: params.limit }),
  });
  const projected = {
    ...inspection,
    archive_path: displayPath,
    resource_root: {
      caller_path: bundle.callerPath,
      canonical_path: bundle.canonicalPath,
      info_plist_path: bundle.infoPlistPath,
      layout: bundle.layout,
      executable_sha256: null,
    },
  };
  const record = createEvidence({
    subject: null,
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_keyed_archive',
    parameters: {
      path: displayPath,
      offset: params.offset ?? 0,
      limit: params.limit ?? 20_000,
      input_path: bundle.callerPath,
      ...(params.root === undefined ? {} : { root: params.root }),
    },
    raw_result: null,
    normalized_result: projected,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: ['Artifact identity is unavailable for this observation.', ...inspection.limitations],
    locations: [],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};

export const inspectAssetCatalog = async (session: ReaSession, params: InspectAssetCatalogParams = {}): Promise<AgentToolResult<unknown>> => {
  const bundle = session.bundleResources;
  if (bundle === undefined) {
    throw targetUnavailable('No bundle-resource session is open. Call open_bundle_resources first.');
  }
  const inspection = await inspectAssetCatalogInBundle(bundle.canonicalPath, {
    ...(params.offset === undefined ? {} : { offset: params.offset }),
    ...(params.limit === undefined ? {} : { limit: params.limit }),
  });
  const catalogPath = inspection.catalogs[0]?.path;
  if (catalogPath !== undefined) {
    const catalogRelative = relative(bundle.canonicalPath, catalogPath).split('\\').join('/') || 'Assets.car';
    let stdout = '';
    let stderr = '';
    let exitCode = 0;
    let signal: string | null = null;
    try {
      const result = await execFileAsync(ASSETUTIL, ['--info', catalogPath], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        timeout: 60_000,
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & {
        stdout?: string;
        stderr?: string;
        status?: number | null;
        signal?: string | null;
        code?: string | number | null;
      };
      stdout = typeof failure.stdout === 'string' ? failure.stdout : '';
      stderr = typeof failure.stderr === 'string' ? failure.stderr : '';
      exitCode = typeof failure.status === 'number' ? failure.status : typeof failure.code === 'number' ? failure.code : 1;
      signal = typeof failure.signal === 'string' ? failure.signal : null;
      if (failure.code === 'ENOENT') {
        throw unreadableOutput('Analysis returned an unreadable result. Run `rea doctor` and review the reported details; repeating the unchanged request is not expected to succeed.', {
          operation: 'inspect_asset_catalog',
          reason: 'macOS assetutil is unavailable',
          diagnostics: { catalog_path: catalogRelative },
          provider_diagnostics: { catalog_path: catalogRelative },
        });
      }
    }
    const usableJson = (() => {
      try {
        JSON.parse(stdout);
        return stdout.trim().length > 0;
      } catch {
        return false;
      }
    })();
    if (!usableJson) {
      const reason = `assetutil did not produce usable catalog metadata for ${catalogRelative}`;
      throw unreadableOutput('Analysis returned an unreadable result. Run `rea doctor` and review the reported details; repeating the unchanged request is not expected to succeed.', {
        operation: 'inspect_asset_catalog',
        reason,
        diagnostics: { catalog_path: catalogRelative },
        provider_diagnostics: { catalog_path: catalogRelative },
        captured_output: {
          stdout,
          stderr,
          stdout_bytes: Buffer.byteLength(stdout),
          stderr_bytes: Buffer.byteLength(stderr),
          exit_code: exitCode,
          signal,
          truncated: false,
        },
      });
    }
  }
  const digest = inspection.catalogs[0]?.sha256 ?? createEmptyDigest(bundle.canonicalPath);
  const record = createEvidence({
    subject: {
      name: 'Assets.car',
      digest: { sha256: digest },
      format: 'asset-catalog',
      architecture: null,
      local_path: inspection.catalogs[0]?.path ?? bundle.canonicalPath,
    },
    provider: ANALYZER_PROVIDER,
    analysis_profile: null,
    predicate_type: 'rea.analysis',
    operation: 'inspect_asset_catalog',
    parameters: {
      offset: params.offset ?? 0,
      limit: params.limit ?? 10_000,
    },
    raw_result: null,
    normalized_result: inspection,
    confidence: 'observed',
    authority: 'shipped-artifact',
    environment: null,
    limitations: [...inspection.limitations],
    locations: [{ kind: 'artifact-path', path: bundle.canonicalPath }],
    evidence_links: [],
  });
  session.evidence.record(record);
  return evidenceResult(record);
};

const createEmptyDigest = (seed: string): string => createHash('sha256').update(`asset-catalog-absent:${seed}`).digest('hex');
