import { digestOf } from './canonical.mjs';
import { invalidRequest } from '../contract/errors.ts';
import type { EvidenceRecord } from '../session/evidence.ts';

export interface ExportShapeCompareInspection {
  readonly comparison_id: string;
  readonly left: SideSelection;
  readonly right: SideSelection;
  readonly property_inventories: readonly PropertyInventory[];
  readonly summary: { readonly added: number; readonly removed: number; readonly changed: number; readonly unknown: number };
  readonly changes: readonly ShapeChange[];
  readonly coverage: {
    readonly status: 'complete-within-inputs';
    readonly left_graph_status: 'complete';
    readonly right_graph_status: 'complete';
    readonly paired_variants: number;
    readonly unpaired_left_variants: number;
    readonly unpaired_right_variants: number;
    readonly omitted_left_variants: number;
    readonly omitted_right_variants: number;
    readonly left_source_omitted_variants: number;
    readonly right_source_omitted_variants: number;
    readonly left_omitted_fields: number;
    readonly right_omitted_fields: number;
    readonly left_omitted_property_coverage: number;
    readonly right_omitted_property_coverage: number;
    readonly omitted_candidates: number;
    readonly omitted_changes: number;
  };
  readonly limitations: readonly string[];
  readonly evidence_links: readonly string[];
}

interface SideSelection {
  readonly evidence_id: string;
  readonly graph_id: string;
  readonly requested_module_path: string;
  readonly requested_export_name: string;
  readonly candidates: readonly Candidate[];
  readonly omitted_candidates: number;
  readonly status: 'selected' | 'not_found' | 'ambiguous';
  readonly selected_node_id?: string;
}

interface Candidate {
  readonly node_id: string;
  readonly module_path: string;
  readonly export_name: string;
  readonly matches_requested_module: boolean;
  readonly matches_requested_export: boolean;
}

interface PropertyInventory {
  readonly side: 'left' | 'right';
  readonly variant_index: number;
  readonly discriminant: { readonly path: string; readonly value: unknown } | null;
  readonly paired: boolean;
  readonly source_range: unknown;
  readonly properties: readonly string[];
  readonly property_coverage: readonly { readonly path: string; readonly status: string }[];
}

interface ShapeChange {
  readonly change_id: string;
  readonly status: 'added' | 'removed' | 'changed' | 'unknown';
  readonly path: string;
  readonly discriminant: { readonly path: string; readonly value: unknown } | null;
  readonly presence: { readonly left: string; readonly right: string };
  readonly left: Record<string, unknown>;
  readonly right: Record<string, unknown>;
  readonly left_source_range: unknown;
  readonly right_source_range: unknown;
  readonly evidence_links: readonly string[];
  readonly limitations: readonly string[];
}

interface ReturnShape {
  readonly source_range: unknown;
  readonly fields: readonly { readonly path: string; readonly presence: string; readonly state: string; readonly value: unknown }[];
  readonly property_coverage: readonly { readonly path: string; readonly status: string }[];
}

export const EXPORT_SHAPE_RESULT_LIMITATIONS = [
  'Dynamic values, incomplete object coverage, and ambiguous variants remain unknown.',
  'Return shapes are inferred from inert syntax and do not prove runtime behavior.',
  'Return variants are paired only by unique exact literal discriminants, never by source order.',
  'This static comparison cannot establish runtime semantics; run behavioral probes directly against the relevant application versions when that evidence is required.',
] as const;

export const EXPORT_SHAPE_ENVELOPE_LIMITATIONS = [
  'Artifact identity is unavailable for this observation.',
  ...EXPORT_SHAPE_RESULT_LIMITATIONS,
] as const;

const asJsEvidence = (value: unknown, label: string): EvidenceRecord => {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw invalidRequest(`compare_javascript_export_shapes ${label} must be an Evidence object.`, {
      operation: 'compare_javascript_export_shapes',
      parameter: label,
    });
  }
  const record = value as EvidenceRecord;
  if (typeof record.evidence_id !== 'string' || !record.evidence_id.startsWith('ev_')) {
    throw invalidRequest(`compare_javascript_export_shapes ${label} must carry an evidence_id.`, {
      operation: 'compare_javascript_export_shapes',
      parameter: label,
    });
  }
  if (record.operation !== 'analyze_javascript_application') {
    throw invalidRequest(`compare_javascript_export_shapes ${label} must be analyze_javascript_application Evidence.`, {
      operation: 'compare_javascript_export_shapes',
      parameter: label,
      observed_operation: record.operation,
    });
  }
  return record;
};

const graphOf = (record: EvidenceRecord): { graph_id: string; nodes: readonly Record<string, unknown>[] } => {
  const nr = record.normalized_result as Record<string, unknown> | null;
  const graph = (nr?.['graph'] as Record<string, unknown> | undefined) ?? nr;
  if (graph === null || typeof graph !== 'object') {
    throw invalidRequest('compare_javascript_export_shapes Evidence has no application graph.', {
      operation: 'compare_javascript_export_shapes',
      evidence_id: record.evidence_id,
    });
  }
  const nodes = Array.isArray(graph['nodes']) ? (graph['nodes'] as Record<string, unknown>[]) : [];
  const graphId = typeof graph['graph_id'] === 'string' ? graph['graph_id'] : `jag_${digestOf(record.evidence_id)}`;
  return { graph_id: graphId, nodes };
};

const exportMeta = (node: Record<string, unknown>): { module_path: string; export_name: string; shapes: readonly ReturnShape[] } | null => {
  const observations = Array.isArray(node['observations']) ? (node['observations'] as Record<string, unknown>[]) : [];
  let modulePath: string | null = null;
  let exportName: string | null = null;
  let shapes: readonly ReturnShape[] = [];
  for (const observation of observations) {
    const properties = (observation['properties'] as Record<string, unknown> | undefined) ?? {};
    if (properties['semantic_role'] === 'export-binding' || properties['semantic_role'] === 'export-return-shapes') {
      if (typeof properties['module_path'] === 'string') modulePath = properties['module_path'];
      if (typeof properties['exported_name'] === 'string') exportName = properties['exported_name'];
    }
    if (properties['semantic_role'] === 'export-return-shapes' && Array.isArray(properties['static_return_shapes'])) {
      shapes = properties['static_return_shapes'] as ReturnShape[];
    }
  }
  if (modulePath === null || exportName === null) return null;
  return { module_path: modulePath, export_name: exportName, shapes };
};

const selectSide = (record: EvidenceRecord, modulePath: string, exportName: string): { selection: SideSelection; shapes: readonly ReturnShape[] } => {
  const { graph_id, nodes } = graphOf(record);
  const candidates: Candidate[] = [];
  for (const node of nodes) {
    const meta = exportMeta(node);
    if (meta === null) continue;
    const matchesModule = meta.module_path === modulePath;
    const matchesExport = meta.export_name === exportName;
    if (!matchesModule && !matchesExport) continue;
    candidates.push({
      node_id: String(node['node_id'] ?? ''),
      module_path: meta.module_path,
      export_name: meta.export_name,
      matches_requested_module: matchesModule,
      matches_requested_export: matchesExport,
    });
  }
  const exact = candidates.filter((row) => row.matches_requested_module && row.matches_requested_export);
  if (exact.length === 1) {
    const selected = nodes.find((node) => node['node_id'] === exact[0]!.node_id);
    const shapes = selected === undefined ? [] : (exportMeta(selected)?.shapes ?? []);
    return {
      selection: {
        evidence_id: record.evidence_id,
        graph_id,
        requested_module_path: modulePath,
        requested_export_name: exportName,
        candidates: exact,
        omitted_candidates: 0,
        status: 'selected',
        selected_node_id: exact[0]!.node_id,
      },
      shapes,
    };
  }
  return {
    selection: {
      evidence_id: record.evidence_id,
      graph_id,
      requested_module_path: modulePath,
      requested_export_name: exportName,
      candidates,
      omitted_candidates: 0,
      status: exact.length === 0 ? 'not_found' : 'ambiguous',
    },
    shapes: [],
  };
};

const discriminantKey = (path: string, value: unknown): string => `${path}:${JSON.stringify(value)}`;

const exclusiveLiterals = (shape: ReturnShape, siblings: readonly ReturnShape[]): { path: string; value: unknown; key: string }[] => {
  const counts = new Map<string, number>();
  for (const sibling of siblings) {
    for (const field of sibling.fields) {
      if (field.state !== 'literal' || field.presence !== 'present') continue;
      const key = discriminantKey(field.path, field.value);
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }
  return shape.fields
    .filter((field) => field.state === 'literal' && field.presence === 'present')
    .map((field) => ({ path: field.path, value: field.value, key: discriminantKey(field.path, field.value) }))
    .filter((field) => counts.get(field.key) === 1)
    .sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0));
};

const fieldMap = (shape: ReturnShape): Map<string, (typeof shape.fields)[number]> =>
  new Map(shape.fields.map((field) => [field.path, field]));

export const compareJavascriptExportShapes = (params: {
  readonly left: unknown;
  readonly right: unknown;
  readonly left_module_path: string;
  readonly left_export_name: string;
  readonly right_module_path: string;
  readonly right_export_name: string;
}): ExportShapeCompareInspection => {
  const left = asJsEvidence(params.left, 'left');
  const right = asJsEvidence(params.right, 'right');
  if (left.evidence_id === right.evidence_id) {
    throw invalidRequest('JavaScript export shape Evidence must be distinct', {
      operation: 'compare_javascript_export_shapes',
      parameter: 'right',
    });
  }
  for (const [label, value] of [
    ['left_module_path', params.left_module_path],
    ['left_export_name', params.left_export_name],
    ['right_module_path', params.right_module_path],
    ['right_export_name', params.right_export_name],
  ] as const) {
    if (typeof value !== 'string' || value.length === 0) {
      throw invalidRequest(`compare_javascript_export_shapes requires ${label}.`, {
        operation: 'compare_javascript_export_shapes',
        parameter: label,
      });
    }
  }

  const leftSide = selectSide(left, params.left_module_path, params.left_export_name);
  const rightSide = selectSide(right, params.right_module_path, params.right_export_name);

  const leftInventories: (PropertyInventory | undefined)[] = Array.from({ length: leftSide.shapes.length });
  const rightInventories: (PropertyInventory | undefined)[] = Array.from({ length: rightSide.shapes.length });
  const changes: ShapeChange[] = [];
  let added = 0;
  let removed = 0;
  let changed = 0;
  let unknown = 0;
  const evidenceLinks = [left.evidence_id, right.evidence_id] as const;

  const leftExclusive = leftSide.shapes.map((shape) => exclusiveLiterals(shape, leftSide.shapes));
  const rightExclusive = rightSide.shapes.map((shape) => exclusiveLiterals(shape, rightSide.shapes));
  const rightByKey = new Map<string, number>();
  rightExclusive.forEach((fields, index) => {
    for (const field of fields) {
      if (!rightByKey.has(field.key)) rightByKey.set(field.key, index);
    }
  });

  const pairedLeft = new Set<number>();
  const pairedRight = new Set<number>();
  const pairs: { leftIndex: number; rightIndex: number; discriminant: { path: string; value: unknown } }[] = [];

  leftExclusive.forEach((fields, leftIndex) => {
    for (const field of fields) {
      const rightIndex = rightByKey.get(field.key);
      if (rightIndex === undefined) continue;
      if (pairedLeft.has(leftIndex) || pairedRight.has(rightIndex)) continue;
      const rightHas = rightExclusive[rightIndex]?.some((candidate) => candidate.key === field.key) === true;
      if (!rightHas) continue;
      pairedLeft.add(leftIndex);
      pairedRight.add(rightIndex);
      pairs.push({ leftIndex, rightIndex, discriminant: { path: field.path, value: field.value } });
      break;
    }
  });

  const inventoryFor = (
    side: 'left' | 'right',
    index: number,
    shape: ReturnShape,
    discriminant: { path: string; value: unknown } | null,
    paired: boolean,
  ): PropertyInventory => ({
    side,
    variant_index: index,
    discriminant,
    paired,
    source_range: shape.source_range,
    properties: shape.fields.map((field) => field.path).sort(),
    property_coverage: shape.property_coverage.map((row) => ({ path: row.path, status: row.status })),
  });

  const pushChange = (change: Omit<ShapeChange, 'evidence_links' | 'limitations'>) => {
    changes.push({ ...change, evidence_links: [...evidenceLinks], limitations: [] });
  };

  for (const pair of pairs) {
    const leftShape = leftSide.shapes[pair.leftIndex]!;
    const rightShape = rightSide.shapes[pair.rightIndex]!;
    leftInventories[pair.leftIndex] = inventoryFor('left', pair.leftIndex, leftShape, pair.discriminant, true);
    rightInventories[pair.rightIndex] = inventoryFor('right', pair.rightIndex, rightShape, pair.discriminant, true);
    const leftFields = fieldMap(leftShape);
    const rightFields = fieldMap(rightShape);
    const paths = new Set([...leftFields.keys(), ...rightFields.keys()]);
    for (const path of [...paths].sort()) {
      const leftField = leftFields.get(path);
      const rightField = rightFields.get(path);
      const key = discriminantKey(pair.discriminant.path, pair.discriminant.value);
      if (leftField !== undefined && rightField === undefined) {
        removed += 1;
        pushChange({
          change_id: `jesc_change_${digestOf(`removed:${key}:${path}`)}`,
          status: 'removed',
          path,
          discriminant: pair.discriminant,
          presence: { left: 'present', right: 'absent' },
          left: { availability: leftField.state, value: leftField.value },
          right: { availability: 'absent' },
          left_source_range: leftShape.source_range,
          right_source_range: rightShape.source_range,
        });
      } else if (leftField === undefined && rightField !== undefined) {
        added += 1;
        pushChange({
          change_id: `jesc_change_${digestOf(`added:${key}:${path}`)}`,
          status: 'added',
          path,
          discriminant: pair.discriminant,
          presence: { left: 'absent', right: 'present' },
          left: { availability: 'absent' },
          right: { availability: rightField.state, value: rightField.value },
          left_source_range: leftShape.source_range,
          right_source_range: rightShape.source_range,
        });
      } else if (leftField !== undefined && rightField !== undefined && JSON.stringify(leftField.value) !== JSON.stringify(rightField.value)) {
        if (leftField.state !== 'literal' || rightField.state !== 'literal') {
          unknown += 1;
          pushChange({
            change_id: `jesc_change_${digestOf(`unknown:${key}:${path}`)}`,
            status: 'unknown',
            path,
            discriminant: pair.discriminant,
            presence: { left: 'present', right: 'present' },
            left: { availability: leftField.state, value: leftField.value },
            right: { availability: rightField.state, value: rightField.value },
            left_source_range: leftShape.source_range,
            right_source_range: rightShape.source_range,
          });
        } else {
          changed += 1;
          pushChange({
            change_id: `jesc_change_${digestOf(`changed:${key}:${path}`)}`,
            status: 'changed',
            path,
            discriminant: pair.discriminant,
            presence: { left: 'present', right: 'present' },
            left: { availability: 'literal', value: leftField.value },
            right: { availability: 'literal', value: rightField.value },
            left_source_range: leftShape.source_range,
            right_source_range: rightShape.source_range,
          });
        }
      }
    }
  }

  leftSide.shapes.forEach((shape, index) => {
    if (pairedLeft.has(index)) return;
    unknown += 1;
    const discriminant = exclusiveLiterals(shape, leftSide.shapes)[0] ?? null;
    leftInventories[index] = inventoryFor(
      'left',
      index,
      shape,
      discriminant === null ? null : { path: discriminant.path, value: discriminant.value },
      false,
    );
  });
  rightSide.shapes.forEach((shape, index) => {
    if (pairedRight.has(index)) return;
    unknown += 1;
    const discriminant = exclusiveLiterals(shape, rightSide.shapes)[0] ?? null;
    rightInventories[index] = inventoryFor(
      'right',
      index,
      shape,
      discriminant === null ? null : { path: discriminant.path, value: discriminant.value },
      false,
    );
  });

  if (leftSide.selection.status !== 'selected' || rightSide.selection.status !== 'selected') {
    unknown += 1;
  }

  const inventories = [
    ...leftInventories.filter((row): row is PropertyInventory => row !== undefined),
    ...rightInventories.filter((row): row is PropertyInventory => row !== undefined),
  ];

  return {
    comparison_id: `jesc_${digestOf(`${left.evidence_id}:${right.evidence_id}:${params.left_module_path}:${params.left_export_name}:${params.right_module_path}:${params.right_export_name}`)}`,
    left: leftSide.selection,
    right: rightSide.selection,
    property_inventories: inventories,
    summary: { added, removed, changed, unknown },
    changes,
    coverage: {
      status: 'complete-within-inputs',
      left_graph_status: 'complete',
      right_graph_status: 'complete',
      paired_variants: pairs.length,
      unpaired_left_variants: leftSide.shapes.length - pairedLeft.size,
      unpaired_right_variants: rightSide.shapes.length - pairedRight.size,
      omitted_left_variants: 0,
      omitted_right_variants: 0,
      left_source_omitted_variants: 0,
      right_source_omitted_variants: 0,
      left_omitted_fields: 0,
      right_omitted_fields: 0,
      left_omitted_property_coverage: 0,
      right_omitted_property_coverage: 0,
      omitted_candidates: leftSide.selection.omitted_candidates + rightSide.selection.omitted_candidates,
      omitted_changes: 0,
    },
    limitations: [...EXPORT_SHAPE_RESULT_LIMITATIONS],
    evidence_links: [...evidenceLinks],
  };
};
