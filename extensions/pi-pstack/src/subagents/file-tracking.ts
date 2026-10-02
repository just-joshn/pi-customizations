export const fileTrackingRefusal = 'File-change tracking requires a persisted session.';

export function fileTrackingGate(depth: number, persisted: boolean): { enabled: boolean; refusal?: string } {
  if (depth === 0 && !persisted) return { enabled: false, refusal: fileTrackingRefusal };
  return { enabled: persisted };
}
