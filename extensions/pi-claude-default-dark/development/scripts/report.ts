import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ThemeToken } from '@earendil-works/pi-coding-agent';
import { readCrosswalk, writeCrosswalk } from '../lib/crosswalk-csv.ts';
import { currentInputs, evidenceFingerprint, g3Verdict, g10Verdict, gateVerdict, measuredSummary } from '../lib/gates.ts';
import { G4Schema, type GateName, GateSchema, MappingSchema, parseRole, ReferenceLockSchema, ReviewsSchema, readJson, roleEntries, ThemeSchema, type Verdict, verdicts } from '../lib/schemas.ts';

const dev = join(dirname(fileURLToPath(import.meta.url)), '..');
const inputs = currentInputs(join(dev, '..'));
const result = (gate: string): { verdict: Verdict; summary: string } => {
  const path = join(dev, 'results', `${gate.toLowerCase()}.json`);
  if (!existsSync(path)) return { verdict: 'INCONCLUSIVE', summary: 'not run' };
  const r = readJson(path, GateSchema);
  const { verdict, stale } = gateVerdict(r, inputs);
  if (stale) return { verdict, summary: `stale: recorded ${r.verdict} against other package or theme inputs` };
  const checks: { verdict: Verdict }[] = r.checks ?? [];
  const tally = r.total ?? Object.fromEntries(verdicts.map((v) => [v, checks.filter((c) => c.verdict === v).length]));
  return { verdict, summary: `${tally.PASS} pass, ${tally.FAIL} fail, ${tally.INCONCLUSIVE} inconclusive` };
};
const run = (args: string[]) => spawnSync(process.execPath, args, { cwd: dev, encoding: 'utf8' });

const lock = readJson(join(dev, 'reference-lock.json'), ReferenceLockSchema);
const mapping = readJson(join(dev, 'mapping.json'), MappingSchema).roles;
const theme = readJson(join(dev, '../themes/claude-default-dark.json'), ThemeSchema).colors;
const g4 = readJson(join(dev, 'results/g4.json'), G4Schema);
const g4Gate = gateVerdict(g4, { ...inputs, evidence: evidenceFingerprint(dev, g4.themed) }, ['package', 'evidence']);
const reviews = ['claude', 'gpt'].map((n) => readJson(join(dev, `mapping-review/${n}.json`), ReviewsSchema));

const scan = run(['scripts/static-scan.mjs']);
const validate = run(['scripts/validate-theme.mjs']);
const g7 = result('G7');
const classes = Object.values(mapping).map((m) => m.class);
const blocking = Object.entries(mapping).filter(([, m]) => m.class === 'unmappable' || m.class === 'renderer-required');
const claudeOnly = Math.max(...reviews.map((r) => (r.claudeOnly ?? []).length));
const lockCheck = run(['scripts/lock.mjs', '--check']);
const drift: string[] =
  lockCheck.status === 0
    ? []
    : (() => {
        try {
          return JSON.parse(lockCheck.stdout).drift ?? ['lock check failed'];
        } catch {
          return [(lockCheck.stderr || 'lock check failed').trim().split('\n')[0] ?? 'lock check failed'];
        }
      })();
const comparableRoles = roleEntries(mapping)
  .filter(([, m]) => m.class !== 'pi-only')
  .map(([role]) => role);
const g4ByRole = g4Gate.stale ? {} : g4.byRole;

const gates: Partial<Record<GateName, { scope: string; verdict: Verdict; evidence: string }>> = {
  G0: {
    scope: 'Source/version/environment evidence lock',
    verdict: drift.length ? 'FAIL' : (lock.test_results.G0 ?? 'INCONCLUSIVE'),
    evidence: drift.length ? `lock.mjs --check: environment drifted from reference-lock.json (${drift.join(', ')})` : 'lock.mjs --check: versions, binaries, and terminal match reference-lock.json',
  },
  G1: {
    scope: 'Native manifest installed in real Pi',
    verdict: scan.status === 0 && g7.verdict === 'PASS' ? 'PASS' : scan.status !== 0 ? 'FAIL' : g7.verdict,
    evidence: `static-scan exit ${scan.status}; install discovery from G7 (${g7.verdict})`,
  },
  G2: { scope: 'Loader/schema coverage with real generated theme', verdict: validate.status === 0 ? 'PASS' : 'FAIL', evidence: `validate-theme.mjs: ${(validate.stdout || validate.stderr).trim().split('\n')[0]}` },
  G3: {
    scope: 'Exhaustive Claude-to-Pi semantic coverage',
    verdict: g3Verdict({ blockingRoles: blocking.length, claudeOnly: reviews.map((r) => r.claudeOnly), comparableRoles, byRole: g4ByRole }),
    evidence: `${blocking.length} roles renderer-required or unmappable; up to ${claudeOnly} Claude-only styled surfaces listed by the reviewers (mapping-review/*.json); ${comparableRoles.filter((r) => !((g4ByRole[r]?.PASS ?? 0) > 0 && (g4ByRole[r]?.FAIL ?? 0) === 0)).length} comparable roles without an exact observation`,
  },
  G4: {
    scope: 'Exact RGB, background, foreground, attributes',
    verdict: g4Gate.verdict,
    evidence: g4Gate.stale
      ? 'results/g4.json is stale: the package, theme, or captures it compared have changed since compare.ts ran'
      : `results/g4.json: ${g4.total.PASS} pass, ${g4.total.FAIL} fail, ${g4.total.INCONCLUSIVE} inconclusive observations`,
  },
  G5: { scope: 'Public-only Pi renderer/extension confinement', verdict: scan.status === 0 ? 'PASS' : 'FAIL', evidence: `static-scan: ${scan.stdout.trim() || scan.stderr.trim()}; adapters use only the public hooks the scan allows` },
};
const runtimeGates: [GateName, string][] = [
  ['G6', 'Behavior/model/tool/session preservation'],
  ['G7', 'Install/select/reload/uninstall lifecycle'],
  ['G8', 'Width/Unicode/terminal display fidelity'],
  ['G9', 'Fail-closed robustness and composability'],
];
for (const [gate, scope] of runtimeGates) {
  const r = result(gate);
  gates[gate] = { scope, verdict: r.verdict, evidence: `results/${gate.toLowerCase()}.json: ${r.summary}` };
}

const hashed: string[] = [];
const walk = (dir: string) => {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(ansi|json)$/.test(name)) hashed.push(`${createHash('sha256').update(readFileSync(p)).digest('hex')}  ${relative(dev, p)}`);
  }
};
walk(join(dev, 'captures'));
walk(join(dev, 'results'));
hashed.push(
  `${createHash('sha256')
    .update(readFileSync(join(dev, '../themes/claude-default-dark.json')))
    .digest('hex')}  ../themes/claude-default-dark.json`,
);
writeFileSync(join(dev, 'results/SHA256SUMS'), `${hashed.filter((l) => !l.endsWith('results/SHA256SUMS')).join('\n')}\n`);
const others = Object.values(gates).map((g) => g.verdict);
const referenceDirs = ['claude', 'claude-w40', 'claude-w80', 'claude-w200'];
const reference = referenceDirs
  .flatMap((d) =>
    readdirSync(join(dev, 'captures', d))
      .filter((f) => f.endsWith('.ansi') || f === 'run.json')
      .sort()
      .map((f) => `captures/${d}/${f}`),
  )
  .map(
    (f) =>
      `${createHash('sha256')
        .update(readFileSync(join(dev, f)))
        .digest('hex')}  ${f}`,
  )
  .join('\n');
writeFileSync(join(dev, 'results/REFERENCE-SHA256SUMS'), `${reference}\n`);
const approvedPath = join(dev, 'results/APPROVED-SHA256SUMS');
gates.G10 = {
  scope: 'Reproducible capture hashes and audit',
  verdict: g10Verdict({ others, generated: `${reference}\n`, approved: existsSync(approvedPath) ? readFileSync(approvedPath, 'utf8') : undefined }),
  evidence: `reference captures results/REFERENCE-SHA256SUMS (${reference.split('\n').length} files) against the reviewer-approved results/APPROVED-SHA256SUMS (${existsSync(approvedPath) ? 'present' : 'absent: no review recorded'}); all outputs in results/SHA256SUMS (${hashed.length} files); no CI logs; requires every other gate PASS`,
};
const release = Object.values(gates).every((g) => g.verdict === 'PASS') ? 'PASS' : 'BLOCKED';

const roleVerdict = (role: ThemeToken): string => {
  const m = mapping[role];
  if (m?.class === 'pi-only') return 'NOT_APPLICABLE';
  if (g4Gate.stale) return 'INCONCLUSIVE';
  const v = g4.byRole[role];
  if (!v) return 'INCONCLUSIVE';
  return v.FAIL ? 'FAIL' : v.INCONCLUSIVE || !v.PASS ? 'INCONCLUSIVE' : 'PASS';
};
const csvPath = join(dev, 'crosswalk.csv');
const roleTally: Record<string, number> = {};
const csv = readCrosswalk(csvPath).map((row) => {
  const role = parseRole(row.pi_role);
  const m = mapping[role];
  const parity_status = roleVerdict(role);
  roleTally[parity_status] = (roleTally[parity_status] ?? 0) + 1;
  return {
    ...row,
    mapping_class: m?.class ?? 'unknown',
    public_renderer_required: String(m?.class === 'renderer-required'),
    reference_rgb: m?.source === 'capture' ? (m.value ?? '') : '',
    actual_rgb: String(theme[role] ?? ''),
    parity_status,
  };
});
writeCrosswalk(csvPath, csv);

lock.test_results = Object.fromEntries(Object.entries(gates).map(([g, v]) => [g, v.verdict]));
lock.inventory.reference_covered_roles = Object.values(mapping).filter((m) => m.source === 'capture').length;
lock.inventory.verified_comparable_surfaces = g4.total.PASS;
lock.release_decision = release;
lock.release_reason =
  release === 'PASS'
    ? 'All gates PASS'
    : `Gates not passing: ${Object.entries(gates)
        .filter(([, g]) => g.verdict !== 'PASS')
        .map(([k, g]) => `${k} ${g.verdict}`)
        .join(', ')}`;
lock.$comment = 'Reference lock and verification manifest, regenerated by scripts/lock.mjs and scripts/report.ts from recorded artifacts.';
writeFileSync(join(dev, 'reference-lock.json'), `${JSON.stringify(lock, null, 2)}\n`);

const count = (c: string) => classes.filter((x) => x === c).length;
const measured = measuredSummary(mapping, g4Gate.stale ? {} : g4.byRole);
const md = `# Appearance parity conformance report

**Reference:** Claude Code v${lock.target.version}, built-in \`dark\`
**Host:** Pi Coding Agent v${lock.host.version}
**Terminal:** ${lock.terminal.emulator} ${lock.terminal.emulator_version}, ${lock.terminal.operating_system}, ${lock.terminal.width_columns}x${lock.terminal.height_rows}, TERM=${lock.terminal.TERM}, COLORTERM=${lock.terminal.COLORTERM}
**Assessment:** **${release === 'PASS' ? 'PASS' : 'BLOCKED'}**

Generated by \`development/scripts/report.ts\` from the artifacts under \`development/results/\` and \`development/captures/\`. Do not edit by hand.

| Gate | Scope | Result | Evidence |
|---|---|---|---|
${Object.entries(gates)
  .map(([g, v]) => `| ${g} | ${v.scope} | ${v.verdict} | ${v.evidence.replace(/\|/g, '/')} |`)
  .join('\n')}

## Role ledger

${Object.keys(mapping).length} Pi roles: ${count('measured')} measured, ${count('renderer-required')} renderer-required, ${count('unmappable')} unmappable, ${count('pi-only')} pi-only. Per-role G4 status: ${Object.entries(roleTally)
  .map(([k, n]) => `${n} ${k}`)
  .join(', ')}. See \`crosswalk.csv\` and \`theme-provenance.json\`.

Roles blocking parity: ${blocking.map(([r, m]) => `\`${r}\` (${m.class})`).join(', ') || 'none'}.

## Claims

**Claim allowed:** ${release === 'PASS' ? 'Claude Code default-dark parity for the pinned versions and terminal.' : g4Gate.stale ? 'A Pi-native theme package. No color claim: the G4 results no longer match the current package, theme, or captures.' : `A Pi-native theme package. Of ${measured.total} measured roles, ${measured.exact} match the pinned Claude Code captures exactly on every compared text-aligned cell, ${measured.mismatched} mismatch, and ${measured.uncompared} have no exact comparison yet. ${g4.total.PASS} of ${g4.total.PASS + g4.total.FAIL + g4.total.INCONCLUSIVE} cited observations are exact.`}
**Claim prohibited:** ${release === 'PASS' ? 'Parity on any other version, terminal, or color mode.' : '100% Claude Code visual/default-theme parity has been implemented or certified.'}
`;
writeFileSync(join(dev, 'PARITY_REPORT.md'), md);
console.log(JSON.stringify({ release, gates: lock.test_results }));
