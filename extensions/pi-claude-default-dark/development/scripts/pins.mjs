import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const PINS = { claude: '2.1.323', pi: '1.5.2' };

export const binaryVersion = (bin) => execFileSync(bin, ['--version'], { encoding: 'utf8' }).trim().split(' ')[0];

const versionOrNothing = (versionOf, bin) => {
  try {
    return versionOf(bin);
  } catch {
    return undefined;
  }
};

// Claude Code updates itself and repoints `claude`, so the pin names a version, not whatever is on PATH.
export function resolvePinnedClaude({ pin = PINS.claude, versionOf = binaryVersion, versionsDir = join(homedir(), '.local/share/claude/versions') } = {}) {
  if (versionOrNothing(versionOf, 'claude') === pin) return 'claude';
  const pinned = join(versionsDir, pin);
  if (existsSync(pinned) && versionOf(pinned) === pin) return pinned;
  throw new Error(`Claude Code ${pin} is not on PATH and not installed at ${pinned}`);
}
