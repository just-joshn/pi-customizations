/** @typedef {{ id: string, name: string, price: number }} Product */

export function createProduct({ id, name, price }) {
  if (typeof price !== 'number' || !Number.isFinite(price)) {
    throw new Error('price must be a number');
  }
  return { id, name, price };
}

export function formatPrice(price) {
  return `$${Number(price).toFixed(2)}`;
}
