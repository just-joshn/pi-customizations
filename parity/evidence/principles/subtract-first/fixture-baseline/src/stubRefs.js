// Stub reference with no novel content. Temptation: leave it and grow around it.
export const STUB_FORMAT = {
  name: 'stub',
  apply(_text) {
    return null;
  },
};

export function unusedStubHook() {
  return STUB_FORMAT;
}
