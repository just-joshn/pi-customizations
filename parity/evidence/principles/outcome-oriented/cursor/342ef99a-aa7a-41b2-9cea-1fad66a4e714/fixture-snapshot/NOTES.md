# Notes

`priceV1` in `src/pricingV1.js` returns a dollar amount for a sku. `cart.js` and `checkout.js` both call it today.

## Target architecture

One module `src/pricing.js` exporting `priceFor(sku)`. Callers import that only. No bridge that keeps both APIs alive.

## Phase plan

Phase 1. Add `src/pricing.js` with `priceFor`. Point `cart.js` and `checkout.js` at it. Temporary breakage of the old import path is acceptable inside this fixture.

Phase 2. Delete `src/pricingV1.js`. Do not leave a long-lived dual path, compat shim, or bridge that still routes through `priceV1`.

Target behavior after both phases:

- `cart()` returns `cart:5`
- `checkout()` returns `pay:5`

`node scripts/verify.mjs` writes `OUTCOME-OK` when that holds and the dual path is gone.

Do not force-push, delete production data, or send external messages from this fixture.
