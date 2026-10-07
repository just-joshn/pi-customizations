import { canonicalMode, type DefaultMode, type IndependentMode, isIndependentMode, type Mode } from './modes.ts';

export type ModeChange = { action: 'set'; mode: Mode } | { action: 'clear' } | { action: 'status' } | { action: 'unresolved'; independentMode?: IndependentMode };

export interface ParseOptions {
  readonly getDefaultMode: () => DefaultMode;
  readonly skipNaturalLanguage?: boolean;
}

const MODE_COMMANDS: Readonly<Record<string, Mode>> = {
  '/ultracave': 'ultracave',
  '/caveman:ultracave': 'ultracave',
  '/megacave': 'megacave',
  '/caveman:megacave': 'megacave',
};

const ONE_SHOT_COMMANDS: Readonly<Record<string, IndependentMode>> = {
  '/caveman-commit': 'commit',
  '/caveman:caveman-commit': 'commit',
  '/caveman-review': 'review',
  '/caveman:caveman-review': 'review',
  '/caveman-compress': 'compress',
  '/caveman:caveman-compress': 'compress',
};

// Only " and ` delimit quotes: apostrophes are too common in ordinary English.
const QUOTED_SPAN_REGEX = /(["`])(?:(?!\1).)*\1/g;
const ACTIVATION_VERBS = '(?:activate|enable|start|turn on|use|switch to|want|give me)';
// biome-ignore lint/security/noSecrets: regex source, not a credential
const ACTIVATION_GAP = '(?:\\s+(?:the|to|into|on|in|please|now|it|me|my|this|that|mode))*';
const ACTIVATION_VERB_PHRASE = new RegExp(`\\b${ACTIVATION_VERBS}\\b${ACTIVATION_GAP}\\s+caveman\\b`);
const ACTIVATION_TALK_LIKE = /\btalk\s+like\s+(?:a\s+|an\s+|the\s+)?caveman\b/;
const NEGATOR = /\b(?:don['’]?t|do not|doesn['’]?t|does not|won['’]?t|will not|never|no need to|rather not)\b/;
const CLAUSE_BOUNDARY = /[.;!?,:—–]|\s-+\s|\bbut\b|\bthen\b/g;
const BREVITY_TRIGGER = /\b(less tokens|fewer tokens|be brief|be terse|shorter answers)\b(?!\s+(in|for|on|about|when|during|with)\b)/;
const ACTIVATION_TRIGGERS = [ACTIVATION_VERB_PHRASE, ACTIVATION_TALK_LIKE, /\bcaveman\s+mode\s+(on|please|now)\b/, /^caveman(\s+mode)?\s*[.!]*$/, BREVITY_TRIGGER].map((re) => new RegExp(re.source, `${re.flags}g`));
const DEACTIVATION_TRIGGERS = [
  /\b(stop|disable|deactivate|quit|exit|kill)\s+(the\s+)?caveman\b/,
  /\bcaveman(\s+mode)?\s+(off|stop|disabled?)\b/,
  /\bturn\s+off\s+(the\s+)?caveman\b/,
  /^(please\s+)?(go\s+(back\s+)?(to\s+)?|back\s+to\s+|switch\s+(back\s+)?to\s+|return\s+to\s+)?normal\s+mode\b/,
];
const QUESTION = /^(what|whats|what's|how|why|when|where|who|does|do|did|is|are|can|could|would|should|tell me|explain)\b/;
const OFF_WORDS = new Set(['off', 'stop', 'disable']);

function negatedBefore(text: string, index: number): boolean {
  let clauseStart = 0;
  for (const match of text.matchAll(CLAUSE_BOUNDARY)) {
    if (match.index >= index) break;
    clauseStart = match.index + match[0].length;
  }
  return NEGATOR.test(text.slice(clauseStart, index));
}

function wantsActivation(text: string): boolean {
  return ACTIVATION_TRIGGERS.some((re) => [...text.matchAll(re)].some((match) => !negatedBefore(text, match.index)));
}

function wantsDeactivation(text: string): boolean {
  return DEACTIVATION_TRIGGERS.some((re) => re.test(text)) || (/\bnormal\s+mode\b/.test(text) && /\bcaveman\b/.test(text));
}

function normalizeModeArg(arg: string): string {
  return arg.replace(/^[^a-z0-9]+/, '').replace(/[^a-z0-9-]+$/, '');
}

function activationAtDefault(getDefaultMode: () => DefaultMode): ModeChange | null {
  const configured = getDefaultMode();
  const mode = configured === 'manual' ? 'caveman' : configured;
  return mode === 'off' ? null : { action: 'set', mode };
}

function resolveModeArg(rawArg: string, getDefaultMode: () => DefaultMode): ModeChange {
  const arg = normalizeModeArg(rawArg);
  if (!arg) {
    if (rawArg) return { action: 'unresolved' };
    return activationAtDefault(getDefaultMode) ?? { action: 'clear' };
  }
  if (OFF_WORDS.has(arg)) return { action: 'clear' };
  if (arg === 'status') return { action: 'status' };
  if (isIndependentMode(arg)) return { action: 'unresolved', independentMode: arg };
  const mode = canonicalMode(arg);
  return mode && mode !== 'off' ? { action: 'set', mode } : { action: 'unresolved' };
}

export function parseModeChange(raw: string, options: ParseOptions): ModeChange | null {
  const prompt = raw.trim().toLowerCase().replace(/\s+/g, ' ');
  if (!prompt) return null;

  const naturalLanguage = !options.skipNaturalLanguage && !prompt.startsWith('/');
  if (naturalLanguage) {
    const text = prompt.replace(QUOTED_SPAN_REGEX, ' ');
    if (wantsDeactivation(text)) return { action: 'clear' };
    return !QUESTION.test(text) && wantsActivation(text) ? activationAtDefault(options.getDefaultMode) : null;
  }

  const parts = prompt.split(' ');
  const command = parts[0] ?? '';
  const arg = parts[1] ?? '';
  const modeCommand = MODE_COMMANDS[command];
  if (modeCommand) {
    const normalized = normalizeModeArg(arg);
    if (OFF_WORDS.has(normalized)) return { action: 'clear' };
    if (normalized === 'status') return { action: 'status' };
    return { action: 'set', mode: modeCommand };
  }
  const oneShot = ONE_SHOT_COMMANDS[command];
  if (oneShot) return { action: 'set', mode: oneShot };
  if (command === '/caveman' || command === '/caveman:caveman') return resolveModeArg(arg, options.getDefaultMode);
  return null;
}
