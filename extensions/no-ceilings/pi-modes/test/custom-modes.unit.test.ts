import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, onTestFinished } from 'vitest';
import { buildCustomModeInstructions, findReferencedCustomModes, listCustomModes, resolveSkillFileReference } from '../src/custom-modes.ts';
import { DEFAULT_MODE_COLOR_ID, formatCustomModeBadge, isModeColorName, normalizeModeColorId, normalizeModeIcon, resolveModeColorToken } from '../src/mode-colors.ts';
import { formatSkillBlock, parseSkillAppearance, readSkillDocument, writeSkillAppearance } from '../src/skill-frontmatter.ts';
import type { ActiveCustomMode, CustomModeSkill, PendingExitedCustomMode } from '../src/types.ts';

const SKILL_PATH = '/repo/.pi/skills/reviewer/SKILL.md';
const SKILL_BODY = 'Review every diff before it ships.';
const VALID_COLOR_NAMES = ['default', 'brand', 'cyan', 'green', 'blue', 'purple', 'magenta', 'orange', 'yellow', 'red', '  RED  '] as const;
const ENTRY_INSTRUCTION = `The user has entered Reviewer custom mode. Follow the skill instructions in ${JSON.stringify(SKILL_PATH)} until the user exits or switches modes. Do not drift back to default agent behavior.`;
const ACTIVE_INSTRUCTION = [
  "Reminder: you are still in Reviewer mode. Follow that mode's skill on this turn. Do not drop it because the request looks small or you already have context. Do not drift back to default agent behavior.",
  `If you cannot state the mode's hard rules, read ${JSON.stringify(SKILL_PATH)} before acting.`,
].join(' ');
const EXIT_INSTRUCTION = "The user has exited Reviewer custom mode. Stop following that mode's skill. Continue without those constraints.";

function makeSkill(overrides: Partial<CustomModeSkill> = {}): CustomModeSkill {
  return {
    id: 'reviewer',
    label: 'Reviewer',
    filePath: SKILL_PATH,
    description: 'Reviews diffs',
    icon: undefined,
    colorId: DEFAULT_MODE_COLOR_ID,
    body: SKILL_BODY,
    ...overrides,
  };
}

function makeActive(overrides: Partial<ActiveCustomMode> = {}): ActiveCustomMode {
  return { ...makeSkill(), lifecycle: 'entered', ...overrides };
}

function makeTempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function writeSkillFile(prefix: string, contents: string): string {
  const dir = makeTempDir(prefix);
  const skillPath = join(dir, 'SKILL.md');
  writeFileSync(skillPath, contents, 'utf-8');
  return skillPath;
}

describe('normalizeModeColorId', () => {
  it('maps every source color alias onto the resolved palette', () => {
    expect(normalizeModeColorId('default')).toBe('cyan');
    expect(normalizeModeColorId('brand')).toBe('cyan');
    expect(normalizeModeColorId('orange')).toBe('yellow');
    expect(normalizeModeColorId('cyan')).toBe('cyan');
    expect(normalizeModeColorId('green')).toBe('green');
    expect(normalizeModeColorId('blue')).toBe('blue');
    expect(normalizeModeColorId('purple')).toBe('purple');
    expect(normalizeModeColorId('magenta')).toBe('magenta');
    expect(normalizeModeColorId('yellow')).toBe('yellow');
    expect(normalizeModeColorId('red')).toBe('red');
    expect(normalizeModeColorId('  red  ')).toBe('red');
  });

  it('falls back to cyan for unknown, empty, and non-string colors', () => {
    expect(normalizeModeColorId('chartreuse')).toBe('cyan');
    expect(normalizeModeColorId('')).toBe('cyan');
    expect(normalizeModeColorId(undefined)).toBe('cyan');
    expect(normalizeModeColorId(42)).toBe('cyan');
    expect(normalizeModeColorId(null)).toBe('cyan');
  });
});

describe('resolveModeColorToken', () => {
  it('resolves each color to a distinct terminal theme token', () => {
    const tokens = ['green', 'cyan', 'blue', 'purple', 'magenta', 'yellow', 'red'].map((color) => resolveModeColorToken(normalizeModeColorId(color)));
    expect(new Set(tokens).size).toBe(tokens.length);
    expect(resolveModeColorToken(undefined)).toBe(resolveModeColorToken('cyan'));
    expect(resolveModeColorToken('red')).toBe('error');
    expect(resolveModeColorToken('yellow')).toBe('warning');
    expect(resolveModeColorToken('green')).toBe('success');
  });
});

describe('normalizeModeIcon', () => {
  it('normalizes icons from any frontmatter value', () => {
    expect(normalizeModeIcon(' ⚡ ')).toBe('⚡');
    expect(normalizeModeIcon('   ')).toBeUndefined();
    expect(normalizeModeIcon(undefined)).toBeUndefined();
    expect(normalizeModeIcon(7)).toBeUndefined();
  });
});

describe('formatCustomModeBadge', () => {
  it('renders the icon, label, and exit hint', () => {
    expect(formatCustomModeBadge('Reviewer', '⚡')).toBe('⚡ Reviewer (ctrl+alt+m to exit)');
  });

  it('renders the label and exit hint when the mode has no icon', () => {
    expect(formatCustomModeBadge('Reviewer', undefined)).toBe('Reviewer (ctrl+alt+m to exit)');
  });
});

describe('isModeColorName', () => {
  it.for(VALID_COLOR_NAMES)('accepts %j', (name) => {
    expect(isModeColorName(name)).toBe(true);
  });

  it.for(['chartreuse', '', undefined])('rejects %j', (name) => {
    expect(isModeColorName(name)).toBe(false);
  });
});

describe('resolveSkillFileReference', () => {
  it('accepts hydrated SKILL.md paths and direct files in a skills directory', () => {
    expect(resolveSkillFileReference(SKILL_PATH)).toBe(SKILL_PATH);
    expect(resolveSkillFileReference('  /repo/SKILL.md  ')).toBe('/repo/SKILL.md');
    expect(resolveSkillFileReference('/repo/.pi/skills/reviewer.md')).toBe('/repo/.pi/skills/reviewer.md');
    expect(resolveSkillFileReference('  /repo/.pi/skills/reviewer.md  ')).toBe('/repo/.pi/skills/reviewer.md');
    expect(resolveSkillFileReference('/repo/skills/reviewer/README.md')).toBeUndefined();
    expect(resolveSkillFileReference('/repo/.pi/skills/reviewer/notes.md')).toBeUndefined();
    expect(resolveSkillFileReference('unhydrated:SKILL.md')).toBeUndefined();
    expect(resolveSkillFileReference('custom-mode:reviewer')).toBeUndefined();
    expect(resolveSkillFileReference('   ')).toBeUndefined();
  });
});

describe('formatSkillBlock', () => {
  it('formats skill bodies exactly like Pi expands /skill commands', () => {
    const block = formatSkillBlock({ name: 'reviewer', filePath: SKILL_PATH, baseDir: '/repo/.pi/skills/reviewer', body: SKILL_BODY });
    expect(block).toBe(`<skill name="reviewer" location="${SKILL_PATH}">\nReferences are relative to /repo/.pi/skills/reviewer.\n\n${SKILL_BODY}\n</skill>`);
  });
});

describe('buildCustomModeInstructions', () => {
  it('states the entry instruction with the verbatim source wording', () => {
    expect(buildCustomModeInstructions({ active: makeActive(), pendingExited: undefined })).toBe(ENTRY_INSTRUCTION);
  });

  it('states the active reminder with the verbatim source wording', () => {
    expect(buildCustomModeInstructions({ active: makeActive({ lifecycle: 'active' }), pendingExited: undefined })).toBe(ACTIVE_INSTRUCTION);
  });

  it('states the exit instruction with the verbatim source wording', () => {
    const exited: PendingExitedCustomMode = { id: 'reviewer', label: 'Reviewer' };
    expect(buildCustomModeInstructions({ active: undefined, pendingExited: exited })).toBe(EXIT_INSTRUCTION);
  });

  it('falls back to the attached-skill wording on entry when the skill file is not a SKILL.md path', () => {
    expect(buildCustomModeInstructions({ active: makeActive({ filePath: 'custom-mode:reviewer' }), pendingExited: undefined })).toContain('Follow the attached skill until the user exits');
  });

  it('falls back to the attached-skill wording in the reminder when the skill file is not a SKILL.md path', () => {
    expect(buildCustomModeInstructions({ active: makeActive({ lifecycle: 'active', filePath: 'custom-mode:reviewer' }), pendingExited: undefined })).toContain('read the skill before acting');
  });

  it('names a direct skills markdown file in the entry instruction', () => {
    const filePath = '/repo/.pi/skills/reviewer.md';
    const entered = buildCustomModeInstructions({ active: makeActive({ filePath }), pendingExited: undefined });
    expect(entered).toContain(`Follow the skill instructions in ${JSON.stringify(filePath)}`);
  });

  it('names a direct skills markdown file in the later reminder', () => {
    const filePath = '/repo/.pi/skills/reviewer.md';
    const reminder = buildCustomModeInstructions({ active: makeActive({ filePath, lifecycle: 'active' }), pendingExited: undefined });
    expect(reminder).toContain(`read ${JSON.stringify(filePath)} before acting`);
  });

  it('joins the exit notice and the entry instruction when switching modes', () => {
    const exited: PendingExitedCustomMode = { id: 'planner', label: 'Planner' };
    const joined = buildCustomModeInstructions({ active: makeActive(), pendingExited: exited });
    expect(joined?.split('\n\n')).toHaveLength(2);
    expect(joined?.startsWith('The user has exited Planner custom mode.')).toBe(true);
  });

  it('skips the exit notice when re-entering the same mode', () => {
    expect(buildCustomModeInstructions({ active: makeActive(), pendingExited: { id: 'reviewer', label: 'Reviewer' } })).not.toContain('has exited');
  });

  it('returns undefined when no custom mode is active or pending', () => {
    expect(buildCustomModeInstructions({ active: undefined, pendingExited: undefined })).toBeUndefined();
  });
});

describe('parseSkillAppearance', () => {
  it('reads icon and color from frontmatter, defaulting the color to cyan', () => {
    expect(parseSkillAppearance({ icon: '⚡', color: 'magenta' })).toEqual({ icon: '⚡', colorId: 'magenta' });
    expect(parseSkillAppearance({})).toEqual({ icon: undefined, colorId: 'cyan' });
    expect(parseSkillAppearance({ color: 'orange' })).toEqual({ icon: undefined, colorId: 'yellow' });
    expect(parseSkillAppearance({ icon: '' })).toEqual({ icon: undefined, colorId: 'cyan' });
  });

  it('accepts the Agent Skills metadata container as a fallback', () => {
    expect(parseSkillAppearance({ metadata: { icon: '★', color: 'green' } })).toEqual({ icon: '★', colorId: 'green' });
    expect(parseSkillAppearance({ metadata: ['nope'] })).toEqual({ icon: undefined, colorId: 'cyan' });
  });
});

describe('findReferencedCustomModes', () => {
  const modes: readonly CustomModeSkill[] = [makeSkill(), makeSkill({ id: 'planner', label: 'Planner', filePath: '/repo/.pi/skills/planner/SKILL.md' })];

  it('finds skills referenced as /name tokens in a prompt', () => {
    expect(findReferencedCustomModes('please /reviewer this diff', modes).map((mode) => mode.id)).toEqual(['reviewer']);
    expect(findReferencedCustomModes('/planner plan the migration', modes).map((mode) => mode.id)).toEqual(['planner']);
  });

  it('ignores unknown skills, file paths, and word-internal slashes', () => {
    expect(findReferencedCustomModes('read src/index.ts then /nope', modes)).toEqual([]);
    expect(findReferencedCustomModes('open the docs at /reviewer.md', modes)).toEqual([]);
    expect(findReferencedCustomModes('read /reviewer/notes/before acting', modes)).toEqual([]);
    expect(findReferencedCustomModes('read /tmp please', [...modes, makeSkill({ id: 'tmp', label: 'tmp', filePath: '/repo/.pi/skills/tmp/SKILL.md' })])).toEqual([]);
    expect(findReferencedCustomModes('list /dev please', [...modes, makeSkill({ id: 'dev', label: 'dev', filePath: '/repo/.pi/skills/dev/SKILL.md' })])).toEqual([]);
    expect(findReferencedCustomModes('nothing to do here', modes)).toEqual([]);
  });

  it('matches a reference that ends a sentence', () => {
    expect(findReferencedCustomModes('Please use /reviewer. Then ship.', modes).map((mode) => mode.id)).toEqual(['reviewer']);
    expect(findReferencedCustomModes('/reviewer, /planner: go', modes).map((mode) => mode.id)).toEqual(['reviewer', 'planner']);
  });

  it('deduplicates repeated references and matches labels case-insensitively', () => {
    expect(findReferencedCustomModes('/reviewer and /Reviewer and /planner', modes).map((mode) => mode.id)).toEqual(['reviewer', 'planner']);
  });
});

describe('writeSkillAppearance', () => {
  it('adds icon and color frontmatter keys without touching the body', async () => {
    const skillPath = writeSkillFile('pi-modes-skill-', '---\nname: reviewer\ndescription: Reviews diffs\n---\n\nReview every diff.\n');

    await writeSkillAppearance(skillPath, { icon: '⚡', color: 'magenta' });
    const written = readFileSync(skillPath, 'utf-8');
    expect(written).toContain('icon: "⚡"');
    expect(written).toContain('color: "magenta"');
    expect(written).toContain('name: reviewer');
    expect(written).toContain('Review every diff.');
  });

  it('removes a cleared frontmatter key and keeps the remaining color', async () => {
    const skillPath = writeSkillFile('pi-modes-skill-clear-', '---\ncolor: "magenta"\nicon: "⚡"\nname: reviewer\ndescription: Reviews diffs\n---\n\nReview every diff.\n');

    await writeSkillAppearance(skillPath, { icon: '' });
    const cleared = readFileSync(skillPath, 'utf-8');
    expect(cleared).not.toContain('icon:');
    expect(cleared).toContain('color: "magenta"');
    expect(cleared).toContain('Review every diff.');
  });

  it('refuses to rewrite appearance outside a SKILL.md file', async () => {
    await expect(writeSkillAppearance('/tmp/notes.md', { icon: '⚡' })).rejects.toThrow('Refusing to write mode appearance');
  });

  it('replaces a folded color and drops its continuation without touching other frontmatter or the body', async () => {
    const skillPath = writeSkillFile('pi-modes-folded-', '---\nname: reviewer\ndescription: Reviews diffs\n# palette\ncolor: >-\n  blue\n---\nReview changes.\n');

    await writeSkillAppearance(skillPath, { color: 'red' });
    const written = readFileSync(skillPath, 'utf-8');
    expect(written).toContain('name: reviewer');
    expect(written).toContain('description: Reviews diffs');
    expect(written).toContain('# palette');
    expect(written).toContain('color: "red"');
    expect(written).not.toContain('blue');
    expect(written).toContain('Review changes.');

    const skill = await readSkillDocument(skillPath, 'reviewer');
    expect(skill.colorId).toBe('red');
    expect(skill.name).toBe('reviewer');
    expect(skill.body).toBe('Review changes.');
  });

  it('replaces a literal color block, including indented lines that look like keys', async () => {
    const skillPath = writeSkillFile('pi-modes-literal-', '---\ncolor: |\n  blue\n  still: here\nname: reviewer\n---\n\nBody stays.\n');

    await writeSkillAppearance(skillPath, { color: 'green' });
    const written = readFileSync(skillPath, 'utf-8');
    expect(written).toContain('color: "green"');
    expect(written).toContain('name: reviewer');
    expect(written).not.toContain('still:');
    expect(written).not.toContain('blue');
    expect(written).toContain('Body stays.');

    const skill = await readSkillDocument(skillPath, 'reviewer');
    expect(skill.colorId).toBe('green');
    expect(skill.name).toBe('reviewer');
    expect(skill.body).toBe('Body stays.');
  });

  it('removes a folded color without leaving the old continuation behind', async () => {
    const skillPath = writeSkillFile('pi-modes-clear-color-', '---\nname: reviewer\ndescription: Reviews diffs\ncolor: >-\n  blue\n---\nReview changes.\n');

    await writeSkillAppearance(skillPath, { color: '' });
    const written = readFileSync(skillPath, 'utf-8');
    expect(written).not.toContain('color:');
    expect(written).not.toContain('blue');
    expect(written).toContain('description: Reviews diffs');
    expect(written).toContain('Review changes.');

    const skill = await readSkillDocument(skillPath, 'reviewer');
    expect(skill.colorId).toBe('cyan');
    expect(skill.body).toBe('Review changes.');
  });

  it('creates frontmatter on a file that has none', async () => {
    const skillPath = writeSkillFile('pi-modes-no-frontmatter-', 'Review every diff.\n');

    await writeSkillAppearance(skillPath, { icon: '⚡', color: 'magenta' });
    expect(readFileSync(skillPath, 'utf-8')).toBe('---\ncolor: "magenta"\nicon: "⚡"\n---\n\nReview every diff.\n');
  });

  it('writes appearance into an empty frontmatter block', async () => {
    const skillPath = writeSkillFile('pi-modes-empty-frontmatter-', '---\n---');

    await writeSkillAppearance(skillPath, { icon: '⚡', color: 'magenta' });
    expect(readFileSync(skillPath, 'utf-8')).toBe('---\ncolor: "magenta"\nicon: "⚡"\n---');
  });

  it('preserves CRLF line endings when writing appearance', async () => {
    const skillPath = writeSkillFile('pi-modes-crlf-', '---\r\nname: reviewer\r\n---\r\n\r\nReview every diff.\r\n');

    await writeSkillAppearance(skillPath, { icon: '⚡', color: 'magenta' });
    expect(readFileSync(skillPath, 'utf-8')).toBe('---\r\ncolor: "magenta"\r\nicon: "⚡"\r\nname: reviewer\r\n---\r\n\r\nReview every diff.\r\n');
  });

  it('updates flow-style frontmatter and keeps the body', async () => {
    const skillPath = writeSkillFile('pi-modes-flow-', '---\n{name: reviewer, color: red, icon: "★"}\n---\n\nReview every diff.\n');

    await writeSkillAppearance(skillPath, { color: 'blue' });
    const written = readFileSync(skillPath, 'utf-8');
    expect(written).toContain('color: "blue"');
    expect(written).toContain('Review every diff.');

    const skill = await readSkillDocument(skillPath, 'reviewer');
    expect(skill.colorId).toBe('blue');
    expect(skill.body).toBe('Review every diff.');
  });

  it('updates a multi-line flow map', async () => {
    const skillPath = writeSkillFile('pi-modes-flow-multiline-', '---\n{name: reviewer,\n color: red}\n---\n\nReview every diff.\n');

    await writeSkillAppearance(skillPath, { color: 'blue' });
    const written = readFileSync(skillPath, 'utf-8');
    expect(written).toContain('color: "blue"');
    expect(written).toContain('Review every diff.');

    const skill = await readSkillDocument(skillPath, 'reviewer');
    expect(skill.colorId).toBe('blue');
  });

  it('updates a quoted color key without creating a duplicate', async () => {
    const skillPath = writeSkillFile('pi-modes-quoted-key-', '---\nname: reviewer\n"color": red\n---\n\nBody here.\n');

    await writeSkillAppearance(skillPath, { color: 'blue' });
    const written = readFileSync(skillPath, 'utf-8');
    expect(written).toContain('color: "blue"');
    expect(written).not.toContain('"color":');
    expect(written).toContain('Body here.');
  });

  it('preserves a BOM and keeps one frontmatter block', async () => {
    const skillPath = writeSkillFile('pi-modes-bom-', '\uFEFF---\nname: reviewer\ncolor: red\n---\n\nReview every diff.\n');

    await writeSkillAppearance(skillPath, { color: 'blue' });
    const written = readFileSync(skillPath, 'utf-8');
    expect(written.startsWith('\uFEFF---\n')).toBe(true);
    expect(written).toContain('color: "blue"');
    expect(written).toContain('Review every diff.');

    const skill = await readSkillDocument(skillPath, 'reviewer');
    expect(skill.colorId).toBe('blue');
    expect(skill.body).toBe('Review every diff.');
  });

  it('updates flow frontmatter that starts with a comment', async () => {
    const skillPath = writeSkillFile('pi-modes-flow-comment-', '---\n# appearance\n{name: reviewer, color: red}\n---\n\nReview every diff.\n');

    await writeSkillAppearance(skillPath, { color: 'blue' });
    const written = readFileSync(skillPath, 'utf-8');
    expect(written).toContain('# appearance');
    expect(written).toContain('color: "blue"');
    expect(written).toContain('Review every diff.');

    const skill = await readSkillDocument(skillPath, 'reviewer');
    expect(skill.colorId).toBe('blue');
  });

  it('writes color and icon on a skill Pi discovered as a direct markdown file and keeps the body', async () => {
    const dir = makeTempDir('pi-modes-direct-skill-');
    const skillPath = join(dir, '.pi', 'skills', 'reviewer.md');
    mkdirSync(join(dir, '.pi', 'skills'), { recursive: true });
    writeFileSync(skillPath, '---\nname: reviewer\ndescription: Reviews diffs before they ship\n---\n\nSINGLE_FILE_BODY. Review every diff.\n', 'utf-8');

    const modes = await listCustomModes([{ name: 'skill:reviewer', description: 'Reviews diffs before they ship', source: 'skill', sourceInfo: { path: skillPath } }]);
    expect(modes.map((mode) => mode.filePath)).toEqual([skillPath]);

    await writeSkillAppearance(skillPath, { color: 'green', icon: '★' }, modes[0]?.filePath);
    const written = readFileSync(skillPath, 'utf-8');
    expect(written).toContain('color: "green"');
    expect(written).toContain('icon: "★"');
    expect(written).toContain('name: reviewer');
    expect(written).toContain('description: Reviews diffs before they ship');
    expect(written).toContain('SINGLE_FILE_BODY. Review every diff.');

    const skill = await readSkillDocument(skillPath, 'reviewer');
    expect(skill.colorId).toBe('green');
    expect(skill.icon).toBe('★');
    expect(skill.body).toContain('SINGLE_FILE_BODY');
  });

  it('refuses to write a direct markdown skill that Pi did not discover', async () => {
    const dir = makeTempDir('pi-modes-undiscovered-');
    const skillPath = join(dir, '.pi', 'skills', 'reviewer.md');
    mkdirSync(join(dir, '.pi', 'skills'), { recursive: true });
    const original = '---\nname: reviewer\ndescription: Reviews diffs\n---\n\nSINGLE_FILE_BODY.\n';
    writeFileSync(skillPath, original, 'utf-8');

    await expect(writeSkillAppearance(skillPath, { color: 'green' })).rejects.toThrow('Refusing to write mode appearance');
    expect(readFileSync(skillPath, 'utf-8')).toBe(original);
  });
});
