import { Type } from 'typebox';
import { expect, test } from 'vitest';
import { architectPrompts } from '../../src/edit/prompts/architect.ts';
import { askPrompts } from '../../src/edit/prompts/ask.ts';
import { coderPrompts } from '../../src/edit/prompts/base.ts';
import { contextPrompts } from '../../src/edit/prompts/context.ts';
import { editBlockPrompts } from '../../src/edit/prompts/editblock.ts';
import { editBlockFencedPrompts } from '../../src/edit/prompts/editblock-fenced.ts';
import { editorDiffFencedPrompts } from '../../src/edit/prompts/editor-diff-fenced.ts';
import { editorEditBlockPrompts } from '../../src/edit/prompts/editor-editblock.ts';
import { editorWholeFilePrompts } from '../../src/edit/prompts/editor-whole.ts';
import { patchPrompts } from '../../src/edit/prompts/patch.ts';
import { shell } from '../../src/edit/prompts/shell.ts';
import { unifiedDiffPrompts } from '../../src/edit/prompts/udiff.ts';
import { unifiedDiffSimplePrompts } from '../../src/edit/prompts/udiff-simple.ts';
import { wholeFilePrompts } from '../../src/edit/prompts/wholefile.ts';
import { oracleCases, outcomeOf } from '../support/oracle.ts';

/** Each prompt record under its export name, the camelCased name of its Aider class or module. */
const records: Readonly<Record<string, object>> = {
  coderPrompts,
  editBlockPrompts,
  editBlockFencedPrompts,
  wholeFilePrompts,
  unifiedDiffPrompts,
  unifiedDiffSimplePrompts,
  patchPrompts,
  editorEditBlockPrompts,
  editorWholeFilePrompts,
  editorDiffFencedPrompts,
  architectPrompts,
  askPrompts,
  contextPrompts,
  shell,
};

function record(pythonName: string): object {
  const name = pythonName.charAt(0).toLowerCase() + pythonName.slice(1);
  const found = Object.hasOwn(records, name) ? records[name] : undefined;
  if (found === undefined) throw new Error(`no prompt record named ${name}`);
  return found;
}

const snakeCase = (key: string): string => key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

test.for(oracleCases('prompts', 'prompts.attributes', Type.Object({ name: Type.String() })))('prompt attributes $id', async ({ args, expected }) => {
  expect(await outcomeOf(() => Object.fromEntries(Object.entries(record(args.name)).map(([key, value]) => [snakeCase(key), value])))).toEqual(expected);
});
