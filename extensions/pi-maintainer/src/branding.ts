/**
 * The Pi names that replace Aider's own names. Every user-visible or repository-visible
 * identifier that Aider spells with "aider" comes from here, so a rename is one edit.
 */
export const BRANDING = {
  /** Replaces `.aiderignore`. */
  ignoreFile: '.pimaintainerignore',
  /** Replaces the `.aider*` pattern Aider offers to add to `.gitignore`. */
  gitignorePattern: '.pi-maintainer*',
  /** Replaces the ` (aider)` suffix on attributed author and committer names. */
  nameSuffix: ' (pi)',
  /** Replaces the `aider: ` commit-message prefix. */
  messagePrefix: 'pi: ',
  /** Replaces `aider` in `Co-authored-by: aider (<model>) <aider@aider.chat>`. */
  coAuthorName: 'pi',
  /** Default for the trailer email, which is a setting. */
  coAuthorEmail: 'noreply@pi.dev',
  /** Replaces the `AIDER_` environment-variable prefix. */
  envPrefix: 'PI_MAINTAINER_',
  /** Replaces the `.aider.tags.cache.v4` directory name. */
  tagsCacheDir: '.pi-maintainer.tags.cache.v4',
} as const;

/** The `Co-authored-by` trailer for an assistant commit made with `model`. */
export const coAuthoredBy = (model: string, email: string = BRANDING.coAuthorEmail): string => `Co-authored-by: ${BRANDING.coAuthorName} (${model}) <${email}>`;
