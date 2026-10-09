/**
 * Decode one application/x-www-form-urlencoded component.
 * `+` → space; percent-decode with a safe fallback for malformed sequences.
 */
function decodeFormComponent(raw) {
  const spaced = raw.replace(/\+/g, " ");
  try {
    return decodeURIComponent(spaced);
  } catch {
    // Decode maximal runs of valid %HH; leave undecodable spans unchanged.
    return spaced.replace(/(?:%[0-9A-Fa-f]{2})+/g, (run) => {
      try {
        return decodeURIComponent(run);
      } catch {
        return run;
      }
    });
  }
}

/** Strip a leading `?`; coerce nullish / non-string to a usable string or null (empty). */
function normalizeQueryString(qs) {
  if (qs == null || qs === "") return "";
  const s = typeof qs === "string" ? qs : String(qs);
  return s.startsWith("?") ? s.slice(1) : s;
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
    // Lone empties from `?`, leading/trailing/duplicate `&` — skip.
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
