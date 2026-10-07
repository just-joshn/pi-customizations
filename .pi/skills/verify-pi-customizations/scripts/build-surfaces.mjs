#!/usr/bin/env node
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const DEFAULT_MATRIX = join(ROOT, 'docs/user-perspective-testing/surface-matrix.md');
const DEFAULT_OUT = join(ROOT, 'docs/user-perspective-testing/surfaces.tsv');
// Reconnaissance counted 432. The pi-s50 install row conflated "the extension and its skill load"
// with "the declared bin is a shell command", which behave differently, so it was split into
// S50-INSTALL-1 and S50-INSTALL-2 during the sweep. Raising this number is a scope decision, so it is
// deliberately explicit rather than derived from the inventory it is meant to check.
const PROGRAM_SURFACES = 433;

const COLUMNS = ['surface_id', 'package', 'kind', 'name', 'trigger', 'expected', 'source', 'tier', 'veto'];
const PACKAGE_HEADER = ['Surface ID', 'Kind', 'Exact name/identifier', 'User trigger', 'Observable result', 'Source file:line', 'Notes'];
const CROSS_HEADER = ['Surface ID', 'Kind', 'Exact name/identifier', 'Packages that touch it', 'Source file:line', 'Notes'];
const SURFACE_ID = /^[A-Z][A-Z0-9]*(?:-[A-Z0-9]+)*$/;
const KINDS = new Set(['command', 'tool', 'event-hook', 'ui-widget', 'ui-notification', 'skill', 'prompt-template', 'agent', 'config-file', 'env-var', 'install-side-effect', 'theme', 'provider', 'virtual-model', 'mcp-server']);
const CROSS_KINDS = new Set(['env-var', 'config-file', 'process']);
// A kind's tier is the claim its row makes, not the thing it names. Registration claims ("this
// exists and is named this") are T1 and an enumeration receipt is enough; anything that does or
// changes something is T2 and needs a receipt that observed the behaviour. T3 overrides both.
const DISCOVERY_KINDS = new Set(['skill', 'prompt-template', 'agent', 'theme', 'provider', 'virtual-model', 'mcp-server', 'install-side-effect']);
const BEHAVIOUR_KINDS = new Set(['command', 'tool', 'event-hook', 'ui-widget', 'ui-notification', 'config-file', 'env-var']);

const PACKAGE_SECTIONS = {
  'pi-pstack': 'extensions/pi-pstack',
  'pi-anthropic-oauth': 'extensions/pi-anthropic-oauth',
  'pi-antigravity-oauth': 'extensions/pi-antigravity-oauth',
  'pi-xai-oauth': 'extensions/pi-xai-oauth',
  'pi-caveman': 'extensions/pi-caveman',
  'pi-s50': 'extensions/pi-s50',
  'pi-tui-skin': 'extensions/pi-tui-skin',
  'pi-one-dark-pro-theme': 'extensions/pi-one-dark-pro-theme',
};

const GROUP_MEMBERS = {
  'PS-SKILL-GROUP': { kind: 'skill', member: 'skill-dirs', roots: ['extensions/pi-pstack/skills', 'extensions/pi-pstack/host/skills'] },
  'PS-PROMPT-GROUP': { kind: 'prompt-template', member: 'markdown', roots: ['extensions/pi-pstack/prompts', 'extensions/pi-pstack/host/prompts'] },
  'PS-AGENT-GROUP': { kind: 'agent', member: 'pstack-agents' },
  'CV-SKILL-GROUP': { kind: 'skill', member: 'skill-dirs', roots: ['extensions/pi-caveman/skills'] },
  'CV-PROMPT-GROUP': { kind: 'prompt-template', member: 'markdown', roots: ['extensions/pi-caveman/prompts'] },
  'CV-AGENT-GROUP': { kind: 'agent', member: 'markdown', roots: ['extensions/pi-caveman/agents'] },
};

function idRange(prefix, start, end) {
  const ids = [];
  for (let index = start; index <= end; index += 1) ids.push(`${prefix}-${index}`);
  return ids;
}

// The T3 roll-up the program frames in framing-and-design.md: surfaces that need a deep-flow
// driver (TUI capture, restart/replay, dialog bridge, OAuth, cancellation, timers, routines,
// child sessions, remote placement) rather than a registration enumeration.
const T3_BY_CATEGORY = {
  'TUI rendering': [...idRange('TS-RENDER', 1, 8), ...idRange('TS-UI', 1, 7), ...idRange('TS-EVT', 1, 7), ...idRange('PS-UI', 1, 4), 'PS-UI-18', 'CV-UI-1'],
  'restart and branch persistence': ['PS-EVT-3', 'PS-EVT-4', 'PS-EVT-6', 'PS-EVT-7', 'PS-EVT-14', 'PS-EVT-15', 'PS-EVT-21', 'PS-EVT-25', 'PS-EVT-42', 'PS-EVT-43', 'CV-EVT-1', 'CV-EVT-2'],
  'interactive dialogs': ['PS-TOOL-11', 'PS-TOOL-26', 'PS-TOOL-36', 'PS-UI-15', 'PS-UI-16', 'PS-UI-17', 'PS-UI-18', 'S50-EVT-1', 'S50-UI-2'],
  'OAuth login and refresh': ['AN-PROV-1', 'AN-CRED-1', 'AG-PROV-1', 'AG-CRED-1', 'XA-PROV-1', 'AG-CMD-1'],
  'provider failure and cancellation': ['PS-TOOL-15', 'PS-EVT-19', 'PS-EVT-20', 'PS-EVT-22', 'PS-EVT-45'],
  'timers and subscriptions': ['PS-TOOL-3', 'PS-TOOL-4', 'PS-TOOL-5', 'PS-TOOL-6', 'PS-TOOL-7', 'PS-TOOL-8', 'PS-CFG-5', 'PS-ENV-2', 'PS-ENV-3', 'PS-ENV-23'],
  routines: ['PS-TOOL-9', 'PS-TOOL-10', 'PS-TOOL-11', 'PS-TOOL-12', 'PS-CFG-6'],
  subagents: [
    ...idRange('PS-TOOL', 13, 18),
    ...idRange('PS-TOOL', 28, 38),
    'PS-CMD-5',
    'PS-CMD-6',
    'PS-CMD-7',
    'PS-CMD-9',
    'PS-CMD-10',
    ...idRange('PS-EVT', 14, 20),
    ...idRange('PS-EVT', 22, 28),
    ...idRange('PS-EVT', 40, 41),
    'PS-CFG-7',
    'PS-CFG-11',
    'PS-CFG-12',
    'PS-ENV-8',
    'PS-ENV-12',
    'PS-ENV-16',
    'PS-ENV-20',
    'PS-ENV-21',
    'CV-TOOL-2',
    'CV-TOOL-3',
  ],
  'cloud placement': ['PS-CMD-11', 'PS-TOOL-13', 'PS-TOOL-17', 'PS-TOOL-18', 'PS-CFG-4', 'PS-CFG-7', 'PS-EVT-27', 'PS-EVT-42', 'PS-EVT-43', 'PS-EVT-44', 'PS-ENV-4', 'PS-ENV-5', 'PS-ENV-16', 'PS-ENV-24'],
};
const T3_IDS = new Set(Object.values(T3_BY_CATEGORY).flat());

function parseArgs(argv) {
  const options = { matrix: DEFAULT_MATRIX, out: DEFAULT_OUT };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg !== '--matrix' && arg !== '--out') {
      throw new Error(`unknown argument '${arg}'\nusage: build-surfaces.mjs [--matrix <surface-matrix.md>] [--out <surfaces.tsv>]`);
    }
    const value = argv[index + 1];
    if (!value) throw new Error(`${arg} requires a path`);
    options[arg.slice(2)] = resolve(value);
    index += 1;
  }
  return options;
}

function splitSections(text) {
  const sections = [];
  let current = null;
  const lines = text.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (line.startsWith('## ')) {
      if (current) sections.push(current);
      current = { title: line.slice(3).trim(), lines: [] };
    } else if (current) {
      current.lines.push({ text: line, line: index + 1 });
    }
  }
  if (current) sections.push(current);
  return sections;
}

function splitRow(text, line) {
  const cells = [];
  let cell = '';
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '\\' && text[index + 1] === '|') {
      cell += '|';
      index += 1;
      continue;
    }
    if (char === '|') {
      cells.push(cell);
      cell = '';
      continue;
    }
    cell += char;
  }
  cells.push(cell);
  if (cells[0].trim() !== '' || cells.at(-1).trim() !== '') {
    throw new Error(`surface-matrix.md:${line}: table row does not start and end with '|': ${text.trim()}`);
  }
  return cells.slice(1, -1).map((value) => value.trim());
}

function parseTable(section, expectedHeader) {
  const rows = [];
  let header = null;
  for (const { text, line } of section.lines) {
    const trimmed = text.trim();
    if (!header) {
      if (trimmed.startsWith('| Surface ID |')) {
        header = splitRow(trimmed, line);
        if (header.length !== expectedHeader.length || header.some((cell, index) => cell !== expectedHeader[index])) {
          throw new Error(`surface-matrix.md:${line}: section '${section.title}' has an unexpected table header: ${JSON.stringify(header)}`);
        }
      }
      continue;
    }
    if (trimmed === '' || !trimmed.startsWith('|')) {
      if (rows.length > 0) break;
      continue;
    }
    const cells = splitRow(trimmed, line);
    if (cells.every((cell) => /^:?-{2,}:?$/.test(cell))) continue;
    if (cells.length !== header.length) {
      throw new Error(`surface-matrix.md:${line}: row has ${cells.length} cells, expected ${header.length}: ${trimmed}`);
    }
    rows.push({ cells, line, raw: trimmed });
  }
  if (!header) throw new Error(`section '${section.title}' has no surface table`);
  if (rows.length === 0) throw new Error(`section '${section.title}' has an empty surface table`);
  return rows;
}

function statedTotal(section) {
  const index = section.lines.findIndex((entry) => entry.text.startsWith('Summary:'));
  if (index === -1) throw new Error(`section '${section.title}' has no Summary line`);
  const paragraph = [];
  for (let cursor = index; cursor < section.lines.length; cursor += 1) {
    const text = section.lines[cursor].text.trim();
    if (text === '') break;
    paragraph.push(text);
  }
  const sentence = paragraph
    .join(' ')
    .replace(/^Summary:\s*/, '')
    .split(/\.\s+(?=[A-Z`(])/)[0];
  const parts = splitTopLevel(sentence, '+');
  let total = 0;
  for (const part of parts) {
    const match = /^\s*(\d+)\b/.exec(part);
    if (!match) throw new Error(`surface-matrix.md:${section.lines[index].line}: cannot parse summary term '${part.trim()}' in section '${section.title}'`);
    total += Number(match[1]);
  }
  return total;
}

function splitTopLevel(text, separator) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;
    else if (char === separator && depth === 0) {
      parts.push(text.slice(start, index));
      start = index + 1;
    }
  }
  parts.push(text.slice(start));
  return parts;
}

function packageForSection(title) {
  if (PACKAGE_SECTIONS[title]) return PACKAGE_SECTIONS[title];
  if (/^skills\b/.test(title)) return 'skills';
  throw new Error(`unknown H2 section '${title}': map it to a package before generating`);
}

function checkSurfaceCells(surfaceId, kind, name, trigger, expected, source, line, raw) {
  const problem =
    (!SURFACE_ID.test(surfaceId) && `invalid surface id '${surfaceId}'`) ||
    (!KINDS.has(kind) && `unknown kind '${kind}'`) ||
    (!name && 'name is empty') ||
    (!trigger && 'trigger is empty') ||
    (!expected && 'expected is empty') ||
    (!source && 'source is empty');
  if (problem) throw new Error(`surface-matrix.md:${line}: ${problem}: ${raw}`);
  if (surfaceId.endsWith('-GROUP') && !GROUP_MEMBERS[surfaceId]) {
    throw new Error(`surface-matrix.md:${line}: no member source is defined for group '${surfaceId}': ${raw}`);
  }
}

function parsePackageSection(section, packagePath) {
  return parseTable(section, PACKAGE_HEADER).map(({ cells, line, raw }) => {
    const [surfaceId, kind, name, trigger, expected, source] = cells;
    checkSurfaceCells(surfaceId, kind, name, trigger, expected, source, line, raw);
    return { surfaceId, kind, name, trigger, expected, source, package: packagePath, line };
  });
}

function parseCrossCutting(section) {
  return parseTable(section, CROSS_HEADER).map(({ cells, line, raw }) => {
    const [surfaceId, kind, name, , source] = cells;
    if (!SURFACE_ID.test(surfaceId)) throw new Error(`surface-matrix.md:${line}: invalid cross-cutting id '${surfaceId}': ${raw}`);
    if (!CROSS_KINDS.has(kind)) throw new Error(`surface-matrix.md:${line}: unknown cross-cutting kind '${kind}': ${raw}`);
    if (!name || !source) throw new Error(`surface-matrix.md:${line}: cross-cutting row is missing name or source: ${raw}`);
    return { surfaceId, kind, line };
  });
}

function skillDirs(root) {
  if (!existsSync(root)) throw new Error(`member source directory does not exist: ${root}`);
  const names = readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();
  for (const name of names) {
    if (!existsSync(join(root, name, 'SKILL.md'))) throw new Error(`skill directory without SKILL.md: ${join(root, name)}`);
  }
  return names;
}

function markdownNames(root) {
  if (!existsSync(root)) throw new Error(`member source directory does not exist: ${root}`);
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name.slice(0, -3))
    .sort();
}

function pstackAgentMembers() {
  const builtinText = readFileSync(join(ROOT, 'extensions/pi-pstack/src/subagents/builtin-agents.ts'), 'utf8');
  const personaText = readFileSync(join(ROOT, 'extensions/pi-pstack/src/personas.ts'), 'utf8');
  const generalPurpose = /generalPurposeName\s*=\s*'([^']+)'/.exec(builtinText)?.[1];
  const builtin = generalPurpose ? [generalPurpose, ...[...builtinText.matchAll(/name:\s*'([^']+)'/g)].map((match) => match[1])] : [];
  const aliases = new Map([
    ['generalPurpose', 'general-purpose'],
    ['Comment Sicko', 'comment-sicko'],
  ]);
  const personaKeys = [...personaText.matchAll(/^\s*\['([^']+)',/gm)].map((match) => match[1]);
  const members = [...builtin];
  for (const key of personaKeys) {
    const name = aliases.get(key) ?? key;
    if (!members.includes(name)) members.push(name);
  }
  return members;
}

function resolveGroupMembers(group) {
  const resolver = GROUP_MEMBERS[group.surfaceId];
  if (resolver.kind !== group.kind) throw new Error(`group ${group.surfaceId}: kind '${group.kind}' does not match its member source kind '${resolver.kind}'`);
  if (resolver.member === 'skill-dirs') return resolver.roots.flatMap((dir) => skillDirs(join(ROOT, dir)));
  if (resolver.member === 'markdown') return resolver.roots.flatMap((dir) => markdownNames(join(ROOT, dir)));
  if (resolver.member === 'pstack-agents') return pstackAgentMembers();
  throw new Error(`group ${group.surfaceId}: unknown member collector '${resolver.member}'`);
}

function vetoFor(surfaceId, expected, memberName) {
  const text = expected
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.;]+$/, '');
  if (!text) throw new Error(`surface ${surfaceId}: no expected result, so no veto can be derived`);
  const label = memberName ? ` for ${memberName}` : '';
  const sameList = /^Same list as (.+)$/i.exec(text);
  if (sameList) return `not observed${label}: output diverges from ${sameList[1]}`;
  const sameAs = /^Same as (.+?) for (.+)$/i.exec(text);
  if (sameAs) return `not observed${label}: ${sameAs[2]} does not match ${sameAs[1]}`;
  return `not observed${label}: ${text}`;
}

function tierFor(surfaceId, kind) {
  if (T3_IDS.has(surfaceId)) return 'T3';
  if (DISCOVERY_KINDS.has(kind)) return 'T1';
  if (BEHAVIOUR_KINDS.has(kind)) return 'T2';
  throw new Error(`surface ${surfaceId}: kind '${kind}' has no claim scope; add it to DISCOVERY_KINDS or BEHAVIOUR_KINDS`);
}

function surfaceRow(row) {
  return {
    surface_id: row.surfaceId,
    package: row.package,
    kind: row.kind,
    name: row.name,
    trigger: row.trigger,
    expected: row.expected,
    source: row.source,
    tier: tierFor(row.surfaceId, row.kind),
    veto: vetoFor(row.surfaceId, row.expected),
  };
}

function memberId(prefix, index, width) {
  return `${prefix}-${String(index).padStart(width, '0')}`;
}

function memberRows(group) {
  const members = resolveGroupMembers(group);
  if (members.length === 0) throw new Error(`group ${group.surfaceId}: resolved to zero members`);
  const stated = /^(\d+)\b/.exec(group.name)?.[1];
  if (stated && Number(stated) !== members.length) {
    throw new Error(`group ${group.surfaceId}: inventory names ${stated} members but the real source has ${members.length}`);
  }
  const prefix = group.surfaceId.replace(/-GROUP$/, '');
  const width = String(members.length).length;
  return members.map((name, index) => {
    const surfaceId = memberId(prefix, index + 1, width);
    return {
      surface_id: surfaceId,
      package: group.package,
      kind: group.kind,
      name,
      trigger: group.trigger.replaceAll('<name>', name),
      expected: group.expected,
      source: group.source,
      tier: tierFor(surfaceId, group.kind),
      veto: vetoFor(surfaceId, group.expected, name),
    };
  });
}

function assertUniqueRows(rows) {
  const seen = new Map();
  for (const row of rows) {
    if (seen.has(row.surface_id)) throw new Error(`duplicate surface id ${row.surface_id} (${seen.get(row.surface_id)} and ${row.name})`);
    seen.set(row.surface_id, row.name);
  }
}

function assertT3Ids(rows) {
  const present = new Set(rows.map((row) => row.surface_id));
  for (const id of T3_IDS) {
    if (!present.has(id)) throw new Error(`T3 list names ${id}, which is not a surface in the inventory`);
  }
}

function toTsv(rows) {
  const lines = [COLUMNS.join('\t')];
  for (const row of rows) {
    const cells = COLUMNS.map((column) => row[column]);
    for (const cell of cells) {
      if (typeof cell !== 'string' || /[\t\r\n]/.test(cell)) {
        throw new Error(`surface ${row.surface_id}: cell contains a tab or newline: ${JSON.stringify(cell)}`);
      }
    }
    lines.push(cells.join('\t'));
  }
  return `${lines.join('\n')}\n`;
}

function build(options) {
  const sections = splitSections(readFileSync(options.matrix, 'utf8'));
  const rows = [];
  const report = [];
  let crossCutting = 0;
  for (const section of sections) {
    if (section.title.startsWith('Cross-cutting')) {
      crossCutting = parseCrossCutting(section).length;
      continue;
    }
    if (section.title.startsWith('Environment-sensitive')) continue;
    const packagePath = packageForSection(section.title);
    const stated = statedTotal(section);
    const expanded = parsePackageSection(section, packagePath).flatMap((row) => (row.surfaceId.endsWith('-GROUP') ? memberRows(row) : [surfaceRow(row)]));
    if (expanded.length !== stated) {
      throw new Error(`section '${section.title}': inventory states ${stated} surfaces but its table expands to ${expanded.length}`);
    }
    report.push({ package: packagePath, observed: expanded.length, stated });
    rows.push(...expanded);
  }
  const statedSum = report.reduce((sum, entry) => sum + entry.stated, 0);
  if (statedSum !== PROGRAM_SURFACES) throw new Error(`inventory states ${statedSum} package surfaces but the program scope is ${PROGRAM_SURFACES}`);
  if (rows.length !== PROGRAM_SURFACES) throw new Error(`built ${rows.length} package rows but the program scope is ${PROGRAM_SURFACES}`);
  assertUniqueRows(rows);
  assertT3Ids(rows);
  const tsv = toTsv(rows);
  mkdirSync(dirname(options.out), { recursive: true });
  writeFileSync(options.out, tsv);
  return { rows, report, crossCutting, out: options.out };
}

function printReport({ rows, report, crossCutting, out }) {
  const width = Math.max(...report.map((entry) => entry.package.length), 'total'.length);
  console.log(`${'package'.padEnd(width)}  rows  inventory`);
  for (const entry of report) {
    console.log(`${entry.package.padEnd(width)}  ${String(entry.observed).padStart(4)}  ${String(entry.stated).padStart(9)}`);
  }
  const observed = report.reduce((sum, entry) => sum + entry.observed, 0);
  const stated = report.reduce((sum, entry) => sum + entry.stated, 0);
  console.log(`${'total'.padEnd(width)}  ${String(observed).padStart(4)}  ${String(stated).padStart(9)}`);
  console.log(`cross-cutting rows: ${crossCutting} (aliases of package surfaces, not unit rows)`);
  const display = relative(ROOT, out);
  console.log(`wrote ${display.startsWith('..') ? out : display} with ${rows.length} data rows + header`);
}

try {
  printReport(build(parseArgs(process.argv.slice(2))));
} catch (error) {
  console.error(`build-surfaces: ${error.message}`);
  process.exitCode = 1;
}
