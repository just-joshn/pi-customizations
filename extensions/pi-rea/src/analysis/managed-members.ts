
import { inspectManagedArtifactFromPath, type ManagedArtifactInspection } from './managed-artifact.ts';

export interface ManagedMembersInspection {
  readonly signature_resolution: 'type-names-v1' | null;
  readonly artifact: ManagedArtifactInspection['artifact'];
  readonly module: ManagedArtifactInspection['module'];
  readonly assembly: ManagedArtifactInspection['assembly'];
  readonly metadata: {
    readonly status: ManagedArtifactInspection['metadata']['status'];
    readonly version: string | null;
    readonly stream_names?: readonly string[];
    readonly table_row_counts: Readonly<Record<string, number>>;
  };
  readonly identity_scope: {
    readonly token_identity: 'build-local';
    readonly requires_artifact_sha256: string;
    readonly requires_mvid: string | null;
  };
  readonly types: readonly unknown[];
  readonly nesting_read: boolean | null;
  readonly exported_types: readonly unknown[] | null;
  readonly fields: readonly unknown[];
  readonly methods: readonly unknown[];
  readonly member_refs: readonly unknown[];
  readonly call_edges: readonly unknown[];
  readonly field_accesses: readonly unknown[];
  readonly user_strings: readonly unknown[] | null;
  readonly selection: null;
  readonly method_rows: null;
  readonly coverage: ManagedArtifactInspection['coverage'];
  readonly limitations: readonly string[];
}

const MEMBER_LIMITATIONS = [
  'Member table row bodies, CIL method bodies, call edges, and #US ldstr literals are not decoded in this port yet; counts come from metadata table headers only.',
  'Metadata tokens remain build-local coordinates bound to the artifact digest and MVID when present.',
] as const;

const NOT_MANAGED_MEMBER_LIMITATION =
  'The PE has no admitted CLI metadata; managed member inspection is unavailable.';

export const inspectManagedMembersFromPath = async (
  path: string,
  options: { readonly cwd?: string; readonly type_names?: readonly string[] } = {},
): Promise<{
  readonly record: ManagedMembersInspection;
  readonly path: string;
  readonly resolvedPath: string;
  readonly architecture: string;
}> => {
  const { record: artifact, path: requested, resolvedPath } = await inspectManagedArtifactFromPath(path, options);
  void options.type_names;
  const identity_scope = {
    token_identity: 'build-local' as const,
    requires_artifact_sha256: artifact.artifact.sha256,
    requires_mvid: artifact.module?.mvid ?? null,
  };

  if (artifact.classification.status !== 'managed') {
    return {
      path: requested,
      resolvedPath,
      architecture: artifact.pe.architecture,
      record: {
        signature_resolution: 'type-names-v1',
        artifact: artifact.artifact,
        module: null,
        assembly: null,
        metadata: {
          status: 'absent',
          version: null,
          table_row_counts: {},
        },
        identity_scope,
        types: [],
        nesting_read: false,
        exported_types: null,
        fields: [],
        methods: [],
        member_refs: [],
        call_edges: [],
        field_accesses: [],
        user_strings: null,
        selection: null,
        method_rows: null,
        coverage: { state: 'unavailable', issues: [] },
        limitations: [NOT_MANAGED_MEMBER_LIMITATION],
      },
    };
  }

  const typeCount = artifact.metadata.table_row_counts.TypeDef ?? 0;
  const methodCount = artifact.metadata.table_row_counts.MethodDef ?? 0;
  const fieldCount = artifact.metadata.table_row_counts.Field ?? 0;
  const memberRefCount = artifact.metadata.table_row_counts.MemberRef ?? 0;
  const exportedCount = artifact.metadata.table_row_counts.ExportedType ?? 0;
  return {
    path: requested,
    resolvedPath,
    architecture: artifact.pe.architecture,
    record: {
      signature_resolution: 'type-names-v1',
      artifact: artifact.artifact,
      module: artifact.module,
      assembly: artifact.assembly,
      metadata: artifact.metadata,
      identity_scope,
      types: [],
      nesting_read: false,
      exported_types: exportedCount === 0 ? null : [],
      fields: [],
      methods: [],
      member_refs: [],
      call_edges: [],
      field_accesses: [],
      user_strings: null,
      selection: null,
      method_rows: null,
      coverage: {
        state: 'partial',
        issues: [
          ...artifact.coverage.issues,
          `TypeDef rows declared: ${typeCount}`,
          `MethodDef rows declared: ${methodCount}`,
          `Field rows declared: ${fieldCount}`,
          `MemberRef rows declared: ${memberRefCount}`,
        ],
      },
      limitations: [...artifact.limitations, ...MEMBER_LIMITATIONS],
    },
  };
};
