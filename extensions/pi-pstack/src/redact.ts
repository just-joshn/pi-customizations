// What may be shown, logged, or stored about a worker's credentials. Plain Node: the worker host bundle imports it.

/** A URL without its `user:password@` part. */
export const stripUserinfo = (url: string): string => url.replace(/^([A-Za-z][A-Za-z0-9+.-]*:\/\/)[^/@]*@/, '$1');

/** `//user:token@` becomes `//***@` wherever it appears in a text. */
export const redactUserinfo = (text: string): string => text.replace(/(\/\/)[^\s/@]+@/g, '$1***@');

const SECRET_NAME = /TOKEN|SECRET|PASSW|CREDENTIAL|API_?KEY|PRIVATE|(^|_)AUTH($|_)/i;
const MIN_SECRET_LENGTH = 6;

function collectStrings(value: unknown, into: Set<string>): void {
  if (typeof value === 'string') {
    if (value.length >= MIN_SECRET_LENGTH) into.add(value);
  } else if (Array.isArray(value)) for (const part of value) collectStrings(part, into);
  else if (typeof value === 'object' && value !== null) for (const part of Object.values(value)) collectStrings(part, into);
}

/**
 * The values in a worker's environment that must never reach a terminal or a log: those of the provider's credential
 * variables and of any variable whose name says it holds a secret, and the strings inside a value that is a JSON
 * credential file. Longest first, so a secret that contains another is replaced whole.
 */
export function secretValues(env: Readonly<Record<string, string>>, credentialNames: readonly string[]): string[] {
  const names = new Set(credentialNames);
  const found = new Set<string>();
  for (const [name, value] of Object.entries(env)) {
    if (!names.has(name) && !SECRET_NAME.test(name)) continue;
    if (value.length >= MIN_SECRET_LENGTH) found.add(value);
    try {
      collectStrings(JSON.parse(value), found);
    } catch {
      // Not a JSON credential file; the whole value is already collected.
    }
  }
  return [...found].sort((a, b) => b.length - a.length);
}

/** Replaces each secret and every URL's userinfo in a text. */
export const scrubber =
  (secrets: readonly string[]) =>
  (text: string): string =>
    secrets.reduce((clean, secret) => clean.split(secret).join('***'), redactUserinfo(text));
