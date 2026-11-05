import { existsSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { stripFrontmatter } from '@earendil-works/pi-coding-agent';

/**
 * A skill's body in the block Pi's own `/skill:name` expansion builds (`AgentSession._expandSkillCommand`), or
 * undefined when the file is gone. Pi exports no formatter for one block.
 */
export function skillBlock(name: string, path: string): string | undefined {
  if (!existsSync(path)) return undefined;
  const body = stripFrontmatter(readFileSync(path, 'utf8')).trim();
  return [`<skill name="${name}" location="${path}">`, `References are relative to ${dirname(path)}.`, '', body, '</skill>'].join('\n');
}
