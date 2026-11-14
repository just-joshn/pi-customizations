import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { align, type Observation, screen } from '../lib/align.ts';
import { readCrosswalk, writeCrosswalk } from '../lib/crosswalk-csv.ts';
import { CaptureRunSchema, directions, PaletteSchema, ProbeMapSchema, parseRole, readJson } from '../lib/schemas.ts';

const dev = join(dirname(fileURLToPath(import.meta.url)), '..');
const captures = join(dev, 'captures');
const palette = readJson(join(captures, 'terminal-palette.json'), PaletteSchema);
const probeMap = readJson(join(captures, 'role-probe.map.json'), ProbeMapSchema);
const probeRun = readJson(join(captures, 'pi-role-probe/run.json'), CaptureRunSchema);
const claudeRun = readJson(join(captures, 'claude/run.json'), CaptureRunSchema);

const piOnlyScenes = new Set(
  Object.entries<string>(probeRun.scenes)
    .filter(([, kind]) => kind === 'pi-only')
    .map(([name]) => name),
);
const ansi = (dir: string) => readdirSync(join(captures, dir)).filter((f) => f.endsWith('.ansi'));

const observations: Observation[] = [];
const rolesSeen = new Map<string, Set<string>>();
for (const file of ansi('pi-role-probe')) {
  const scene = file.replace(/\.ansi$/, '');
  const pi = screen(readFileSync(join(captures, 'pi-role-probe', file), 'utf8'));
  for (const run of pi.runs)
    for (const dir of directions) {
      const c = run.style[dir];
      const role = c.kind === 'rgb' ? probeMap[c.hex] : undefined;
      if (role) (rolesSeen.get(`${role}:${dir}`) ?? rolesSeen.set(`${role}:${dir}`, new Set()).get(`${role}:${dir}`))?.add(scene);
    }
  const baseScene = scene.replace(/-expanded$|-\d+ms$/, '');
  if (piOnlyScenes.has(baseScene) || !existsSync(join(captures, 'claude', file)) || !(baseScene in claudeRun.scenes)) continue;
  observations.push(...align({ scene, pi, claude: screen(readFileSync(join(captures, 'claude', file), 'utf8')), roleOf: (hex) => probeMap[hex], palette }));
}

type Verdict = { class: 'measured' | 'renderer-required' | 'unanchored' | 'not-rendered'; reference: string; evidence: string; values: Record<string, number> };
const verdicts = new Map<string, Verdict>();
for (const role of Object.values(probeMap)) {
  for (const dir of directions) {
    const key = `${role}:${dir}`;
    if (!rolesSeen.has(key)) continue;
    const mine = observations.filter((o) => o.role === role && o.direction === dir);
    const values: Record<string, number> = {};
    for (const o of mine) {
      const v = `${o.claude}${o.claudeAttrs === 'none' ? '' : ` [${o.claudeAttrs}]`}`;
      values[v] = (values[v] ?? 0) + 1;
    }
    const first = mine[0];
    const evidence = [...new Set(mine.map((o) => `${o.scene}@${o.claudeAt}:${o.token}`))].slice(0, 3).join(' ');
    const distinct = Object.keys(values);
    verdicts.set(key, {
      class: distinct.length === 0 ? 'unanchored' : distinct.length === 1 ? 'measured' : 'renderer-required',
      reference: distinct.length === 1 && first ? first.claude : '',
      evidence: distinct.length === 0 ? `pi:${[...(rolesSeen.get(key) ?? [])].slice(0, 3).join(',')}` : evidence,
      values,
    });
  }
}

const out = readCrosswalk(join(dev, 'crosswalk.csv')).map((row) => {
  const role = parseRole(row.pi_role);
  const dir = row.pi_color_direction === 'background' ? 'bg' : 'fg';
  const v = verdicts.get(`${role}:${dir}`);
  const first = row.claude_candidate_or_observation.split(' | ')[0];
  if (!v) return { ...row, mapping_class: 'not-rendered', reference_rgb: '', claude_candidate_or_observation: `${first} | not painted in any captured Pi scene`, parity_status: 'INCONCLUSIVE' };
  const values = Object.entries(v.values)
    .map(([k, n]) => `${k} x${n}`)
    .join('; ');
  return {
    ...row,
    mapping_class: v.class,
    reference_rgb: v.reference,
    public_renderer_required: String(v.class === 'renderer-required'),
    claude_candidate_or_observation: `${first} | ${v.evidence}${values ? ` | ${values}` : ''}`,
    parity_status: 'INCONCLUSIVE',
  };
});
writeCrosswalk(join(dev, 'captures/crosswalk-first-pass.csv'), out);
writeFileSync(join(dev, 'captures/observations.json'), `${JSON.stringify(observations, null, 1)}\n`);

const tally: Record<string, number> = {};
for (const row of out) tally[row.mapping_class] = (tally[row.mapping_class] ?? 0) + 1;
console.log(JSON.stringify({ rows: out.length, observations: observations.length, tally }));
