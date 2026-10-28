
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { isAbsolute, resolve } from 'node:path';

import { analysisInputInvalid, invalidRequest } from '../contract/errors.ts';

export const IL2CPP_LIMITATIONS = [
  'Static metadata reading only; binaries are never executed.',
  'This port inventories header section ranges and leaves image/type/method tables empty unless a future unit decodes them.',
  'generic_instances linking requires a matching binary_path and is not implemented yet.',
] as const;

const MAGIC = 0xfab11baf;
const SUPPORTED_VERSIONS = new Set([24, 27, 29, 31, 39]);

const SECTION_NAMES = [
  'stringLiteral',
  'stringLiteralData',
  'string',
  'events',
  'properties',
  'methods',
  'parameterDefaultValues',
  'fieldDefaultValues',
  'fieldAndParameterDefaultValueData',
  'fieldMarshaledSizes',
  'parameters',
  'fields',
  'genericParameters',
  'genericParameterConstraints',
  'genericContainers',
  'nestedTypes',
  'interfaces',
  'vtableMethods',
  'interfaceOffsets',
  'typeDefinitions',
  'images',
  'assemblies',
  'fieldRefs',
  'referencedAssemblies',
  'attributeData',
  'attributeDataRange',
  'unresolvedVirtualCallParameterTypes',
  'unresolvedVirtualCallParameterRanges',
  'windowsRuntimeTypeNames',
  'exportedTypeDefinitions',
] as const;

export interface Il2CppMetadataInspection {
  readonly artifact: { readonly path: string; readonly sha256: string; readonly bytes: number };
  readonly magic: number;
  readonly metadata_version: number;
  readonly index_widths: {
    readonly type_definition: number;
    readonly generic_container: number;
    readonly parameter: number;
    readonly type: number;
    readonly type_width_source: 'version_table';
  };
  readonly sections: readonly { readonly name: string; readonly offset: number; readonly bytes: number }[];
  readonly images: readonly unknown[];
  readonly types: readonly unknown[];
  readonly methods: readonly unknown[];
  readonly fields: readonly unknown[];
  readonly properties: readonly unknown[];
  readonly events: readonly unknown[];
  readonly parameters: readonly unknown[];
  readonly string_literals: readonly unknown[];
  readonly binary: null;
  readonly method_addresses: readonly unknown[];
  readonly return_types: readonly unknown[];
  readonly field_types: readonly unknown[];
  readonly parameter_types: readonly unknown[];
  readonly generic_method_instances: readonly unknown[];
  readonly limitations: readonly string[];
}

const inputError = (path: string, reason: string, detail: string) =>
  invalidRequest('The inspection input is not usable. Check the argument and retry.', {
    operation: 'inspect_il2cpp_metadata',
    issues: [{ path: ['path'], reason, message: `Cannot inspect ${path}: ${detail}` }],
  });

const sha256 = (bytes: Buffer): string => createHash('sha256').update(bytes).digest('hex');

const indexWidthsFor = (version: number): Il2CppMetadataInspection['index_widths'] => {
  void version;
  return {
    type_definition: 4,
    generic_container: 4,
    parameter: 4,
    type: 4,
    type_width_source: 'version_table',
  };
};

export interface Il2CppOptions {
  readonly binaryPath?: string;
  readonly binaryArchitecture?: string;
  readonly genericInstances?: boolean;
  readonly cwd?: string;
}

export const inspectIl2CppMetadataFromPath = async (
  path: string,
  options: Il2CppOptions = {},
): Promise<{ record: Il2CppMetadataInspection; path: string; resolvedPath: string }> => {
  if (options.genericInstances === true && options.binaryPath === undefined) {
    throw inputError(path, 'invalid_value', 'generic_instances requires binary_path.');
  }
  if (options.binaryArchitecture !== undefined && options.binaryPath === undefined) {
    throw inputError(path, 'invalid_value', 'binary_architecture requires binary_path.');
  }
  if (options.binaryPath !== undefined) {
    throw inputError(path, 'invalid_value', 'binary_path linking is not implemented in this port yet.');
  }

  const resolvedPath = isAbsolute(path) ? path : resolve(options.cwd ?? process.cwd(), path);
  let bytes: Buffer;
  try {
    bytes = await readFile(resolvedPath);
  } catch (error) {
    const reason = (error as NodeJS.ErrnoException).code === 'ENOENT' ? 'no file exists there' : `it could not be read (${(error as Error).message})`;
    throw inputError(path, 'invalid_value', reason);
  }
  if (bytes.length < 8) throw inputError(path, 'invalid_format', 'metadata header is truncated.');
  const magic = bytes.readUInt32LE(0);
  const version = bytes.readUInt32LE(4);
  if (magic !== MAGIC) throw inputError(path, 'invalid_format', 'IL2CPP metadata magic mismatch.');
  if (!SUPPORTED_VERSIONS.has(version)) throw inputError(path, 'invalid_format', `unsupported metadata_version ${version}.`);

  const headerBytesForVersion = (value: number): number => {
    if (value === 29 || value === 27 || value === 31) return 256;
    if (value === 24) return 264;
    return 8 + SECTION_NAMES.length * 8;
  };
  const headerBytes = headerBytesForVersion(version);
  if (bytes.length < Math.min(headerBytes, 8 + SECTION_NAMES.length * 8)) {
    throw inputError(path, 'invalid_format', 'metadata section table is truncated.');
  }

  const sectionPairCount = Math.floor((Math.min(bytes.length, headerBytes) - 8) / 8);
  const sections: Il2CppMetadataInspection['sections'][number][] = [];
  for (let index = 0; index < sectionPairCount; index += 1) {
    const at = 8 + index * 8;
    const offset = bytes.readUInt32LE(at);
    const size = bytes.readUInt32LE(at + 4);
    const name = SECTION_NAMES[index] ?? `section_${index}`;
    if (size > 0 && offset + size > bytes.length) {
      throw inputError(path, 'invalid_format', `section ${name} exceeds file size.`);
    }
    sections.push({ name, offset, bytes: size });
  }

  const first = sections[0];
  if (first !== undefined && first.offset !== headerBytes) {
    const digest = sha256(bytes);
    throw analysisInputInvalid(
      'inspect_il2cpp_metadata',
      [
        {
          path: ['path'],
          reason: 'invalid_format',
          message: `Selected artifact ${resolvedPath} is corrupt: unexpected-header-size: stringLiterals starts at ${String(first.offset)}, not immediately after the ${headerBytes}-byte header`,
        },
      ],
      {
        partial_observation: {
          evidence_id: `ev_${digest}`,
          subject: {
            name: resolvedPath.split('/').pop() ?? resolvedPath,
            digest: { sha256: digest },
            local_path: resolvedPath,
            format: 'file',
            architecture: null,
          },
          provider: { id: 'il2cpp-metadata', name: 'REA IL2CPP global-metadata reader', version: '1' },
          analysis_profile: null,
          predicate_type: 'rea.il2cpp-metadata-source',
          operation: 'observe_il2cpp_metadata_source',
          parameters: { path: resolvedPath },
          raw_result: null,
          normalized_result: {
            artifact: { path: resolvedPath, sha256: digest, bytes: bytes.length },
            inventory_status: 'not-returned-as-complete',
          },
          confidence: 'observed',
          authority: 'shipped-artifact',
          environment: null,
          limitations: [
            'This partial source observation does not contain a complete metadata inventory. Section row counts, when available, are derived from the validated header extents and record layout; names and relationships may remain unexamined.',
          ],
          relationship_coverage: null,
          locations: [
            { kind: 'artifact-path', path: resolvedPath },
            { kind: 'file-offset-range', start: 0, end: Math.min(bytes.length, headerBytes) },
          ],
          evidence_links: [],
        },
      },
    );
  }

  return {
    record: {
      artifact: { path, sha256: sha256(bytes), bytes: bytes.length },
      magic,
      metadata_version: version,
      index_widths: indexWidthsFor(version),
      sections,
      images: [],
      types: [],
      methods: [],
      fields: [],
      properties: [],
      events: [],
      parameters: [],
      string_literals: [],
      binary: null,
      method_addresses: [],
      return_types: [],
      field_types: [],
      parameter_types: [],
      generic_method_instances: [],
      limitations: [...IL2CPP_LIMITATIONS],
    },
    path,
    resolvedPath,
  };
};
