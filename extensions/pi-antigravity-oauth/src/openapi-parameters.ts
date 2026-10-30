function mergeEnum(existing: unknown, value: unknown): unknown[] {
  const base = Array.isArray(existing) ? existing : [];
  return base.includes(value) ? [...base] : [...base, value];
}

function collapsedLiteralUnion(anyOf: unknown): { type: string; enum: unknown[] } | undefined {
  if (!Array.isArray(anyOf) || anyOf.length === 0) return undefined;
  let type: string | undefined;
  const values: unknown[] = [];
  for (const branch of anyOf) {
    if (typeof branch !== 'object' || branch === null) return undefined;
    const record = branch as Record<string, unknown>;
    if (Object.keys(record).some((key) => key !== 'type' && key !== 'enum')) return undefined;
    if (typeof record['type'] !== 'string' || !Array.isArray(record['enum'])) return undefined;
    if (type !== undefined && record['type'] !== type) return undefined;
    type = record['type'];
    values.push(...record['enum']);
  }
  return type === undefined ? undefined : { type, enum: values };
}

export function sanitizeOpenApiParameters(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeOpenApiParameters);
  if (typeof schema !== 'object' || schema === null) return schema;

  const { const: constValue, uniqueItems: _uniqueItems, exclusiveMinimum: _exclusiveMinimum, exclusiveMaximum: _exclusiveMaximum, ...rest } = schema as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    next[key] = sanitizeOpenApiParameters(value);
  }
  const union = next['type'];
  if (Array.isArray(union) && union.every((name) => typeof name === 'string')) {
    const concrete = union.filter((name) => name !== 'null');
    delete next['type'];
    if (concrete.length < union.length) next['nullable'] = true;
    if (concrete.length === 1) next['type'] = concrete[0];
    else for (const key of ['items', 'properties', 'required', 'additionalProperties']) delete next[key];
  }
  if (constValue !== undefined) {
    next['enum'] = mergeEnum(next['enum'], constValue);
  }
  const collapsed = collapsedLiteralUnion(next['anyOf']);
  if (collapsed === undefined) return next;
  const { anyOf: _anyOf, ...node } = next;
  return { ...node, ...collapsed };
}

export function sanitizeConvertedTools(tools: unknown): unknown {
  return sanitizeOpenApiParameters(tools);
}
