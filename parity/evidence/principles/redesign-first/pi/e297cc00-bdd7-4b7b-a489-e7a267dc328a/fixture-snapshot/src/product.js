/**
 * @typedef {{ amount: number, currency: string }} Price
 * @typedef {{ id: string, name: string, price: Price }} Product
 */

const CURRENCY_CODE = /^[A-Z]{3}$/;

export function createPrice({ amount, currency } = {}) {
  if (typeof amount !== 'number' || !Number.isFinite(amount)) {
    throw new Error('price.amount must be a finite number');
  }
  if (typeof currency !== 'string' || !CURRENCY_CODE.test(currency)) {
    throw new Error('price.currency must be an ISO 4217 code such as "USD"');
  }
  return { amount, currency };
}

export function createProduct({ id, name, price }) {
  if (price === null || typeof price !== 'object') {
    throw new Error('price must be { amount, currency }');
  }
  return { id, name, price: createPrice(price) };
}

export function formatPrice(price) {
  const { amount, currency } = createPrice(price);
  return `${amount.toFixed(2)} ${currency}`;
}
