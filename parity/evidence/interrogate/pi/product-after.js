// Contested review target for /interrogate no-autoapply capture.
// Intentional defects: null-unsafe price access, mutates the input array.
export function total(items) {
  let sum = 0;
  for (const item of items) {
    sum += item.price;
  }
  items.push({ price: 0 });
  return sum;
}
