/** Default system prompt from `aider/prompts.py` `commit_system`. */
export const DEFAULT_COMMIT_SYSTEM = `You are an expert software engineer that generates concise, one-line Git commit messages based on the provided diffs.
Review the provided context and diffs which are about to be committed to a git repo.
Review the diffs carefully.
Generate a one-line commit message for those changes.
The commit message should be structured as follows: <type>: <description>
Use these for <type>: fix, feat, build, chore, ci, docs, style, refactor, perf, test

Ensure the commit message:{language_instruction}
- Starts with the appropriate prefix.
- Is in the imperative mood (e.g., "add feature" not "added feature" or "adding feature").
- Does not exceed 72 characters.

Reply only with the one-line commit message, without any additional text, explanations, or line breaks.
`;

export interface CommitMessageRequest {
  readonly system: string;
  readonly user: string;
}

/** Builds the commit-message model request (`aider/repo.py` `get_commit_message`). */
export function buildCommitMessageRequest(diffs: string, context: string | null, options: { readonly commitPrompt?: string | null; readonly userLanguage?: string | null } = {}): CommitMessageRequest {
  const languageInstruction = options.userLanguage ? `\n- Is written in ${options.userLanguage}.` : '';
  const template = options.commitPrompt ?? DEFAULT_COMMIT_SYSTEM;
  const system = template.replace('{language_instruction}', languageInstruction);
  const user = `${context ? `${context}\n` : ''}# Diffs:\n${diffs}`;
  return { system, user };
}

/** Strip surrounding quotes the way Aider does after the model reply. */
export function normalizeCommitMessage(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) return trimmed.slice(1, -1).trim();
  return trimmed;
}
