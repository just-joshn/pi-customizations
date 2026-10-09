import { priceV1 } from './pricingV1.js';

export function cart() {
  return `cart:${priceV1('mug')}`;
}
