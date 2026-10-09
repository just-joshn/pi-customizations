const PERCENT_RUN = /(?:%[0-9A-Fa-f]{2})+/g;

// Decode a run of %XX escapes piecewise so one invalid sequence
// does not leave neighbouring valid sequences encoded.
function decodeRun(run) {
  let out = '';
  let i = 0;
  while (i < run.length) {
    let decoded = null;
    for (let n = 1; n <= 4 && i + n * 3 <= run.length; n++) {
      try {
        decoded = [decodeURIComponent(run.slice(i, i + n * 3)), n];
        break;
      } catch {
        // try a longer sequence
      }
    }
    if (decoded) {
      out += decoded[0];
      i += decoded[1] * 3;
    } else {
      out += run.slice(i, i + 3);
      i += 3;
    }
  }
  return out;
}

function decode(text) {
  return text.replace(/\+/g, ' ').replace(PERCENT_RUN, decodeRun);
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
