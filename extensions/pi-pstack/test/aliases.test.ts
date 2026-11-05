import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { aliasInputResult, aliasTable, aliasTransform, packageSkillNames, skillReferences } from '../src/aliases.ts';
import { SKILLS_DIR } from '../src/paths.ts';

const names = new Set(['how', 'why', 'poteto-mode', 'principle-prove-it-works']);
const block = (name: string) => `<${name}>`;

describe('aliasTransform', () => {
  test.for([
    { input: '/how', expected: '/skill:how' },
    { input: '/how does the cache work?', expected: '/skill:how does the cache work?' },
    { input: '/poteto-mode fix the "drift" bug\nrepro first, then $1 and $@', expected: '/skill:poteto-mode fix the "drift" bug\nrepro first, then $1 and $@' },
    { input: '/how\nwhat owns retries?', expected: '/skill:how \nwhat owns retries?' },
    { input: '/principle-prove-it-works', expected: '/skill:principle-prove-it-works' },
  ])('rewrites $input to a native skill command (CMD-001)', ({ input, expected }) => {
    expect(aliasTransform(input, names, block)).toBe(expected);
  });

  test.for([
    { input: 'please /how this', expected: '/skill:how please /how this' },
    { input: ' /how leading space', expected: '/skill:how  /how leading space' },
    { input: 'design it.\n/how first', expected: '/skill:how design it.\n/how first' },
    { input: '/how? the cache', expected: '/skill:how /how? the cache' },
  ])('attaches a skill referenced after the start of $input, keeping the whole message (SKILL-REF-001)', ({ input, expected }) => {
    expect(aliasTransform(input, names, block)).toBe(expected);
  });

  test.for([
    { input: '/how retries /why', expected: '/skill:how <why>\n\nretries /why' },
    { input: 'compare /why and /how, then /why again', expected: '/skill:why <how>\n\ncompare /why and /how, then /why again' },
    { input: '/poteto-mode fix it. /how /why /how', expected: '/skill:poteto-mode <how>\n\n<why>\n\nfix it. /how /why /how' },
  ])('attaches every referenced skill once, in order of first reference, for $input (SKILL-REF-002)', ({ input, expected }) => {
    expect(aliasTransform(input, names, block)).toBe(expected);
  });

  test('leaves a message that starts with a prompt template to Pi, which expands the template only at the start (SKILL-REF-004)', () => {
    expect(aliasTransform('/mytpl hello /why', names, block, new Set(['mytpl']))).toBeUndefined();
  });

  test('skips a referenced skill whose file can no longer be read and keeps its text (SKILL-REF-003)', () => {
    const readable = (name: string) => (name === 'why' ? undefined : `<${name}>`);
    expect(aliasTransform('/how then /why', names, readable)).toBe('/skill:how then /why');
  });

  test.for([
    { input: '/skill:how what /why', why: 'already a native skill command' },
    { input: '/model', why: 'a Pi built-in' },
    { input: '/howdy partner', why: 'a longer word that only starts with a skill name' },
    { input: '/unknown thing', why: 'not a shipped skill' },
    { input: 'see src/how/x and a/why', why: 'a slash inside a word' },
    { input: 'the /How page', why: 'a name in another case' },
    { input: '', why: 'empty input' },
  ])('leaves $why input alone (CMD-002)', ({ input }) => {
    expect(aliasInputResult({ text: input }, names, block)).toEqual({ action: 'continue' });
  });

  test('the input handler transforms an alias and keeps attached images (CMD-001)', () => {
    const images = [{ type: 'image' as const, data: 'AAAA', mimeType: 'image/png' }];
    expect(aliasInputResult({ text: '/how this screen?', images }, names, block)).toEqual({ action: 'transform', text: '/skill:how this screen?', images });
  });
});

describe('skillReferences', () => {
  test('finds each skill named after the start or whitespace, once, in order (SKILL-REF-002)', () => {
    expect(skillReferences('/why x\t/how, y /why z /nope', names)).toEqual(['why', 'how']);
  });
});

describe('aliasTable (CMD-002, CMD-003; review: architecture 6)', () => {
  const skill = (name: string, path: string) => ({ name: `skill:${name}`, description: `${name} skill`, source: 'skill' as const, sourceInfo: { path, source: 'test', scope: 'user' as const, origin: 'package' as const } });
  const commands = [
    skill('how', join(SKILLS_DIR, 'how/SKILL.md')),
    skill('why', join(SKILLS_DIR, 'why/SKILL.md')),
    skill('mine', '/home/me/.pi/agent/skills/mine/SKILL.md'),
    { name: 'why', description: 'user template', source: 'prompt' as const, sourceInfo: { path: '/home/me/.pi/agent/prompts/why.md', source: 'test', scope: 'user' as const, origin: 'top-level' as const } },
  ];

  test('aliases every loaded skill that no template or command already names, as Cursor attaches any skill by /name (review r2: parity 1)', () => {
    expect([...aliasTable(commands)]).toEqual([
      ['how', 'how skill'],
      ['mine', 'mine skill'],
    ]);
  });

  test('lists the loaded skills that live in this package, by canonical path (A4, recheck 1)', () => {
    expect(packageSkillNames(commands)).toEqual(['how', 'why']);
  });
});
