# catalog price fixture

Tiny product catalog. Prices are bare numbers (USD implied).

`createProduct({ id, name, price })` and `formatPrice(price)` live in `src/product.js`.

Run `node scripts/verify.mjs`. It writes `evidence/verify-out.txt`.
