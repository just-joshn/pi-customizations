import { priceFor } from './pricing.js';

export function checkout() {
  return `pay:${priceFor('mug')}`;
}
