import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { BENIGN, PRIMITIVES, type PrimitiveId, SENTINELS } from './cursor-to-pi.ts';
import { listFiles, type Origin, toPosix, UPSTREAM, VENDOR_ROOTS } from './provenance.ts';

export type SkillKind = 'primary' | 'principle';

export interface SkillSource {
  readonly name: string;
  readonly origin: Origin;
  readonly kind: SkillKind;
  readonly dir: string;
  readonly files: readonly string[];
}

export interface Reference {
  readonly file: string;
  readonly line: number;
  readonly target: string;
  readonly resolved: string | null;
}

export interface Hit {
  readonly file: string;
  readonly line: number;
  readonly offset?: number;
  readonly id: string;
  readonly text: string;
}

const INSTRUCTION_FILE = /\.md$/;
const SCRIPT_PRIMITIVES: ReadonlySet<PrimitiveId> = new Set(['cursor-path', 'cursor-transcripts']);
const SCRIPT_FILE = /(?:^|\/)scripts\//;
const ASSET_FILE = /(?:^|\/)assets\//;

export function discoverSkills(packageRoot: string): SkillSource[] {
  const skills: SkillSource[] = [];
  for (const origin of Object.keys(VENDOR_ROOTS) as Origin[]) {
    const root = join(packageRoot, VENDOR_ROOTS[origin], 'skills');
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const dir = join(root, entry.name);
      skills.push({
        name: entry.name,
        origin,
        kind: entry.name.startsWith('principle-') ? 'principle' : 'primary',
        dir: toPosix(relative(packageRoot, dir)),
        files: listFiles(dir),
      });
    }
  }
  return skills.sort((a, b) => (a.name < b.name ? -1 : 1));
}

export function lineAt(text: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

function matches(text: string, pattern: RegExp): { index: number; text: string; group: string; groups: string[] }[] {
  return [...text.matchAll(new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`))].map((m) => ({
    index: m.index ?? 0,
    text: m[0],
    group: m[1] ?? '',
    groups: m.slice(1).map((g) => g ?? ''),
  }));
}

const LINK = /\[[^\]\n]*\]\(([^)\s]+)\)/g;
const CODE_PATH = /`((?:\.\.?\/|references\/|scripts\/|playbooks\/|assets\/)[^`\s<>*]+)(?:\s[^`]*)?`/g;

export function extractReferences(text: string, file: string, fileAbs: string, skillAbs: string): Reference[] {
  const refs: Reference[] = [];
  const add = (index: number, raw: string) => {
    const target = raw.replace(/#.*$/, '');
    if (!target || /^[a-z][a-z+.-]*:/i.test(target) || /^[a-z-]+$/i.test(target)) return;
    const candidates = [resolve(dirname(fileAbs), target), resolve(skillAbs, target)];
    const hit = candidates.find((candidate) => existsSync(candidate)) ?? null;
    refs.push({ file, line: lineAt(text, index), target, resolved: hit });
  };
  for (const m of matches(text, LINK)) add(m.index, m.group);
  for (const m of matches(text, CODE_PATH)) add(m.index, m.group);
  return refs;
}

function kebab(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-');
}

export function referencedSkills(text: string, known: ReadonlySet<string>, self: string): string[] {
  const found = new Set<string>();
  const consider = (name: string) => {
    if (known.has(name)) found.add(name);
    else if (known.has(`principle-${name}`)) found.add(`principle-${name}`);
  };
  for (const m of matches(text, /\*\*([^*\n]+)\*\*( (?:principle )?skill\b)?/g)) {
    const name = kebab(m.group);
    if (m.groups[1]) consider(name);
    else if (known.has(`principle-${name}`)) found.add(`principle-${name}`);
  }
  for (const m of matches(text, /`\/?([a-z0-9-]+)`/g)) consider(m.group);
  for (const m of matches(text, /(?<![\w./~:<>-])\/([a-z][a-z-]*[a-z])(?![\w./-])/g)) consider(m.group);
  for (const m of matches(text, /\.\.\/([a-z0-9-]+)\/SKILL\.md/g)) consider(m.group);
  for (const m of matches(text, /\bprinciple-[a-z-]*[a-z]\b/g)) consider(m.text);
  for (const m of matches(text, /\b([a-z][a-z0-9-]+) (?:principle )?skill\b/g)) consider(m.group);
  found.delete(self);
  return [...found].sort();
}

export function unknownSkillMentions(text: string, file: string, known: ReadonlySet<string>): Hit[] {
  const hits: Hit[] = [];
  for (const m of matches(text, /(?:\*\*|`)([a-z][a-z0-9-]+)(?:\*\*|`) (?:principle )?skill\b/g)) {
    const name = m.group;
    if (known.has(name) || known.has(`principle-${name}`) || detectPrimitives(m.text, file).length) continue;
    hits.push({ file, line: lineAt(text, m.index), id: 'unknown-skill', text: m.text });
  }
  return hits;
}

export function detectPrimitives(text: string, file: string, ids?: ReadonlySet<PrimitiveId>): Hit[] {
  const hits: Hit[] = [];
  for (const primitive of PRIMITIVES) {
    if (!primitive.detect || (ids && !ids.has(primitive.id))) continue;
    for (const m of matches(text, primitive.detect)) hits.push({ file, line: lineAt(text, m.index), offset: m.index, id: primitive.id, text: m.text });
  }
  return hits;
}

export function sweepUnknown(text: string, file: string, known: ReadonlySet<string>): Hit[] {
  const covered: [number, number][] = [];
  for (const p of PRIMITIVES) if (p.detect) for (const m of matches(text, p.detect)) covered.push([m.index, m.index + m.text.length]);
  for (const b of BENIGN) for (const m of matches(text, b.pattern)) covered.push([m.index, m.index + m.text.length]);
  const unknown: Hit[] = [];
  for (const sentinel of SENTINELS) {
    for (const m of matches(text, sentinel)) {
      const start = m.index;
      const end = start + m.text.length;
      if (covered.some(([a, b]) => start < b && end > a)) continue;
      if (m.text.startsWith('/') && known.has(m.text.slice(1))) continue;
      unknown.push({ file, line: lineAt(text, start), offset: start, id: 'unknown', text: m.text });
    }
  }
  return unknown;
}

export interface SkillDependencies {
  readonly name: string;
  readonly origin: Origin;
  readonly kind: SkillKind;
  readonly required: boolean;
  readonly requiredBy: readonly string[];
  readonly files: readonly string[];
  readonly scripts: readonly string[];
  readonly assets: readonly string[];
  readonly references: readonly Reference[];
  readonly skills: readonly string[];
  readonly transitiveSkills: readonly string[];
  readonly primitives: Readonly<Record<string, number>>;
  readonly primitiveHits: readonly Hit[];
}

export interface DependencyManifest {
  readonly schemaVersion: 1;
  readonly upstream: typeof UPSTREAM;
  readonly counts: Readonly<Record<string, number>>;
  readonly requiredTeamKit: readonly { name: string; requiredBy: readonly string[] }[];
  readonly skills: readonly SkillDependencies[];
  readonly agents: readonly { file: string; primitives: Readonly<Record<string, number>>; primitiveHits: readonly Hit[] }[];
  readonly unknown: readonly Hit[];
  readonly unresolved: readonly Reference[];
}

function tally(hits: readonly Hit[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const hit of hits) out[hit.id] = (out[hit.id] ?? 0) + 1;
  return Object.fromEntries(Object.entries(out).sort(([a], [b]) => (a < b ? -1 : 1)));
}

function scanFile(packageRoot: string, skill: SkillSource, path: string, known: ReadonlySet<string>) {
  const abs = join(packageRoot, skill.dir, path);
  const text = readFileSync(abs, 'utf8');
  const file = `${skill.dir}/${path}`;
  if (INSTRUCTION_FILE.test(path)) {
    return {
      references: extractReferences(text, file, abs, join(packageRoot, skill.dir)).map((r) => ({ ...r, resolved: r.resolved && toPosix(relative(packageRoot, r.resolved)) })),
      skills: referencedSkills(text, known, skill.name),
      hits: detectPrimitives(text, file),
      unknown: [...sweepUnknown(text, file, known), ...unknownSkillMentions(text, file, known)],
    };
  }
  return { references: [], skills: [], hits: detectPrimitives(text, file, SCRIPT_PRIMITIVES), unknown: [] };
}

export function buildDependencyManifest(packageRoot: string): DependencyManifest {
  const sources = discoverSkills(packageRoot);
  const known = new Set(sources.map((s) => s.name));
  if (known.size !== sources.length) throw new Error('Duplicate skill names across pstack and team-kit');
  const unknown: Hit[] = [];
  const scanned = sources.map((skill) => {
    const references: Reference[] = [];
    const skills = new Set<string>();
    const hits: Hit[] = [];
    const unknowns: Hit[] = [];
    for (const path of skill.files) {
      if (/\.(png|jpe?g|gif|webp|mp4|lock)$/.test(path)) continue;
      const result = scanFile(packageRoot, skill, path, known);
      references.push(...result.references);
      for (const name of result.skills) skills.add(name);
      hits.push(...result.hits);
      unknowns.push(...result.unknown);
    }
    return { skill, references, skills: [...skills].sort(), hits, unknowns };
  });
  const direct = new Map(scanned.map((s) => [s.skill.name, s.skills]));
  const closure = (name: string): string[] => {
    const seen = new Set<string>();
    const stack = [...(direct.get(name) ?? [])];
    for (let next = stack.pop(); next !== undefined; next = stack.pop()) {
      if (seen.has(next)) continue;
      seen.add(next);
      stack.push(...(direct.get(next) ?? []));
    }
    seen.delete(name);
    return [...seen].sort();
  };
  const required = new Set(sources.filter((s) => s.origin === 'pstack').flatMap((s) => [s.name, ...closure(s.name)]));
  const requiredBy = new Map<string, Set<string>>();
  for (const s of scanned) {
    if (!required.has(s.skill.name)) continue;
    for (const dep of s.skills) requiredBy.set(dep, new Set([...(requiredBy.get(dep) ?? []), s.skill.name]));
  }
  for (const s of scanned) if (required.has(s.skill.name)) unknown.push(...s.unknowns);
  const skills: SkillDependencies[] = scanned.map(({ skill, references, skills: deps, hits }) => ({
    name: skill.name,
    origin: skill.origin,
    kind: skill.kind,
    required: required.has(skill.name),
    requiredBy: [...(requiredBy.get(skill.name) ?? [])].sort(),
    files: skill.files,
    scripts: skill.files.filter((f) => SCRIPT_FILE.test(f)),
    assets: skill.files.filter((f) => ASSET_FILE.test(f)),
    references,
    skills: deps,
    transitiveSkills: closure(skill.name),
    primitives: tally(hits),
    primitiveHits: hits,
  }));
  const agentsDir = join(packageRoot, VENDOR_ROOTS.pstack, 'agents');
  const agents = listFiles(agentsDir).map((path) => {
    const file = `${VENDOR_ROOTS.pstack}/agents/${path}`;
    const text = readFileSync(join(agentsDir, path), 'utf8');
    unknown.push(...sweepUnknown(text, file, known));
    const hits = detectPrimitives(text, file);
    return { file, primitives: tally(hits), primitiveHits: hits };
  });
  const playbooks = listFiles(join(packageRoot, VENDOR_ROOTS.pstack, 'skills/poteto-mode/playbooks')).length;
  const requiredTeamKit = skills.filter((s) => s.origin === 'team-kit' && s.required).map((s) => ({ name: s.name, requiredBy: s.requiredBy }));
  return {
    schemaVersion: 1,
    upstream: UPSTREAM,
    counts: {
      primary: skills.filter((s) => s.origin === 'pstack' && s.kind === 'primary').length,
      principle: skills.filter((s) => s.origin === 'pstack' && s.kind === 'principle').length,
      playbooks,
      agents: agents.length,
      teamKitVendored: skills.filter((s) => s.origin === 'team-kit').length,
      teamKitRequired: requiredTeamKit.length,
    },
    requiredTeamKit,
    skills,
    agents,
    unknown,
    unresolved: skills.filter((s) => s.required).flatMap((s) => s.references.filter((r) => !r.resolved)),
  };
}
