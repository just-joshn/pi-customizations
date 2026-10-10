/**
 * Python `re` semantics that JavaScript's RegExp spells differently. These are regular
 * expression source fragments for building a RegExp that matches what the Python pattern matches.
 */

/**
 * Python's `\s` in a `str` pattern: the characters for which `str.isspace()` is true. It includes
 * the C0 separators U+001C to U+001F and NEL, which JavaScript's `\s` lacks, and excludes the
 * byte order mark, which JavaScript's `\s` includes.
 */
export const PY_SPACE = '[\\t-\\r\\x1c-\\x20\\x85\\xa0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000]';

/**
 * Python's `^` under `re.MULTILINE`: the start of the string or the position after `\n`.
 * JavaScript's `m` flag also matches after `\r`, U+2028, and U+2029.
 */
export const PY_LINE_START = '(?<![^\\n])';
