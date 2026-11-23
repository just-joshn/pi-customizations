import path from 'node:path';

import { GREP_MAX_LINE_LENGTH } from '../constants.ts';
import { layerError } from './errors.ts';
import { canonicalPath, displayPath, isInside } from './paths.ts';
import { isInsideWorkspace, ruleMatches } from './policy.ts';
import { resolveBinary } from './proc.ts';
import type { LayerSession } from './session.ts';

/** Base flags shared by every search: no ambient config, hidden files, no color. */
export const BASE_RG_ARGS = ['--no-config', '--hidden', '--color=never'] as const;

/** Resolve ripgrep, preferring the binary Pi manages. */
export function ensureRipgrep(agentDir: string): string {
  const binary = resolveBinary('rg', agentDir);
  if (!binary) {
    throw layerError('error', 'ripgrep (rg) is not available. Install ripgrep and retry.');
  }
  return binary;
}

/** Reject a search root that the ignore rules exclude. */
export async function assertSearchable(session: LayerSession, subjects: readonly string[], cwd: string): Promise<void> {
  for (const subject of subjects) {
    const file = await session.ignore.describe(subject);
    if (file !== undefined) {
      throw layerError('error', `Path ${displayPath(cwd, subject)} is filtered out by ${path.basename(file)}`);
    }
  }
}

/**
 * Filter search results once, using the same verdicts as read and ls: the resolved target, the ignore
 * chain for that path, and the read rules. Returned values are the original (display) paths.
 */
export interface SearchCandidate {
  readonly path: string;
  readonly isDirectory?: boolean;
}

export async function allowedPaths(session: LayerSession, candidates: readonly (string | SearchCandidate)[], root?: string): Promise<Set<string>> {
  const canonicalRoot = root === undefined ? undefined : await canonicalPath(root);
  const allowed = new Set<string>();
  const entries: SearchCandidate[] = candidates.map((candidate) => (typeof candidate === 'string' ? { path: candidate } : candidate));
  const unique = [...new Map(entries.map((entry) => [entry.path, entry])).values()];
  const concurrency = 16;
  for (let start = 0; start < unique.length; start += concurrency) {
    const batch = unique.slice(start, start + concurrency);
    const verdicts = await Promise.all(
      batch.map(async (entry) => {
        const candidate = entry.path;
        const canonical = await canonicalPath(candidate);
        const subjects = canonical === candidate ? [candidate] : [candidate, canonical];
        // Containment uses the resolved target, so a symlink cannot return a file outside the
        // workspace or outside a search root the caller named explicitly.
        const contained = isInsideWorkspace(session.policy, canonical) || (canonicalRoot !== undefined && isInside(canonicalRoot, canonical));
        if (!contained) {
          return undefined;
        }
        for (const subject of subjects) {
          if (await session.ignore.ignores(subject, entry.isDirectory === true)) {
            return undefined;
          }
        }
        const readRules = session.policy.rules.filter((rule) => rule.kind === 'read');
        for (const subject of subjects) {
          if (readRules.some((rule) => rule.action === 'deny' && ruleMatches(rule, subject, session.policy))) {
            return undefined;
          }
        }
        if (session.policy.mode === 'allowlist') {
          const canonicalAllowed = readRules.some((rule) => rule.action === 'allow' && ruleMatches(rule, canonical, session.policy));
          if (!canonicalAllowed) {
            return undefined;
          }
        }
        return candidate;
      }),
    );
    for (const verdict of verdicts) {
      if (verdict !== undefined) {
        allowed.add(verdict);
      }
    }
  }
  return allowed;
}

/** Cut a matched line to the line cap, reporting whether it was cut. */
export function truncateMatchedLine(text: string, cap = GREP_MAX_LINE_LENGTH): { text: string; truncated: boolean } {
  if (text.length <= cap) {
    return { text, truncated: false };
  }
  return { text: `${text.slice(0, cap)} [...]`, truncated: true };
}
