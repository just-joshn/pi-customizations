# Price

A price is `{ amount, currency }`. `amount` is a finite number and `currency` is an ISO 4217 code such as `USD` or `EUR`. Every product carries one, and nothing defaults the currency.

Example:

```js
createProduct({ id: 'mug', name: 'Mug', price: { amount: 12, currency: 'EUR' } });
formatPrice({ amount: 12, currency: 'EUR' }); // "12.00 EUR"
```
