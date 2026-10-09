/**
 * Decode one application/x-www-form-urlencoded component.
 * `+` → space; percent-decode with a safe fallback for malformed sequences.
 */
function decodeFormComponent(raw) {
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

/** Strip a leading `?`; nullish / empty / non-string → empty body. */
function normalizeQueryString(qs) {
  if (qs == null || qs === "") return "";
  if (typeof qs !== "string") return "";
  return qs.startsWith("?") ? qs.slice(1) : qs;
}

/** Split one `key` or `key=value` segment. Missing `=` ⇒ empty string value. */
function splitPair(segment) {
  const eq = segment.indexOf("=");
  if (eq === -1) {
    return { rawKey: segment, rawValue: "" };
  }
  return {
    rawKey: segment.slice(0, eq),
    rawValue: segment.slice(eq + 1),
  };
}

/**
 * Parse a URL query string into Record<string, string[]>.
 *
 * @param {unknown} qs
 * @returns {Record<string, string[]>}
 */
export function parseQuery(qs) {
  const body = normalizeQueryString(qs);
  if (body === "") return {};

  /** @type {Record<string, string[]>} */
  const out = {};

  for (const segment of body.split("&")) {
    if (segment === "") continue;

    const { rawKey, rawValue } = splitPair(segment);
    const key = decodeFormComponent(rawKey);
    const value = decodeFormComponent(rawValue);

    if (Object.prototype.hasOwnProperty.call(out, key)) {
      out[key].push(value);
    } else {
      out[key] = [value];
    }
  }

  return out;
}
