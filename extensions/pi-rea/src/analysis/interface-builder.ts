
import { createHash } from 'node:crypto';
import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { join, relative } from 'node:path';

import { invalidRequest, targetUnavailable } from '../contract/errors.ts';
import { decodePlist, type PlistValue } from './plist.ts';

const NIB_MAGIC = Buffer.from('NIBArchive');

export interface InterfaceBuilderResourceRoot {
  readonly caller_path: string;
  readonly canonical_path: string;
  readonly info_plist_path: string | null;
  readonly layout: 'root' | 'contents';
  readonly executable_sha256: null;
}

export interface InterfaceBuilderDocumentSummary {
  readonly relative_path: string;
  readonly archive_sha256: string;
  readonly document_kind: 'nib' | 'storyboard_scene';
  readonly object_count: number;
  readonly connection_count: number;
  readonly hierarchy_complete: boolean;
}

export interface InterfaceBuilderGraphEvidence {
  readonly kind: 'interface_builder_resource';
  readonly description: string;
  readonly location: { readonly address: null; readonly file_offset: null };
  readonly artifact_path: string;
  readonly artifact_sha256: string;
}

export interface InterfaceBuilderGraphNode {
  readonly id: string;
  readonly kind: string;
  readonly name: string;
  readonly location: null;
  readonly attributes: Readonly<Record<string, unknown>>;
  readonly evidence: readonly InterfaceBuilderGraphEvidence[];
}

export interface InterfaceBuilderGraphEdge {
  readonly id: string;
  readonly from: string;
  readonly to: string | null;
  readonly relation: string;
  readonly resolution: 'observed' | 'unresolved';
  readonly evidence: readonly InterfaceBuilderGraphEvidence[];
  readonly limitations: readonly string[];
}

export interface InterfaceBuilderGraphCoverage {
  readonly facet: string;
  readonly status: 'complete' | 'partial' | 'unsupported';
  readonly reason: string | null;
  readonly examined: number;
  readonly omitted: number;
}

export interface InterfaceBuilderGraph {
  readonly target_sha256: null;
  readonly provider: {
    readonly id: 'rea-artifact-graph';
    readonly version: '1';
    readonly tool_version: 'rea-interface-builder/1';
  };
  readonly nodes: readonly InterfaceBuilderGraphNode[];
  readonly edges: readonly InterfaceBuilderGraphEdge[];
  readonly coverage: readonly InterfaceBuilderGraphCoverage[];
  readonly truncated: boolean;
}

export interface InterfaceBuilderInspection {
  readonly target_sha256: null;
  readonly resource_root: InterfaceBuilderResourceRoot;
  readonly documents: readonly InterfaceBuilderDocumentSummary[];
  readonly graph: InterfaceBuilderGraph;
  readonly limitations: readonly string[];
}

const DEFAULT_MAX_DOCUMENTS = 64;
const DEFAULT_MAX_OBJECTS = 20_000;
const DEFAULT_MAX_CONNECTIONS = 40_000;

const GRAPH_LIMITATIONS = [
  'The graph reflects recognized Interface Builder archive fields and connections; omitted private or unrecognized archive fields remain unknown.',
  'A target-action selector is an Interface Builder observation and does not prove that the binary contains a matching implementation.',
  'Decoded constraints, runtime visibility, dynamic UI creation, and pixel geometry are not inferred from these archives.',
] as const;

const COMPILED_ARCHIVE_LIMITATION =
  'Compiled Interface Builder archives are private serialized object graphs. The decoder reports only recognized keyed-archive objects and connections; unrecognized object classes and fields remain unknown.';

const isPlainObject = (value: PlistValue): value is { [key: string]: PlistValue } =>
  value !== null && typeof value === 'object' && !Array.isArray(value) && !('$plist_type' in value);

const uidOf = (value: PlistValue): number | undefined => {
  if (!isPlainObject(value)) return undefined;
  if (typeof value.CF$UID === 'number') return value.CF$UID;
  if (typeof value.UID === 'number') return value.UID;
  return undefined;
};

const firstString = (...values: unknown[]): string | null => {
  for (const value of values) {
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return null;
};

const isIbCandidate = (name: string): boolean => {
  const lower = name.toLowerCase();
  return lower.endsWith('.nib') || lower.endsWith('.storyboardc') || lower.endsWith('.storyboard');
};

const walkFiles = async (root: string): Promise<string[]> => {
  const out: string[] = [];
  const stack = [root];
  while (stack.length > 0) {
    const current = stack.pop()!;
    let entries;
    try {
      entries = await readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === '.storyboardc' || entry.name.endsWith('.storyboardc') || isIbCandidate(entry.name)) {
          stack.push(full);
        } else if (!entry.name.startsWith('.')) {
          stack.push(full);
        }
      } else if (entry.isFile() && (isIbCandidate(entry.name) || entry.name.toLowerCase().endsWith('.nib'))) {
        out.push(full);
      }
    }
  }
  return out;
};

const parseNibArchiveHeader = (bytes: Buffer): { readonly objectCount: number } | null => {
  if (bytes.length < 18 || !bytes.subarray(0, 10).equals(NIB_MAGIC)) return null;
  const objectCount = bytes.readUInt32LE(14);
  return { objectCount };
};

const evidenceFor = (relativePath: string, archiveSha256: string, description: string): InterfaceBuilderGraphEvidence => ({
  kind: 'interface_builder_resource',
  description,
  location: { address: null, file_offset: null },
  artifact_path: relativePath,
  artifact_sha256: archiveSha256,
});

const classifyObjectKind = (className: string | null, classChain: readonly string[]): string => {
  const connection =
    className !== null &&
    ((className.startsWith('NS') && className.endsWith('Connector')) || /^UIRuntime\w*Connection$/u.test(className));
  if (connection || classChain.includes('NSNibConnector')) return 'other';
  const bases: Array<[string, readonly string[]]> = [
    ['view_controller', ['UIViewController', 'NSViewController', 'NSWindowController']],
    ['control', ['UIControl', 'NSControl']],
    ['view', ['UIView', 'NSView', 'UIWindow', 'NSWindow']],
  ];
  for (const [kind, names] of bases) {
    if (names.some((name) => classChain.includes(name))) return kind;
  }
  const value = className?.toLowerCase() ?? '';
  if (value.includes('constraint')) return 'constraint';
  if (value.includes('layoutguide')) return 'layout_guide';
  if (value.includes('placeholder') || value.includes('firstresponder') || value === 'uiproxyobject') return 'placeholder';
  if (value.includes('external')) return 'external_object';
  if (value.includes('viewcontroller') || value.includes('windowcontroller')) return 'view_controller';
  if (
    value.includes('button') ||
    value.includes('control') ||
    value.includes('textfield') ||
    value.includes('slider') ||
    value.includes('menuitem') ||
    value.includes('colorwell')
  ) {
    return 'control';
  }
  if (value.includes('view') || value.includes('window') || value.includes('cell')) return 'view';
  if (value.includes('image') || value.includes('color') || value.includes('font')) return 'resource';
  return 'other';
};

interface KeyedObjectRow {
  readonly id: string;
  readonly kind: string;
  readonly class_name: string | null;
  readonly name: string;
  readonly attributes: Readonly<Record<string, unknown>>;
}

const projectKeyedArchive = (
  relativePath: string,
  archiveSha256: string,
  raw: PlistValue,
  maxObjects: number,
): {
  readonly document: InterfaceBuilderDocumentSummary;
  readonly nodes: InterfaceBuilderGraphNode[];
  readonly edges: InterfaceBuilderGraphEdge[];
  readonly coverage: InterfaceBuilderGraphCoverage[];
  readonly classes: number;
} | null => {
  if (!isPlainObject(raw) || raw.$archiver !== 'NSKeyedArchiver' || !Array.isArray(raw.$objects)) {
    return null;
  }
  const objectTable = raw.$objects as PlistValue[];
  const classNames = new Map<number, { readonly name: string | null; readonly chain: readonly string[] }>();
  for (const [index, entry] of objectTable.entries()) {
    if (!isPlainObject(entry)) continue;
    if (typeof entry.$classname === 'string' || Array.isArray(entry.$classes)) {
      const chain = Array.isArray(entry.$classes)
        ? entry.$classes.filter((item): item is string => typeof item === 'string')
        : [];
      classNames.set(index, {
        name: typeof entry.$classname === 'string' ? entry.$classname : null,
        chain,
      });
    }
  }

  const objects: KeyedObjectRow[] = [];
  let objectCount = 0;
  for (const [index, entry] of objectTable.entries()) {
    if (index === 0) continue;
    const row = isPlainObject(entry) ? entry : null;
    const classUid = row === null ? undefined : uidOf(row.$class as PlistValue);
    const classFacts = classUid === undefined ? undefined : classNames.get(classUid);
    const archivedClassName = classFacts?.name ?? null;
    if (archivedClassName === null && (row === null || !Object.hasOwn(row, '$class'))) continue;
    objectCount += 1;
    if (objects.length >= maxObjects) continue;
    const attributes: Record<string, unknown> = {};
    if (row !== null) {
      for (const [key, value] of Object.entries(row)) {
        if (key === '$class') continue;
        attributes[key] = value;
      }
    }
    const className = archivedClassName;
    const kind = classifyObjectKind(className, classFacts?.chain ?? []);
    objects.push({
      id: String(index),
      kind: kind === 'other' ? 'unknown' : kind,
      class_name: className,
      name: firstString(attributes.label, attributes.title, attributes.identifier, attributes.accessibilityLabel, className) ?? `object ${String(index)}`,
      attributes,
    });
  }

  const prefix = `ib:${JSON.stringify(relativePath)}:`;
  const rootId = `${prefix}root`;
  const documentKind: 'nib' | 'storyboard_scene' = relativePath.includes('.storyboardc/') ? 'storyboard_scene' : 'nib';
  const graphId = (kind: string, parts: readonly unknown[]): string => `${prefix}${kind}:${JSON.stringify(parts)}`;
  const objectNodeId = (objectId: string): string => graphId('object', [objectId]);

  const nodes: InterfaceBuilderGraphNode[] = [
    {
      id: rootId,
      kind: documentKind === 'nib' ? 'scene' : 'storyboard',
      name: relativePath,
      location: null,
      attributes: { document_kind: documentKind },
      evidence: [evidenceFor(relativePath, archiveSha256, 'compiled document')],
    },
  ];
  for (const object of objects) {
    nodes.push({
      id: objectNodeId(object.id),
      kind: object.kind,
      name: object.name,
      location: null,
      attributes: {
        ...object.attributes,
        interface_builder_object_id: object.id,
        class_name: object.class_name,
      },
      evidence: [evidenceFor(relativePath, archiveSha256, `object ${object.id}`)],
    });
  }

  const edges: InterfaceBuilderGraphEdge[] = [];
  let hierarchyExamined = 0;
  const top = isPlainObject(raw.$top) ? raw.$top : {};
  const hierarchyRoot = Object.hasOwn(top, 'UINibTopLevelObjectsKey') ? top.UINibTopLevelObjectsKey : top.root;
  const visit = (value: PlistValue): void => {
    const uid = uidOf(value);
    if (uid !== undefined) {
      if (uid === 0) return;
      const childId = objectNodeId(String(uid));
      if (!nodes.some((node) => node.id === childId)) return;
      hierarchyExamined += 1;
      edges.push({
        id: graphId('hierarchy', [rootId, childId]),
        from: rootId,
        to: childId,
        relation: 'contains',
        resolution: 'observed',
        evidence: [evidenceFor(relativePath, archiveSha256, `hierarchy ${String(uid)}`)],
        limitations: [],
      });
      return;
    }
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
    }
  };
  if (hierarchyRoot !== undefined) visit(hierarchyRoot as PlistValue);

  const classes = classNames.size;
  const document: InterfaceBuilderDocumentSummary = {
    relative_path: relativePath,
    archive_sha256: archiveSha256,
    document_kind: documentKind,
    object_count: objectCount,
    connection_count: 0,
    hierarchy_complete: hierarchyExamined > 0,
  };
  const coverage: InterfaceBuilderGraphCoverage[] = [
    {
      facet: `objects:${relativePath}`,
      status: 'complete',
      reason: null,
      examined: objects.length,
      omitted: Math.max(0, objectCount - objects.length),
    },
    {
      facet: `connections:${relativePath}`,
      status: 'complete',
      reason: null,
      examined: 0,
      omitted: 0,
    },
    {
      facet: `hierarchy:${relativePath}`,
      status: hierarchyExamined > 0 ? 'complete' : 'unsupported',
      reason: hierarchyExamined > 0 ? null : 'archive_hierarchy_not_decoded',
      examined: hierarchyExamined,
      omitted: 0,
    },
    {
      facet: `classes:${relativePath}`,
      status: classes > 0 ? 'complete' : 'unsupported',
      reason: classes > 0 ? null : 'archive_class_table_not_decoded',
      examined: classes,
      omitted: 0,
    },
  ];
  return { document, nodes, edges, coverage, classes };
};

const decodeDocument = async (
  absolutePath: string,
  bundleRoot: string,
  maxObjects: number,
): Promise<{
  readonly document: InterfaceBuilderDocumentSummary;
  readonly nodes: InterfaceBuilderGraphNode[];
  readonly edges: InterfaceBuilderGraphEdge[];
  readonly coverage: InterfaceBuilderGraphCoverage[];
} | null> => {
  const relativePath = relative(bundleRoot, absolutePath).split('\\').join('/');
  const lower = relativePath.toLowerCase();
  if (!(lower.endsWith('.nib') || lower.includes('.storyboardc/') || lower.endsWith('.storyboard'))) {
    return null;
  }

  const bytes = await readFile(absolutePath);
  const archiveSha256 = createHash('sha256').update(bytes).digest('hex');
  const nib = parseNibArchiveHeader(bytes);
  if (nib !== null) {
    const document: InterfaceBuilderDocumentSummary = {
      relative_path: relativePath,
      archive_sha256: archiveSha256,
      document_kind: relativePath.includes('.storyboardc/') ? 'storyboard_scene' : 'nib',
      object_count: nib.objectCount,
      connection_count: 0,
      hierarchy_complete: false,
    };
    const prefix = `ib:${JSON.stringify(relativePath)}:`;
    const rootId = `${prefix}root`;
    return {
      document,
      nodes: [
        {
          id: rootId,
          kind: document.document_kind === 'nib' ? 'scene' : 'storyboard',
          name: relativePath,
          location: null,
          attributes: { document_kind: document.document_kind },
          evidence: [evidenceFor(relativePath, archiveSha256, 'compiled document')],
        },
      ],
      edges: [],
      coverage: [
        {
          facet: `objects:${relativePath}`,
          status: 'partial',
          reason: 'nibarchive_body_not_decoded',
          examined: 0,
          omitted: nib.objectCount,
        },
        {
          facet: `connections:${relativePath}`,
          status: 'unsupported',
          reason: 'nibarchive_body_not_decoded',
          examined: 0,
          omitted: 0,
        },
        {
          facet: `hierarchy:${relativePath}`,
          status: 'unsupported',
          reason: 'nibarchive_body_not_decoded',
          examined: 0,
          omitted: 0,
        },
        {
          facet: `classes:${relativePath}`,
          status: 'unsupported',
          reason: 'nibarchive_body_not_decoded',
          examined: 0,
          omitted: 0,
        },
      ],
    };
  }

  try {
    const { value } = decodePlist(bytes);
    const projected = projectKeyedArchive(relativePath, archiveSha256, value, maxObjects);
    if (projected === null) return null;
    return projected;
  } catch {
    return null;
  }
};

export const decodeInterfaceBuilderInBundle = async (
  bundlePath: string,
  options: {
    readonly maxDocuments?: number;
    readonly maxObjects?: number;
    readonly maxConnections?: number;
    readonly resourceRoot?: InterfaceBuilderResourceRoot;
  } = {},
): Promise<InterfaceBuilderInspection> => {
  if (typeof bundlePath !== 'string' || bundlePath.length === 0) {
    throw targetUnavailable('No app is open. Ask the user which app to investigate, then call open_binary with its local path.');
  }
  let root: string;
  try {
    root = await realpath(bundlePath);
  } catch (error) {
    throw invalidRequest(`Cannot decode interface builder documents: ${(error as Error).message}`, { parameter: 'path' });
  }
  const stats = await stat(root);
  if (!stats.isDirectory()) {
    throw invalidRequest('decode_interface_builder requires an open app bundle directory.', { parameter: 'path' });
  }

  const maxDocuments = options.maxDocuments ?? DEFAULT_MAX_DOCUMENTS;
  const maxObjects = options.maxObjects ?? DEFAULT_MAX_OBJECTS;
  void (options.maxConnections ?? DEFAULT_MAX_CONNECTIONS);

  const candidates = (await walkFiles(root))
    .filter((path) => {
      const lower = path.toLowerCase();
      return lower.endsWith('.nib') || lower.includes('.storyboardc/');
    })
    .toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0));
  const selected = candidates.slice(0, maxDocuments);

  const documents: InterfaceBuilderDocumentSummary[] = [];
  const nodes: InterfaceBuilderGraphNode[] = [];
  const edges: InterfaceBuilderGraphEdge[] = [];
  const coverage: InterfaceBuilderGraphCoverage[] = [];
  let attempted = 0;
  for (const path of selected) {
    attempted += 1;
    const decoded = await decodeDocument(path, root, maxObjects);
    if (decoded === null) continue;
    documents.push(decoded.document);
    nodes.push(...decoded.nodes);
    edges.push(...decoded.edges);
    coverage.push(...decoded.coverage);
  }

  coverage.push({
    facet: 'archive_decode',
    status: 'complete',
    reason: null,
    examined: attempted,
    omitted: Math.max(0, candidates.length - maxDocuments),
  });

  const resourceRoot =
    options.resourceRoot ??
    ({
      caller_path: bundlePath,
      canonical_path: root,
      info_plist_path: null,
      layout: 'contents',
      executable_sha256: null,
    } as const);

  return {
    target_sha256: null,
    resource_root: resourceRoot,
    documents,
    graph: {
      target_sha256: null,
      provider: {
        id: 'rea-artifact-graph',
        version: '1',
        tool_version: 'rea-interface-builder/1',
      },
      nodes,
      edges,
      coverage,
      truncated: candidates.length > maxDocuments,
    },
    limitations: [...GRAPH_LIMITATIONS],
  };
};

export const INTERFACE_BUILDER_ENVELOPE_LIMITATIONS = [
  'Artifact identity is unavailable for this observation.',
  ...GRAPH_LIMITATIONS,
  COMPILED_ARCHIVE_LIMITATION,
] as const;

export const INTERFACE_BUILDER_RESULT_LIMITATIONS = [...GRAPH_LIMITATIONS, COMPILED_ARCHIVE_LIMITATION] as const;
