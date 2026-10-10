function mergeEnum(existing: unknown, value: unknown): unknown[] {
  const base = Array.isArray(existing) ? existing : [];
  return base.includes(value) ? [...base] : [...base, value];
}

export function sanitizeOpenApiParameters(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeOpenApiParameters);
  if (typeof schema !== 'object' || schema === null) return schema;

  const { const: constValue, uniqueItems: _uniqueItems, ...rest } = schema as Record<string, unknown>;
  const next: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(rest)) {
    next[key] = sanitizeOpenApiParameters(value);
  }
  if (constValue !== undefined) {
    next['enum'] = mergeEnum(next['enum'], constValue);
  }
  return next;
}

export function sanitizeConvertedTools(tools: unknown): unknown {
  return sanitizeOpenApiParameters(tools);
}
