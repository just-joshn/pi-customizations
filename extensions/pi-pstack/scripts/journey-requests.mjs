export function requestText(request) {
  return request.messages
    .map((message) => {
      const blocks = typeof message.content === 'string' ? [message.content] : (message.content ?? []).map((block) => block.text ?? '');
      return [...blocks, ...Object.values(message.sections ?? {})].join('\n');
    })
    .join('\n');
}

export function systemText(request) {
  const sections = new Map();
  for (const message of request.messages) {
    if (message.role !== 'system') continue;
    for (const [name, value] of Object.entries(message.sections ?? {})) {
      if (value === null) sections.delete(name);
      else sections.set(name, value);
    }
  }
  return [...sections].map(([name, value]) => `${name}=\n${value}`).join('\n\n');
}

/** The tool pool a request declares, replayed from the leading system message and every patch after it. */
export function toolNames(request) {
  const names = new Set();
  for (const message of request.messages) {
    if (message.role !== 'system') continue;
    if (message.replace) names.clear();
    for (const tool of message.toolsRemoved ?? []) names.delete(tool.name);
    for (const tool of message.toolsAdded ?? []) names.add(tool.name);
  }
  return [...names].sort();
}
