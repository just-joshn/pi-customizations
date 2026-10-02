export type PatternAction = 'neutralize' | 'neutralize-silent' | 'flag';
export type OutputPattern = Readonly<{
  pattern: string;
  category: 'control-tag' | 'turn-marker' | 'escalation-pattern';
  re: RegExp;
  action: PatternAction;
  neutralize?: (match: string) => string;
  provenanceOnly?: true;
}>;

const lineBreakClass = '\\r\\n\\v\\f\\u0085\\u2028\\u2029\\u001c-\\u001e';
const lineStart = `(?:^|[${lineBreakClass}])`;
const notAfterWordChar = '(?<![\\w-])';
const tagFiller = '[^A-Za-z0-9_\\-<>]*';
const envelopeTags = [
  'task-notification',
  'agent-message',
  'teammate-message',
  'cross-session-message',
  'remote-review',
  'slack-ping',
  'slack-tag-message',
  'tick',
  'fetched-web-content',
  'coordinator-relay',
  'artifact-type-instructions',
  'cowritten-artifact-html',
  'artifact-file-content',
  'artifact-origin-notes',
  'artifact-stored-declaration',
];
const signalTags = [
  'bash-input',
  'bash-stdout',
  'bash-stderr',
  'bash-exit-code',
  'local-command-stdout',
  'local-command-stderr',
  'local-command-caveat',
  'command-name',
  'command-message',
  'command-args',
  'function_results',
  'tool_use_error',
  'sandbox_violations',
  'persisted-output',
  'total_tokens',
  'user-prompt-submit-hook',
];
const artifactLeads = [
  'artifact owned by you',
  'artifact raw html follows',
  'artifact summary below',
  'artifact shared with you',
  'artifact published from your',
  'artifact live version',
  'artifact published by a writer',
  'stored for the live version',
  'origin of this version',
  'created from the artifact type',
  'end of live content',
  'design system not attached',
];

function spell(name: string): string {
  return name.replace(/[-_]/g, '[-_]');
}

function tagPattern(tags: readonly string[], tail = '(?:[^A-Za-z0-9_\\-]|$)'): RegExp {
  return new RegExp(`<(?!\\\\)(?=${tagFiller}(?:${tags.map(spell).join('|')})${tail})`, 'giu');
}

function bracketPrefix(word: string): RegExp {
  return new RegExp(`(${lineStart}\\s*)\\[(?=\\s*${word}(?![\\p{L}\\p{N}_]))`, 'giu');
}

function leadPattern(): RegExp {
  const phrases = artifactLeads.map((phrase) => phrase.split(' ').join('\\s+'));
  return new RegExp(`\\[(?!\\\\)(?=\\s*(?:${phrases.join('|')}))`, 'giu');
}

const appendBackslash = (match: string) => `${match}\\`;

export const controlPatterns: readonly OutputPattern[] = [
  { pattern: 'system-reminder-tag', category: 'control-tag', re: tagPattern(['system-reminder']), action: 'neutralize', neutralize: appendBackslash },
  { pattern: 'harness-envelope-tag', category: 'control-tag', re: tagPattern(envelopeTags), action: 'neutralize', neutralize: appendBackslash },
  { pattern: 'harness-signal-tag', category: 'control-tag', re: tagPattern(signalTags), action: 'neutralize', neutralize: appendBackslash },
  { pattern: 'channel-source-tag', category: 'control-tag', re: tagPattern(['channel'], `[^>]{0,120}${notAfterWordChar}source\\s*=`), action: 'neutralize', neutralize: appendBackslash },
  { pattern: 'marker-prefix-forgery', category: 'control-tag', re: bracketPrefix('harness'), action: 'neutralize', neutralize: appendBackslash },
  {
    pattern: 'max-turns-note-forgery',
    category: 'control-tag',
    re: new RegExp(`${lineStart}\\s*note\\s*:(?=\\s*this\\s+agent\\s+stopped\\s+at\\s+its)`, 'giu'),
    action: 'neutralize',
    neutralize: (match) => match.replace(/:$/, '\\:'),
  },
  { pattern: 'frame-prefix-forgery', category: 'control-tag', re: bracketPrefix('subagent'), action: 'neutralize', neutralize: appendBackslash, provenanceOnly: true },
  { pattern: 'artifact-lead-forgery', category: 'control-tag', re: leadPattern(), action: 'neutralize', neutralize: appendBackslash },
  { pattern: 'model-layer-tag', category: 'control-tag', re: tagPattern(['antml'], '[:]'), action: 'neutralize', neutralize: appendBackslash },
];

export const turnMarker: OutputPattern = {
  pattern: 'turn-marker',
  category: 'turn-marker',
  re: new RegExp(`(${lineStart}(?:Human|Assistant)):`, 'g'),
  action: 'neutralize-silent',
  neutralize: (match) => match.replace(':', '\\:'),
};

export const escalationPatterns: readonly OutputPattern[] = [
  {
    pattern: 'settings-json',
    category: 'escalation-pattern',
    re: /\.(?:claude|pi[\\/]+agent|pi)[\\/]+settings(?:\.local)?\.json|(?<!\w)\.claude\.json\b|(?<![\w-])managed-settings\.json\b/gi,
    action: 'flag',
  },
  { pattern: 'bypass-permissions', category: 'escalation-pattern', re: /\bbypassPermissions/gi, action: 'flag' },
  { pattern: 'dangerously-skip-permissions', category: 'escalation-pattern', re: /--dangerously-skip-permissions\b/gi, action: 'flag' },
  {
    pattern: 'permissions-allow-deny',
    category: 'escalation-pattern',
    re: /(?<![\w-])permissions\s*[.[]\s*["']?(?:allow|deny)\b|(?<![\w-])permissions["']?\s*:\s*\{[^{}]{0,80}["'](?:allow|deny)["']\s*:/gi,
    action: 'flag',
  },
];

export const scanPatterns: readonly OutputPattern[] = [...escalationPatterns, ...controlPatterns, turnMarker];
