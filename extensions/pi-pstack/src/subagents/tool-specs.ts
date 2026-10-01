function tokenize(value: string): string[] {
  let depth = 0;
  const separated = Array.from(value, (character) => {
    if (character === '(') depth += 1;
    if (character === ')') depth -= 1;
    if (depth < 0) throw new Error('Unbalanced tool specification.');
    return depth === 0 && /[\s,]/.test(character) ? '\0' : character;
  }).join('');
  if (depth !== 0) throw new Error('Unbalanced tool specification.');
  return separated
    .split('\0')
    .map((token) => token.trim())
    .filter(Boolean);
}

export function toolList(value: unknown): string[] | undefined {
  if (typeof value === 'string') return tokenize(value);
  if (!Array.isArray(value)) return undefined;
  return value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => {
      tokenize(item);
      return item.trim();
    });
}

export function agentTypeScope(tools: readonly string[] | undefined): readonly string[] | undefined {
  if (!tools || tools.includes('*') || tools.some((tool) => tool.trim().toLowerCase() === 'agent')) return undefined;
  const scoped = tools.filter((tool) => /^agent\(/i.test(tool.trim()));
  if (scoped.length === 0) return undefined;
  return [
    ...new Set(
      scoped.flatMap((tool) =>
        tool
          .slice(tool.indexOf('(') + 1, tool.lastIndexOf(')'))
          .split(',')
          .map((name) => name.trim())
          .filter(Boolean),
      ),
    ),
  ];
}

export function hasUnsupportedToolScope(value: string): boolean {
  return hasToolScope(value) && !/^agent\([^()]*\)$/i.test(value.trim());
}

export function hasToolScope(value: string): boolean {
  return value.includes('(') || value.includes(')');
}
