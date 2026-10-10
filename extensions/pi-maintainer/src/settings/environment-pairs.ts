/** Result of applying repeatable `NAME=value` overlays to the extension environment. */
export interface EnvironmentOverlayResult {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly problems: readonly string[];
  /** Raw secret values that diagnostics must scrub. */
  readonly secrets: readonly string[];
}

function splitPair(raw: string, flag: string): { readonly ok: true; readonly name: string; readonly value: string } | { readonly ok: false; readonly problem: string } {
  const separator = raw.indexOf('=');
  if (separator === -1) {
    return {
      ok: false,
      problem: `Invalid ${flag} format: ${raw}`,
    };
  }
  return { ok: true, name: raw.slice(0, separator).trim(), value: raw.slice(separator + 1).trim() };
}

/** Aider `main`'s `--set-env` loop: trim name and value, keep internal spaces, reject missing `=`. */
export function applySetEnvPairs(pairs: readonly string[], base: Readonly<Record<string, string | undefined>>): EnvironmentOverlayResult {
  const environment: Record<string, string | undefined> = { ...base };
  const problems: string[] = [];
  const secrets: string[] = [];
  for (const raw of pairs) {
    const parsed = splitPair(raw, '--set-env');
    if (!parsed.ok) {
      problems.push(parsed.problem);
      problems.push('Format should be: ENV_VAR_NAME=value');
      continue;
    }
    environment[parsed.name] = parsed.value;
    if (parsed.value) secrets.push(parsed.value);
  }
  return { environment, problems, secrets };
}

/** Aider `main`'s `--api-key` loop into `PROVIDER_API_KEY`, applied only to the extension environment. */
export function applyApiKeyPairs(pairs: readonly string[], base: Readonly<Record<string, string | undefined>>): EnvironmentOverlayResult {
  const environment: Record<string, string | undefined> = { ...base };
  const problems: string[] = [];
  const secrets: string[] = [];
  for (const raw of pairs) {
    const parsed = splitPair(raw, '--api-key');
    if (!parsed.ok) {
      problems.push(parsed.problem);
      problems.push('Format should be: provider=key');
      continue;
    }
    const name = `${parsed.name.toUpperCase()}_API_KEY`;
    environment[name] = parsed.value;
    if (parsed.value) secrets.push(parsed.value);
  }
  return { environment, problems, secrets };
}
