import type { AuthorizationAction, Gate } from '../domain/state.ts';

export function grantMatches(gate: Gate, action: AuthorizationAction, scope: string): boolean {
  return gate.kind === 'authorization' && gate.action === action && gate.scope === scope;
}

const GATED_COMMANDS: readonly (readonly [AuthorizationAction, RegExp])[] = [
  ['force_push', /\bgit\s+push\b[^\n;&|]*(\s--force(-with-lease)?\b|\s-[a-zA-Z]*f[a-zA-Z]*\b|\s\+\S+)/],
  ['merge', /\b(gh\s+pr|origin\s+pr|glab\s+mr)\s+merge\b/],
  ['deploy', /\b(vercel\s+(deploy|--prod)|netlify\s+deploy|fly(ctl)?\s+deploy|kubectl\s+(apply|rollout)|terraform\s+apply|helm\s+(install|upgrade)|gcloud\s+\S+(\s+\S+)*\s+deploy|serverless\s+deploy)\b/],
  [
    'destructive_data_deletion',
    /\b(git\s+clean\s+-[a-zA-Z]*f|git\s+reset\s+--hard|git\s+branch\s+-D|git\s+push\b[^\n;&|]*(\s--delete|\s-[a-zA-Z]*d[a-zA-Z]*|\s:\S+)|terraform\s+destroy|kubectl\s+delete|helm\s+uninstall|(drop|truncate)\s+(table|database|schema))\b|\brm\s+-[a-zA-Z]*(rf|fr)[a-zA-Z]*\s+(\/|~|\$HOME|\.\.)/i,
  ],
  ['public_message', /\b(gh\s+(pr|issue)\s+(create|comment|review|close|edit)|gh\s+release\s+create|glab\s+(mr|issue)\s+(create|note)|origin\s+pr\s+(create|comment))\b|hooks\.slack\.com/],
  ['irreversible_action', /\b((npm|bun|pnpm|yarn)\s+publish|cargo\s+publish|twine\s+upload|gem\s+push|docker\s+push)\b/],
];

export function gatedAction(command: string): AuthorizationAction | null {
  return GATED_COMMANDS.find(([, pattern]) => pattern.test(command))?.[0] ?? null;
}
