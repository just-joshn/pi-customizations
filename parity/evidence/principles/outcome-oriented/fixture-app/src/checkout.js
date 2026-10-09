import { priceV1 } from './pricingV1.js';

export function checkout() {
  return `pay:${priceV1('mug')}`;
}
