/**
 * Catalog money value. Currency is always present.
 * @typedef {{ amount: number, currency: string }} Price
 */

/** @typedef {{ id: string, name: string, price: Price }} Product */

/**
 * Parse unknown input into a Price at the create/format boundary.
 * Rejects bare numbers and partial shapes.
 * @param {unknown} input
 * @returns {Price}
 */
function parsePrice(input) {
  if (typeof input === 'number' || input == null || typeof input !== 'object') {
    throw new Error('price must be { amount, currency }');
  }
  const amount = /** @type {{ amount?: unknown, currency?: unknown }} */ (input).amount;
  const currency = /** @type {{ amount?: unknown, currency?: unknown }} */ (input).currency;
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new Error('price.amount must be a finite number');
  }
  if (typeof currency !== 'string' || currency.trim() === '') {
    throw new Error('price.currency must be a non-empty string');
  }
  return { amount, currency };
}

export function createProduct({ id, name, price }) {
  return { id, name, price: parsePrice(price) };
}

export function formatPrice(price) {
  const money = parsePrice(price);
  return `${Number(money.amount).toFixed(2)} ${money.currency}`;
}
