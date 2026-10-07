import type { LeaderboardEntry } from '../domain/registry.ts';
import { array, type Decoded, decode, nonEmptyStr, num, object, parseJson } from '../orchestrator/decode.ts';

export const SKILLS_SH_URL = 'https://skills.sh/';

type RawSkill = { readonly source: string; readonly skillId: string; readonly installs: number };

const rawSkills = array(object<RawSkill>({ source: nonEmptyStr, skillId: nonEmptyStr, installs: num }));

function closingBracket(text: string, open: number): number {
  let depth = 0;
  let inString = false;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
    } else if (char === '"') inString = true;
    else if (char === '[') depth++;
    else if (char === ']') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

export function parseLeaderboardHtml(html: string): Decoded<readonly LeaderboardEntry[]> {
  const marker = html.indexOf('initialSkills');
  if (marker === -1) return { kind: 'invalid', reason: 'initialSkills payload not found' };
  const escaped = html.slice(marker, marker + 20).includes('\\"');
  const tail = escaped ? html.slice(marker).replaceAll('\\\\', '\\').replaceAll('\\"', '"') : html.slice(marker);
  const open = tail.indexOf('[');
  const close = open === -1 ? -1 : closingBracket(tail, open);
  if (close === -1) return { kind: 'invalid', reason: 'initialSkills array not terminated' };
  const json = parseJson(tail.slice(open, close + 1));
  if (json.kind === 'invalid') return json;
  const skills = decode(rawSkills, json.value);
  if (skills.kind === 'invalid') return skills;
  return { kind: 'ok', value: skills.value.map((skill, index) => ({ rank: index + 1, source: skill.source, skillId: skill.skillId, installs: skill.installs })) };
}

export type FetchText = (url: string) => Promise<string>;

export async function fetchLeaderboard(fetchText: FetchText): Promise<Decoded<readonly LeaderboardEntry[]>> {
  return parseLeaderboardHtml(await fetchText(SKILLS_SH_URL));
}
