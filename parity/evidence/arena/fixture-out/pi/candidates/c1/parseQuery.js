const PERCENT_RUN = /(?:%[0-9A-Fa-f]{2})+/g;

function decode(text) {
  return text.replace(/\+/g, ' ').replace(PERCENT_RUN, (run) => {
    try {
      return decodeURIComponent(run);
    } catch {
      return run;
    }
  });
}

function toEntry(pair) {
  const i = pair.indexOf('=');
  return i === -1
    ? [decode(pair), '']
    : [decode(pair.slice(0, i)), decode(pair.slice(i + 1))];
}

export function parseQuery(qs) {
  if (typeof qs !== 'string' || qs === '') return Object.create(null);
  const body = qs.startsWith('?') ? qs.slice(1) : qs;
  return body
    .split('&')
    .filter((pair) => pair !== '')
    .map(toEntry)
    .reduce((acc, [key, value]) => {
      (acc[key] ??= []).push(value);
      return acc;
    }, Object.create(null));
}
