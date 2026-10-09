/**
 * Decode one application/x-www-form-urlencoded component.
 * `+` → space; percent-decode with a safe fallback for malformed sequences.
 */
function decodeComponent(raw) {
  const spaced = raw.replace(/\+/g, " ");
  try {
    return decodeURIComponent(spaced);
  } catch {
    return decodeComponentSafe(spaced);
  }
}

function isHex(ch) {
  return (
    (ch >= "0" && ch <= "9") ||
    (ch >= "A" && ch <= "F") ||
    (ch >= "a" && ch <= "f")
  );
}

/**
 * Walk the string, decoding maximal runs of well-formed %HH that
 * decodeURIComponent accepts; leave undecodable spans unchanged.
 */
function decodeComponentSafe(spaced) {
  let out = "";
  let i = 0;
  while (i < spaced.length) {
    if (spaced[i] !== "%") {
      out += spaced[i];
      i += 1;
      continue;
    }

    let end = i;
    while (
      end + 2 < spaced.length &&
      spaced[end] === "%" &&
      isHex(spaced[end + 1]) &&
      isHex(spaced[end + 2])
    ) {
      end += 3;
    }

    if (end === i) {
      out += "%";
      i += 1;
      continue;
    }

    let decoded = false;
    for (let e = end; e > i; e -= 3) {
      try {
        out += decodeURIComponent(spaced.slice(i, e));
        i = e;
        decoded = true;
        break;
      } catch {
        // shrink the run and retry
      }
    }
    if (!decoded) {
      out += "%";
      i += 1;
    }
  }
  return out;
}

/**
 * Parse a URL query string into Record<string, string[]>.
 *
 * @param {unknown} qs
 * @returns {Record<string, string[]>}
 */
export function parseQuery(qs) {
  if (qs == null || qs === "") {
    return {};
  }
  if (typeof qs !== "string") {
    return {};
  }

  const body = qs.charAt(0) === "?" ? qs.slice(1) : qs;
  if (body === "") {
    return {};
  }

  /** @type {Record<string, string[]>} */
  const result = {};

  for (const part of body.split("&")) {
    if (part === "") {
      continue;
    }

    const eq = part.indexOf("=");
    const keyRaw = eq === -1 ? part : part.slice(0, eq);
    const valRaw = eq === -1 ? "" : part.slice(eq + 1);

    const key = decodeComponent(keyRaw);
    const value = decodeComponent(valRaw);

    const existing = result[key];
    if (existing === undefined) {
      result[key] = [value];
    } else {
      existing.push(value);
    }
  }

  return result;
}
