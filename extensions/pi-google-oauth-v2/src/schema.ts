const JSON_SCHEMA_NAME_MAPS = new Set(['properties', 'patternProperties', '$defs', 'definitions', 'dependentSchemas', 'dependencies']);
const JSON_SCHEMA_SUBSCHEMAS = new Set([
  'additionalProperties',
  'unevaluatedProperties',
  'propertyNames',
  'items',
  'prefixItems',
  'additionalItems',
  'unevaluatedItems',
  'contains',
  'allOf',
  'anyOf',
  'oneOf',
  'not',
  'if',
  'then',
  'else',
  'contentSchema',
]);

/** Gemini ignores `const` inside parametersJsonSchema but honors a single-value `enum`. */
export function constToEnum(schema: unknown, isNameMap = false): unknown {
  if (Array.isArray(schema)) return schema.map((item) => constToEnum(item));
  if (typeof schema !== 'object' || schema === null) return schema;
  const rewritten: Record<string, unknown> = Object.fromEntries(
    Object.entries(schema).map(([key, value]) => {
      if (isNameMap || JSON_SCHEMA_SUBSCHEMAS.has(key)) return [key, constToEnum(value)];
      if (JSON_SCHEMA_NAME_MAPS.has(key)) return [key, constToEnum(value, true)];
      return [key, value];
    }),
  );
  const constant = rewritten['const'];
  if (!isNameMap && rewritten['enum'] === undefined && (typeof constant === 'string' || typeof constant === 'number')) {
    const { const: _, ...rest } = rewritten;
    return { ...rest, enum: [constant] };
  }
  return rewritten;
}
