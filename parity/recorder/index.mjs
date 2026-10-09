import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export { startAttempt } from './attempt.mjs';
export { inputBytes, outcomeOf, outputBytes, transcript } from './fold.mjs';

export async function readAttempt(dir) {
  const identity = JSON.parse(await readFile(join(dir, 'identity.json'), 'utf8'));
  const lines = (await readFile(join(dir, 'events.jsonl'), 'utf8')).split('\n');
  const events = [];
  let truncatedTail = false;
  for (const [index, line] of lines.entries()) {
    if (!line) continue;
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      if (index < lines.length - 1 && lines.slice(index + 1).some(Boolean)) throw error;
      truncatedTail = true;
    }
  }
  return { dir, identity, events, truncatedTail };
}
