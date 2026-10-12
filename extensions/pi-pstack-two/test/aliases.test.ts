import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { aliasInputResult, aliasTable, aliasTransform, packageSkillNames } from '../src/aliases.ts';
import { SKILLS_DIR } from '../src/paths.ts';

const names = new Set(['how', 'poteto-mode', 'principle-prove-it-works']);

describe('aliasTransform', () => {
  test.for([
    { input: '/how', expected: '/skill:how' },
    { input: '/how does the cache work?', expected: '/skill:how does the cache work?' },
    { input: '/poteto-mode fix the "drift" bug\nrepro first, then $1 and $@', expected: '/skill:poteto-mode fix the "drift" bug\nrepro first, then $1 and $@' },
    { input: '/how\nwhat owns retries?', expected: '/skill:how \nwhat owns retries?' },
    { input: '/principle-prove-it-works', expected: '/skill:principle-prove-it-works' },
  ])('rewrites $input to a native skill command (CMD-001)', ({ input, expected }) => {
    expect(aliasTransform(input, names)).toBe(expected);
  });

  test.for([
    { input: '/skill:how what', why: 'already native' },
    { input: '/model', why: 'a Pi built-in' },
    { input: '/howdy partner', why: 'a longer word that only starts with a skill name' },
    { input: '/unknown thing', why: 'not a shipped skill' },
    { input: 'please /how this', why: 'not at the start' },
    { input: ' /how leading space', why: 'Pi commands start at column zero' },
    { input: '', why: 'empty input' },
  ])('leaves $why input alone (CMD-002)', ({ input }) => {
    expect(aliasInputResult({ text: input }, names)).toEqual({ action: 'continue' });
  });

  test('the input handler transforms an alias and keeps attached images (CMD-001)', () => {
    const images = [{ type: 'image' as const, data: 'AAAA', mimeType: 'image/png' }];
    expect(aliasInputResult({ text: '/how this screen?', images }, names)).toEqual({ action: 'transform', text: '/skill:how this screen?', images });
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
