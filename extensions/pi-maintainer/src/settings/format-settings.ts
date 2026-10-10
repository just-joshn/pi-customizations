/** Replace each known secret with an Aider-style `...last4` token. */
export function scrubSensitiveInfo(secrets: readonly string[], text: string): string {
  let next = text;
  for (const secret of secrets) {
    if (!secret) continue;
    const token = secret.length <= 4 ? '...' : `...${secret.slice(-4)}`;
    next = next.split(secret).join(token);
  }
  return next;
}

export interface OptionDiagnostic {
  readonly name: string;
  readonly value: unknown;
  readonly source: string;
}

export interface SettingsDiagnosticsInput {
  readonly dotenvFiles: readonly string[];
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly environmentPrefix: string;
  readonly options: readonly OptionDiagnostic[];
  readonly secrets: readonly string[];
}

function renderValue(value: unknown): string {
  if (value === null || value === undefined) return 'None';
  if (value === true) return 'True';
  if (value === false) return 'False';
  if (Array.isArray(value)) return value.length === 0 ? 'None' : value.join(', ');
  return String(value);
}

/**
 * Verbose configuration report: loaded dotenv paths, prefixed environment contributions, and
 * resolved option values, with credential material scrubbed.
 */
export function formatSettings(input: SettingsDiagnosticsInput): string {
  const lines: string[] = [];
  lines.push('Loaded .env files:');
  if (input.dotenvFiles.length === 0) lines.push('  (none)');
  else for (const file of input.dotenvFiles) lines.push(`  - ${file}`);

  const envEntries = Object.entries(input.environment)
    .filter(([key, value]) => key.startsWith(input.environmentPrefix) && value !== undefined && value !== '')
    .sort(([a], [b]) => a.localeCompare(b));
  lines.push('');
  lines.push('Environment Variables:');
  if (envEntries.length === 0) lines.push('  (none)');
  else for (const [key, value] of envEntries) lines.push(`  - ${key}: ${value}`);

  lines.push('');
  lines.push('Option settings:');
  for (const option of [...input.options].sort((a, b) => a.name.localeCompare(b.name))) {
    const rendered = renderValue(option.value);
    if (rendered === 'None' || rendered === 'False' || rendered === '') continue;
    lines.push(`  - ${option.name}: ${rendered}`);
  }
  return `${scrubSensitiveInfo(input.secrets, `${lines.join('\n')}\n`)}`;
}
