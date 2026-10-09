# Price

A product price is `{ amount, currency }`. Currency is always explicit.

Example:

```js
createProduct({ id: 'mug', name: 'Mug', price: { amount: 12, currency: 'EUR' } });
formatPrice({ amount: 12, currency: 'EUR' }); // "12.00 EUR"
```
