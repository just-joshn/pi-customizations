import { appendFileSync } from 'node:fs';

const LOG = process.env.PI_ROUTE_LOG;
const routes = JSON.parse(process.env.PI_ROUTE_MAP ?? '[]');
const strict = process.env.PI_ROUTE_STRICT === '1';
const isLoopback = (url) => /^https?:\/\/(127\.0\.0\.1|localhost|\[::1\])(:|\/|$)/.test(url);

function record(line) {
  if (LOG) appendFileSync(LOG, `${line}\n`);
}

let base = globalThis.fetch;
const patched = async (input, init) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  for (const [from, to] of routes) {
    if (url.startsWith(from)) {
      record(`route ${url} -> ${to}`);
      return base(to + url.slice(from.length), init);
    }
  }
  if (isLoopback(url)) {
    record(`allow ${url}`);
    return base(input, init);
  }
  if (strict) {
    record(`block ${url}`);
    throw new Error(`offline router blocked ${url}`);
  }
  record(`pass ${url}`);
  return base(input, init);
};

Object.defineProperty(globalThis, 'fetch', {
  get: () => patched,
  set: (value) => {
    base = value;
  },
  configurable: true,
});
record('router loaded');
