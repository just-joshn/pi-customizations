# Price

A product price is a bare number in USD. Currency is implied.

Example:

```js
createProduct({ id: 'mug', name: 'Mug', price: 12 });
formatPrice(12); // "$12.00"
```
