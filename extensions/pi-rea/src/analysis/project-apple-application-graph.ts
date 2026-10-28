import { invalidRequest } from '../contract/errors.ts';
import type { EvidenceRecord } from '../session/evidence.ts';
import { digestOf } from './canonical.mjs';

export interface AppleApplicationGraphInspection {
  readonly projection_id: string;
  readonly root_sha256: string;
  readonly root_format: 'ipa' | 'directory' | 'zip' | 'dmg';
  readonly platforms: readonly ('ios' | 'macos')[];
  readonly source_evidence_ids: readonly string[];
  readonly application_roots: readonly string[];
  readonly bundles: readonly AppleBundle[];
  readonly components: {
    readonly bundle_metadata: readonly { readonly path: string; readonly artifact_id: string | null; readonly sha256: string | null; readonly format: string | null }[];
    readonly executables: readonly unknown[];
    readonly frameworks: readonly unknown[];
    readonly native_libraries: readonly unknown[];
    readonly javascript: readonly unknown[];
    readonly signing: readonly unknown[];
    readonly privileged_helpers: readonly unknown[];
    readonly launchd_plists: readonly string[];
    readonly helpers: readonly unknown[];
  };
  readonly unavailable_components: readonly unknown[];
  readonly symlinks: readonly unknown[];
  readonly runtime_families: readonly unknown[];
  readonly bridge_candidates: readonly unknown[];
  readonly bridge_candidate_coverage: {
    readonly status: 'complete';
    readonly total_candidates: number;
    readonly emitted_candidates: number;
    readonly omitted_candidates: number;
  };
  readonly coverage: { readonly status: 'complete-within-inventory'; readonly inventory_complete: true };
  readonly limitations: readonly string[];
}

interface AppleBundle {
  readonly path: string;
  readonly parent_path: string | null;
  readonly layout: 'shallow' | 'macos-deep' | 'versioned-framework';
  readonly role: 'application' | 'app-extension' | 'xpc-service' | 'framework' | 'login-item' | 'system-extension' | 'driver-extension' | 'plug-in' | 'resource-bundle' | 'bundle' | 'helper-application' | 'nested-application';
  readonly role_basis: 'path-convention';
  readonly info_plist_path: string | null;
  readonly executable_candidates: readonly string[];
  readonly signing_paths: readonly string[];
}

interface Occurrence {
  readonly logical_path: string;
  readonly sha256: string | null;
  readonly artifact_id: string | null;
  readonly is_directory: boolean;
}

const LIMITATIONS = [
  'ZIP inventory lists central-directory entries only. Non-entry bytes, including leading bytes before the first entry such as a self-extractor stub, an APK Signing Block before the central directory or a ZIP comment after it, are not occurrences.',
  'Bundle roles follow path conventions. Read each info_plist_path with inspect_plist for CFBundleExecutable, identifiers, and declared services.',
  'Bundle identifiers and signing claims require dedicated plist and CMS parsing; this projection reports only exact paths and hashes.',
  'Runtime families are inferred from inventory formats and bounded framework path conventions, not observed runtime loading.',
  'Generic framework and dylib paths do not establish Swift or Objective-C; this inventory projection does not decode language metadata.',
  'Bridge candidates are path-based hypotheses, not observed runtime calls.',
  'A bridge basis is inferred from the native path and is repeated for every managed component.',
] as const;

const asEvidence = (value: unknown, index: number): EvidenceRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRequest(`project_apple_application_graph inventory_evidence[${index}] must be an Evidence object.`, {
      operation: 'project_apple_application_graph',
      parameter: 'inventory_evidence',
    });
  }
  const record = value as EvidenceRecord;
  if (typeof record.evidence_id !== 'string' || !record.evidence_id.startsWith('ev_')) {
    throw invalidRequest(`project_apple_application_graph inventory_evidence[${index}] must carry an evidence_id.`, {
      operation: 'project_apple_application_graph',
      parameter: 'inventory_evidence',
    });
  }
  return record;
};

const occurrencesFrom = (record: EvidenceRecord): { rootSha: string | null; format: string | null; occurrences: Occurrence[] } => {
  const nr = record.normalized_result as Record<string, unknown> | null;
  if (nr === null || typeof nr !== 'object') return { rootSha: null, format: null, occurrences: [] };

  const collections = nr['collections'] as { occurrences?: readonly Record<string, unknown>[] } | undefined;
  if (collections?.occurrences) {
    return {
      rootSha: typeof nr['root_artifact_sha256'] === 'string' ? nr['root_artifact_sha256'] : null,
      format: typeof nr['root_format'] === 'string' ? nr['root_format'] : typeof record.subject?.format === 'string' ? record.subject.format : null,
      occurrences: collections.occurrences.map((entry) => ({
        logical_path: String(entry['logical_path'] ?? ''),
        sha256: typeof entry['calculated_sha256'] === 'string' ? entry['calculated_sha256'] : null,
        artifact_id: typeof entry['artifact_id'] === 'string' ? entry['artifact_id'] : null,
        is_directory: entry['is_directory'] === true,
      })),
    };
  }

  const substeps = nr['substeps'] as readonly { evidence?: EvidenceRecord; operation?: string }[] | undefined;
  const nestedEvidence = substeps?.find((step) => step.operation === 'inventory_artifact')?.evidence;
  const nested = (nestedEvidence?.normalized_result as Record<string, unknown> | undefined) ?? (nr['normalized_result'] as Record<string, unknown> | undefined) ?? nr;
  const rows = Array.isArray(nested['occurrences'])
    ? (nested['occurrences'] as Record<string, unknown>[])
    : Array.isArray(nr['entries'])
      ? (nr['entries'] as Record<string, unknown>[])
      : Array.isArray(nr['members'])
        ? (nr['members'] as Record<string, unknown>[])
        : [];
  const nodes = Array.isArray(nested['nodes']) ? (nested['nodes'] as Record<string, unknown>[]) : [];
  const shaByArtifact = new Map(nodes.filter((node) => typeof node['artifact_id'] === 'string' && typeof node['sha256'] === 'string').map((node) => [String(node['artifact_id']), String(node['sha256'])]));
  const manifest = nested['manifest'] as { root_sha256?: string; root_format?: string } | undefined;

  if (rows.length === 0 && Array.isArray(nr['resources'])) {
    return {
      rootSha: typeof nr['root_artifact_sha256'] === 'string' ? nr['root_artifact_sha256'] : (record.subject?.digest.sha256 ?? null),
      format: record.subject?.format ?? 'directory',
      occurrences: (nr['resources'] as Record<string, unknown>[]).map((entry) => ({
        logical_path: String(entry['relative_path'] ?? entry['path'] ?? ''),
        sha256: typeof entry['sha256'] === 'string' ? entry['sha256'] : null,
        artifact_id: typeof entry['artifact_id'] === 'string' ? entry['artifact_id'] : null,
        is_directory: entry['is_directory'] === true,
      })),
    };
  }

  return {
    rootSha: typeof manifest?.root_sha256 === 'string' ? manifest.root_sha256 : typeof nr['root_artifact_sha256'] === 'string' ? nr['root_artifact_sha256'] : (record.subject?.digest.sha256 ?? null),
    format: typeof manifest?.root_format === 'string' ? manifest.root_format : typeof nested['format'] === 'string' ? nested['format'] : (record.subject?.format ?? null),
    occurrences: rows
      .filter((entry) => entry['logical_path'] !== '.')
      .map((entry) => ({
        logical_path: String(entry['logical_path'] ?? entry['path'] ?? entry['relative_path'] ?? ''),
        sha256:
          typeof entry['calculated_sha256'] === 'string'
            ? entry['calculated_sha256']
            : typeof entry['sha256'] === 'string'
              ? entry['sha256']
              : typeof entry['artifact_id'] === 'string'
                ? (shaByArtifact.get(String(entry['artifact_id'])) ?? null)
                : null,
        artifact_id: typeof entry['artifact_id'] === 'string' ? entry['artifact_id'] : null,
        is_directory: entry['entry_kind'] === 'directory' || entry['is_directory'] === true,
      })),
  };
};

const roleFor = (bundlePath: string): AppleBundle['role'] => {
  const lower = bundlePath.toLowerCase();
  if (lower.includes('.appex/') || lower.endsWith('.appex')) return 'app-extension';
  if (lower.includes('/xpcservices/') || lower.endsWith('.xpc')) return 'xpc-service';
  if (lower.includes('/loginitems/') || lower.includes('loginitems/')) return 'login-item';
  if (lower.includes('.systemextension') || lower.includes('/systemextensions/')) return 'system-extension';
  if (lower.includes('.dext') || lower.includes('/driverextensions/')) return 'driver-extension';
  if (lower.includes('.framework/') || lower.endsWith('.framework')) return 'framework';
  if (lower.includes('/plugins/') || lower.includes('/plugIns/'.toLowerCase()) || lower.endsWith('.plugin')) return 'plug-in';
  if (lower.includes('/helpers/') || /helper\.app$/i.test(bundlePath)) return 'helper-application';
  if (/(^|\/)[^/]+\.app$/i.test(bundlePath) && bundlePath.split('/').filter((part) => part.endsWith('.app')).length > 1) return 'nested-application';
  if (/(^|\/)[^/]+\.app$/i.test(bundlePath)) return 'application';
  if (lower.endsWith('.bundle')) return 'resource-bundle';
  return 'bundle';
};

const layoutFor = (bundlePath: string, paths: Set<string>): AppleBundle['layout'] => {
  if (paths.has(`${bundlePath}/Contents/Info.plist`) || [...paths].some((path) => path.startsWith(`${bundlePath}/Contents/`))) return 'macos-deep';
  if (bundlePath.endsWith('.framework') && [...paths].some((path) => path.includes(`${bundlePath}/Versions/`))) return 'versioned-framework';
  return 'shallow';
};

const parentBundle = (bundlePath: string, bundles: readonly string[]): string | null => {
  const parents = bundles.filter((candidate) => candidate !== bundlePath && bundlePath.startsWith(`${candidate}/`));
  if (parents.length === 0) return null;
  return parents.sort((left, right) => right.length - left.length)[0] ?? null;
};

export const projectAppleApplicationGraph = (params: { readonly inventory_evidence: readonly unknown[] }): AppleApplicationGraphInspection => {
  if (!Array.isArray(params.inventory_evidence) || params.inventory_evidence.length === 0) {
    throw invalidRequest('project_apple_application_graph requires at least one inventory_evidence entry.', {
      operation: 'project_apple_application_graph',
      parameter: 'inventory_evidence',
      issues: [{ path: ['inventory_evidence'], reason: 'out_of_range', minimum: 1 }],
    });
  }

  const records = params.inventory_evidence.map((entry, index) => asEvidence(entry, index));
  const allOccurrences: Occurrence[] = [];
  let rootSha: string | null = null;
  let rootFormat: AppleApplicationGraphInspection['root_format'] = 'directory';
  const platforms = new Set<'ios' | 'macos'>();

  for (const record of records) {
    const extracted = occurrencesFrom(record);
    allOccurrences.push(...extracted.occurrences.filter((row) => row.logical_path.length > 0));
    if (rootSha === null && extracted.rootSha !== null) rootSha = extracted.rootSha;
    const format = (extracted.format ?? '').toLowerCase();
    if (format.includes('ipa')) {
      rootFormat = 'ipa';
      platforms.add('ios');
    } else if (format.includes('dmg')) rootFormat = 'dmg';
    else if (format.includes('zip')) rootFormat = 'zip';
    else if (format.includes('directory') || format.includes('app-bundle') || format.includes('bundle')) rootFormat = 'directory';
  }

  const paths = new Set(allOccurrences.map((row) => row.logical_path.replace(/\/+$/, '')));
  const bundlePaths = [...paths].filter((path) => /\.(app|appex|framework|xpc|bundle|systemextension|dext|plugin)$/i.test(path.split('/').pop() ?? '')).sort();

  if (bundlePaths.some((path) => path.endsWith('.app') && path.includes('/Payload/'))) platforms.add('ios');
  if (bundlePaths.some((path) => paths.has(`${path}/Contents/Info.plist`))) platforms.add('macos');
  if (platforms.size === 0 && bundlePaths.some((path) => path.endsWith('.app'))) platforms.add('macos');

  const bundles: AppleBundle[] = bundlePaths.map((bundlePath) => {
    const layout = layoutFor(bundlePath, paths);
    const info = layout === 'macos-deep' ? (paths.has(`${bundlePath}/Contents/Info.plist`) ? `${bundlePath}/Contents/Info.plist` : null) : paths.has(`${bundlePath}/Info.plist`) ? `${bundlePath}/Info.plist` : null;
    const signingPaths = [...paths].filter((path) => path === `${bundlePath}/Contents/_CodeSignature/CodeResources` || path === `${bundlePath}/_CodeSignature/CodeResources` || path.endsWith('/embedded.mobileprovision'));
    return {
      path: bundlePath,
      parent_path: parentBundle(bundlePath, bundlePaths),
      layout,
      role: roleFor(bundlePath),
      role_basis: 'path-convention',
      info_plist_path: info,
      executable_candidates: [],
      signing_paths: signingPaths.sort(),
    };
  });

  const applicationRoots = bundles.filter((bundle) => bundle.role === 'application' || bundle.parent_path === null).map((bundle) => bundle.path);
  const launchd = [...paths].filter((path) => /Launch(Agents|Daemons)\//.test(path) && path.endsWith('.plist')).sort();

  const metadata = bundles
    .filter((bundle) => bundle.info_plist_path !== null)
    .map((bundle) => {
      const occ = allOccurrences.find((row) => row.logical_path === bundle.info_plist_path);
      return {
        path: bundle.info_plist_path!,
        artifact_id: occ?.artifact_id ?? (occ?.sha256 === null || occ?.sha256 === undefined ? null : `art_${digestOf(`member:${occ.sha256}`)}`),
        sha256: occ?.sha256 ?? null,
        format: 'plist',
      };
    });

  if (rootSha === null) rootSha = digestOf(JSON.stringify(allOccurrences.map((row) => row.logical_path).sort()));

  return {
    projection_id: `aap_${digestOf(`${rootSha}:${records.map((record) => record.evidence_id).join(':')}`)}`,
    root_sha256: rootSha,
    root_format: rootFormat,
    platforms: [...platforms].sort(),
    source_evidence_ids: records.map((record) => record.evidence_id),
    application_roots: applicationRoots.length > 0 ? applicationRoots : bundlePaths.filter((path) => path.endsWith('.app')),
    bundles,
    components: {
      bundle_metadata: metadata,
      executables: [],
      frameworks: [],
      native_libraries: [],
      javascript: [],
      signing: [],
      privileged_helpers: [],
      launchd_plists: launchd,
      helpers: [],
    },
    unavailable_components: [],
    symlinks: [],
    runtime_families: [],
    bridge_candidates: [],
    bridge_candidate_coverage: {
      status: 'complete',
      total_candidates: 0,
      emitted_candidates: 0,
      omitted_candidates: 0,
    },
    coverage: { status: 'complete-within-inventory', inventory_complete: true },
    limitations: [...LIMITATIONS],
  };
};
