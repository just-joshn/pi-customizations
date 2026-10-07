import { createHash } from 'node:crypto';

import type { InvocationPolicy, LeaderboardEntry } from '../domain/registry.ts';
import { array, type Decoded, decode, nonEmptyStr, num, object, parseJson } from '../orchestrator/decode.ts';
import type { PinnedSource } from './validate.ts';

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

const SKILLS_SH_FAQ_URL = 'https://skills.sh/docs/faq';

// Rank is an eligibility rule only while skills.sh ranks by install telemetry; a different basis needs a human look first.
export async function confirmRankingBasis(fetchText: FetchText): Promise<Decoded<'install_telemetry'>> {
  const faq = await fetchText(SKILLS_SH_FAQ_URL);
  const telemetry = /anonymous telemetry/i.test(faq) && /installation counts?/i.test(faq);
  return telemetry ? { kind: 'ok', value: 'install_telemetry' } : { kind: 'invalid', reason: `${SKILLS_SH_FAQ_URL} no longer says the leaderboard ranks install telemetry` };
}

export type Frontmatter = { readonly name: string; readonly invocationPolicy: InvocationPolicy };

export function parseFrontmatter(body: string): Decoded<Frontmatter> {
  const block = /^---\r?\n([\s\S]*?)\r?\n---/.exec(body)?.[1];
  if (block === undefined) return { kind: 'invalid', reason: 'SKILL.md has no frontmatter' };
  const name = /^name:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(block)?.[1];
  if (name === undefined) return { kind: 'invalid', reason: 'SKILL.md frontmatter has no name' };
  return { kind: 'ok', value: { name, invocationPolicy: /^disable-model-invocation:\s*true\s*$/m.test(block) ? 'user' : 'model' } };
}

export type Locator = { readonly repository: string; readonly path: string };

export type SourceResolver = { readonly fetchText: FetchText; readonly head: (repository: string) => Promise<string> };

export async function resolveSource(name: string, locator: Locator, resolver: SourceResolver): Promise<Decoded<PinnedSource>> {
  const commit = await resolver.head(locator.repository);
  const body = await resolver.fetchText(`https://raw.githubusercontent.com/${locator.repository}/${commit}/${locator.path}`);
  const frontmatter = parseFrontmatter(body);
  if (frontmatter.kind === 'invalid') return { kind: 'invalid', reason: `${name}: ${frontmatter.reason}` };
  if (frontmatter.value.name !== name) return { kind: 'invalid', reason: `${locator.repository}/${locator.path} names ${frontmatter.value.name}, not ${name}` };
  const contentHash = `sha256:${createHash('sha256').update(body).digest('hex')}`;
  return { kind: 'ok', value: { repository: locator.repository, commit, path: locator.path, contentHash, invocationPolicy: frontmatter.value.invocationPolicy } };
}
