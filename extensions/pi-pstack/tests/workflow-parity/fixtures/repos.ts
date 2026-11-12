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

export const DEDUPE_JS = `export const counter = { comparisons: 0 };

export function dedupe(values) {
  const out = [];
  for (const value of values) {
    let seen = false;
    for (const existing of out) {
      counter.comparisons += 1;
      if (existing === value) {
        seen = true;
        break;
      }
    }
    if (!seen) out.push(value);
  }
  return out;
}
`;

export const BENCH_JS = `import { counter, dedupe } from '../src/dedupe.js';

const values = Array.from({ length: 400 }, (_, index) => (index * 7) % 200);
const result = dedupe(values);
const errors = result.length === 200 ? 0 : 1;
console.log(\`errors=\${errors} work=\${values.length} comparisons=\${counter.comparisons}\`);
process.exit(errors);
`;

export const DEDUPE_TEST_JS = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { dedupe } from '../src/dedupe.js';

test('keeps the first of each value in order', () => {
  assert.deepEqual(dedupe([3, 1, 3, 2, 1]), [3, 1, 2]);
});
`;

export const SET_DEDUPE_JS = `export const counter = { comparisons: 0 };

export function dedupe(values) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    counter.comparisons += 1;
    if (seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}
`;

/** The cart repository plus a quadratic dedupe and its frozen benchmark, for the measured families. */
export const perfHistory: Commit[] = [
  ...cartHistory,
  { message: 'feat: dedupe helper and its benchmark (#150)', files: { 'src/dedupe.js': DEDUPE_JS, 'bench/bench.js': BENCH_JS, 'test/dedupe.test.js': DEDUPE_TEST_JS } },
];

/** The comparisons the quadratic dedupe counts on the benchmark input, worked out here so a scenario can state them. */
export function quadraticComparisons(): number {
  const out: number[] = [];
  let comparisons = 0;
  for (let index = 0; index < 400; index += 1) {
    const value = (index * 7) % 200;
    let seen = false;
    for (const existing of out) {
      comparisons += 1;
      if (existing === value) {
        seen = true;
        break;
      }
    }
    if (!seen) out.push(value);
  }
  return comparisons;
}

export const COUPON_JS = `export function clampPercent(percent) {
  return Math.min(100, Math.max(0, Number.isNaN(percent) ? 0 : percent));
}
`;
export const COUPON_TEST_JS = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { clampPercent } from '../src/coupon.js';

test('keeps a valid percent', () => assert.equal(clampPercent(15), 15));
`;
export const FIXED_CART_JS = CART_JS.replace('export function applyCoupon(amount, percent) {\n  return roundCents(amount - (amount * percent) / 100);', 'export function applyCoupon(amount, percent) {\n  const bounded = Math.min(100, Math.max(0, percent));\n  return roundCents(amount - (amount * bounded) / 100);');

/** The cart repository with the coupon fix as its newest commit: the claim "the fix works" has a baseline and a treatment. */
export const fixedHistory: Commit[] = [...cartHistory, { message: 'fix: bound the coupon percent (#141)', files: { 'src/cart.js': FIXED_CART_JS } }];

/** The cart repository with a correct clampPercent, a test, and a CLI a verification skill can drive. */
export const couponHistory: Commit[] = [
  ...cartHistory,
  { message: 'feat: clampPercent keeps coupons in 0..100 (#142)', files: { 'src/coupon.js': COUPON_JS, 'test/coupon.test.js': COUPON_TEST_JS } },
  { message: 'feat: cart CLI prints a total (#143)', files: { 'bin/cart.js': `import { total } from '../src/cart.js';\nconst [price = '0', qty = '1', percent = '0'] = process.argv.slice(2);\nconsole.log('total=' + total([{ price: Number(price), qty: Number(qty) }], Number(percent)));\n` } },
];
