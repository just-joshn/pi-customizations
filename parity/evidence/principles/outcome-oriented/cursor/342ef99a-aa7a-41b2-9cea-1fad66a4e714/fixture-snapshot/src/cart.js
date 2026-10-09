import { priceFor } from './pricing.js';

export function cart() {
  return `cart:${priceFor('mug')}`;
}
