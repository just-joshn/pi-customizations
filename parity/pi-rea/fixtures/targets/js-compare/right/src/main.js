export function shape(kind) {
  if (kind === 'a') return { x: 1, y: 2 };
  return { x: 1, z: 3, w: 4 };
}
export const plain = { a: 2 };
export const extra = 1;
