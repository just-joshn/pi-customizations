# catalog price fixture

Tiny product catalog. A price is `{ amount, currency }`, and the currency is always explicit.

`createProduct({ id, name, price })` and `formatPrice(price)` live in `src/product.js`.

```js
createProduct({ id: 'mug', name: 'Mug', price: { amount: 12, currency: 'EUR' } });
```

Run `node scripts/verify.mjs`. It writes `evidence/verify-out.txt`.
