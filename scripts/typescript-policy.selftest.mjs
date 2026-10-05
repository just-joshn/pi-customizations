#!/usr/bin/env node
import { strict as assert } from 'node:assert';

import { compilerOptionsText } from './typescript-policy.mjs';

const input = `{
  "include": ["{not-an-object}.ts"],
  // Compiler rules belong to the root.
  "compilerOptions": { "strict": true, "paths": { "label": ["}"] }, /* } */ "noEmit": true },
  "exclude": []
}`;
assert.equal(compilerOptionsText(input), '{ "strict": true, "paths": { "label": ["}"] }, /* } */ "noEmit": true }', 'lexer preserves the exact root options without treating comments or strings as braces');
assert.throws(() => compilerOptionsText('{"include":[]}'), /compilerOptions/, 'missing authority cannot generate a portable policy');
assert.throws(
  () =>
    compilerOptionsText(`{
  "compilerOptions": true
}`),
  /object/,
  'non-object authority cannot generate a portable policy',
);
assert.throws(
  () =>
    compilerOptionsText(`{
  "compilerOptions": {
`),
  /Unclosed/,
  'truncated options never become a valid projection',
);
process.stdout.write('Portable compiler policy self-test passed.\n');
