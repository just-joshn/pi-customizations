export const PROSE_MODES = ['caveman', 'ultracave', 'megacave'] as const;
export const INDEPENDENT_MODES = ['commit', 'review', 'compress'] as const;

export type ProseMode = (typeof PROSE_MODES)[number];
export type IndependentMode = (typeof INDEPENDENT_MODES)[number];
export type Mode = ProseMode | IndependentMode;
export type StoredMode = Mode | 'off';
export type DefaultMode = StoredMode | 'manual';

const STORED_SET: ReadonlySet<string> = new Set<StoredMode>(['off', ...PROSE_MODES, ...INDEPENDENT_MODES]);

const LEGACY_MODES: Readonly<Record<string, ProseMode>> = {
  lite: 'caveman',
  full: 'caveman',
  ultra: 'ultracave',
  wenyan: 'megacave',
  'wenyan-lite': 'megacave',
  'wenyan-full': 'megacave',
  'wenyan-ultra': 'megacave',
};

const PROSE_SET: ReadonlySet<string> = new Set(PROSE_MODES);
const INDEPENDENT_SET: ReadonlySet<string> = new Set(INDEPENDENT_MODES);

export function isProseMode(value: string): value is ProseMode {
  return PROSE_SET.has(value);
}

export function isIndependentMode(value: string): value is IndependentMode {
  return INDEPENDENT_SET.has(value);
}

function isStoredMode(value: string): value is StoredMode {
  return STORED_SET.has(value);
}

export function canonicalMode(raw: unknown): StoredMode | null {
  if (typeof raw !== 'string') return null;
  const mode = raw.toLowerCase();
  if (isStoredMode(mode)) return mode;
  return Object.hasOwn(LEGACY_MODES, mode) ? (LEGACY_MODES[mode] ?? null) : null;
}

export function canonicalDefaultMode(raw: unknown): DefaultMode | null {
  if (typeof raw === 'string' && raw.toLowerCase() === 'manual') return 'manual';
  return canonicalMode(raw);
}

export function badgeFor(mode: Mode): string {
  return isProseMode(mode) ? `[${mode.toUpperCase()}]` : `[CAVEMAN:${mode.toUpperCase()}]`;
}
