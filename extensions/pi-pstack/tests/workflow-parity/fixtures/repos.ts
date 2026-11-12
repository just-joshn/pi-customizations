// Controlled repositories for the workflow checks. Small enough to read, real enough to run with `node --test`.
import type { Commit } from '../lib/driver.ts';

const PACKAGE_JSON = `${JSON.stringify({ name: 'cart', private: true, type: 'module', scripts: { test: 'node --test' } }, null, 2)}\n`;

export const MONEY_JS = `export function roundCents(value) {
  return Math.round(value * 100) / 100;
}

export function formatMoney(value) {
  return \`$\${roundCents(value).toFixed(2)}\`;
}
`;

export const CART_JS = `import { roundCents } from './money.js';

export function lineTotal(item) {
  return roundCents(item.price * item.qty);
}

export function subtotal(items) {
  return items.reduce((sum, item) => sum + lineTotal(item), 0);
}

export function applyCoupon(amount, percent) {
  return roundCents(amount - (amount * percent) / 100);
}

export function total(items, couponPercent = 0) {
  return applyCoupon(subtotal(items), couponPercent);
}
`;

export const CHECKOUT_JS = `import { total } from './cart.js';
import { formatMoney } from './money.js';

export function checkout(items, couponPercent = 0) {
  const amount = total(items, couponPercent);
  return { amount, label: formatMoney(amount) };
}
`;

export const CART_TEST_JS = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { total } from '../src/cart.js';
import { checkout } from '../src/checkout.js';

const items = [
  { price: 2.5, qty: 2 },
  { price: 1.25, qty: 4 },
];

test('totals the lines', () => {
  assert.equal(total(items), 10);
});

test('takes a percent off', () => {
  assert.equal(total(items, 10), 9);
});

test('checkout formats the amount', () => {
  assert.deepEqual(checkout(items, 10), { amount: 9, label: '$9.00' });
});
`;

/** The cart repository: four commits with PR numbers in their subjects, passing characterization tests, and one latent bug (a coupon over 100 percent pays the customer). */
export const cartHistory: Commit[] = [
  { message: 'feat: cart subtotal (#101)', files: { 'package.json': PACKAGE_JSON, 'README.md': '# cart\n\nTotals a shopping cart.\n', 'src/cart.js': 'export function subtotal(items) {\n  return items.reduce((sum, item) => sum + item.price * item.qty, 0);\n}\n' } },
  { message: 'feat: coupon percent off (#118)', files: { 'src/cart.js': 'export function subtotal(items) {\n  return items.reduce((sum, item) => sum + item.price * item.qty, 0);\n}\n\nexport function total(items, couponPercent = 0) {\n  const amount = subtotal(items);\n  return amount - (amount * couponPercent) / 100;\n}\n' } },
  { message: 'fix: round totals to cents (#124)', files: { 'src/cart.js': 'const round = (value) => Math.round(value * 100) / 100;\n\nexport function subtotal(items) {\n  return items.reduce((sum, item) => sum + round(item.price * item.qty), 0);\n}\n\nexport function total(items, couponPercent = 0) {\n  const amount = subtotal(items);\n  return round(amount - (amount * couponPercent) / 100);\n}\n' } },
  { message: 'refactor: split money helpers and add checkout (#130)', files: { 'src/money.js': MONEY_JS, 'src/cart.js': CART_JS, 'src/checkout.js': CHECKOUT_JS, 'test/cart.test.js': CART_TEST_JS } },
];

/** The final content of a path across a history, for computing real line numbers. */
export function finalFile(history: Commit[], path: string): string {
  const content = history.map((commit) => commit.files[path]).filter((value): value is string => typeof value === 'string').at(-1);
  if (content === undefined) throw new Error(`${path} is not in the fixture history`);
  return content;
}

/** 1-based line of the first line containing `needle`. */
export function lineOf(history: Commit[], path: string, needle: string): number {
  const index = finalFile(history, path).split('\n').findIndex((line) => line.includes(needle));
  if (index === -1) throw new Error(`${needle} is not in ${path}`);
  return index + 1;
}
