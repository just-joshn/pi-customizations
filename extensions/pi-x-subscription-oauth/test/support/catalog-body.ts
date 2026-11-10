function effort(value: string) {
  return { id: value, value, label: value, description: `${value} effort`, default: value === 'high' };
}

function entry(id: string, name: string, efforts: readonly string[]) {
  return {
    id,
    object: 'model',
    owned_by: 'xai',
    model: id,
    model_family: 'xai',
    name,
    context_window: 256000,
    context_windows: [256000, 500000],
    auto_compact_threshold_percent: 80,
    api_backend: 'responses',
    reasoning_effort: 'high',
    supports_reasoning_effort: true,
    reasoning_efforts: efforts.map(effort),
  };
}

const ALL_EFFORTS = ['xhigh', 'high', 'medium', 'low'];

export function liveBody() {
  return {
    object: 'list',
    data: [entry('grok-4.7', 'Grok 4.7', ALL_EFFORTS), entry('grok-4.7-build-fast', 'Grok 4.7 Fast', ALL_EFFORTS), entry('grok-4.6', 'Grok 4.6', ALL_EFFORTS), entry('grok-4.5', 'Grok 4.5', ['high', 'medium', 'low'])],
  };
}

export function liveEntry(id: string, overrides: Record<string, unknown> = {}) {
  return { ...entry(id, id, ALL_EFFORTS), ...overrides };
}
