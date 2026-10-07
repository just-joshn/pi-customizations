// biome-ignore-all lint/security/noSecrets: fixture markdown, not credentials
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, test } from 'vitest';
import { extractCodeBlocks, extractInlineCodes, newFindings, toResult, validate, validateInlineCodes } from '../../src/compress/validate.ts';

function inline(orig: string, comp: string) {
  const findings = newFindings();
  validateInlineCodes(orig, comp, findings);
  return toResult(findings);
}

describe('indented fence (#820)', () => {
  const NESTED = '# T\n\n* Example:\n    ```markdown\n    x = 1\n    ```\n* Use `alpha` and `beta` here.\n';

  test('indented fence markers not leaked as inline', () => {
    expect(extractInlineCodes(NESTED)).toEqual(['alpha', 'beta']);
  });
  test('nested fence file validates against itself', () => {
    expect(inline(NESTED, NESTED)).toEqual({ isValid: true, errors: [], warnings: [] });
  });
  test('deeply indented fence markers not leaked', () => {
    expect(extractInlineCodes('* a\n  * b\n        ```\n        y = 2\n        ```\n* Use `gamma`.\n')).toEqual(['gamma']);
  });
  test('tilde fence indented in list', () => {
    expect(extractInlineCodes('* Example:\n    ~~~python\n    z = 3\n    ~~~\n* Use `delta`.\n')).toEqual(['delta']);
  });
});

describe('indented fence does not swallow', () => {
  test('lone indented marker does not capture the real block', () => {
    const doc = 'To open a fence write:\n\n    ```\n\nThen prose with `alpha`.\n\n```js\nreal = 1\n```\n';
    expect(extractCodeBlocks(doc)).toEqual(['    ```', '```js\nreal = 1\n```']);
    expect(extractInlineCodes(doc)).toEqual(['alpha']);
  });
  test('content loss after an indented marker still fails', () => {
    const orig = '# Runbook\n\nA fence opens with three backticks:\n\n    ```\n\nEmergency rollback:\n\n```\nhelm rollback prod 41 --namespace production\n```\n';
    const result = validate(orig, orig.replace('prod 41', 'prod'));
    expect(result.isValid).toBe(false);
    expect(result.errors).toEqual(['Code blocks not preserved exactly']);
  });
});

describe('multi-line spans', () => {
  test('multiline span is extracted', () => {
    expect(extractInlineCodes('Run `npm install --save-dev\nsome-package` first and `x` after.')).toEqual(['npm install --save-dev\nsome-package', 'x']);
  });
  test('deleting a multiline span is an error', () => {
    expect(inline('Pass the `--dangerously-skip-permissions\nflag` before running.', 'Run it.')).toEqual({
      isValid: false,
      errors: ["Inline code lost: {'--dangerously-skip-permissions\\\\nflag'}"],
      warnings: [],
    });
  });
  test('mutating a multiline span is an error', () => {
    expect(inline('Set `--flag\nvalue` now.', 'Set `--flag other` now.')).toEqual({
      isValid: false,
      errors: ["Inline code lost: {'--flag\\\\nvalue'}"],
      warnings: ["Inline code added: {'--flag other'}"],
    });
  });
});

describe('mid-line fence run', () => {
  test('does not shift pairing', () => {
    const text = 'Put the result inside a ```diff fence. Then state:\n\n- count of `BEGIN PRIVATE KEY` matches\n- check `base64 -d` output\n';
    expect(extractInlineCodes(text)).toEqual(['BEGIN PRIVATE KEY', 'base64 -d']);
  });
  test('file validates against itself', () => {
    const text = 'Wrap it in a ```json fence and run `jq .` after.\n';
    expect(inline(text, text).isValid).toBe(true);
  });
  test('span after mid-line run still protected', () => {
    expect(inline('Use a ```diff fence, then run `git apply /tmp/x.patch` to apply.\n', 'Use a ```diff fence, then apply.\n').errors).toEqual(["Inline code lost: {'git apply /tmp/x.patch'}"]);
  });
});

describe('error rendering', () => {
  test('long span truncated and newlines escaped', () => {
    const result = inline(`a \`${'x'.repeat(500)}\nmore\` b`, 'a b');
    expect(result.errors).toEqual([`Inline code lost: {'${'x'.repeat(60)}…'}`]);
  });
  test('lost occurrences counted', () => {
    expect(inline('`a` and `a`', '`a`').errors).toEqual(["Inline code lost: {'a (lost 1 of 2 occurrences)'}"]);
  });
});

describe('validateInlineCodes', () => {
  test('match', () => expect(inline('use `cmd` here', 'use `cmd` here').isValid).toBe(true));
  test('lost', () => {
    expect(inline('use `cmd` here', 'use  here')).toEqual({ isValid: false, errors: ["Inline code lost: {'cmd'}"], warnings: [] });
  });
  test('added', () => {
    expect(inline('use  here', 'use `new` here')).toEqual({ isValid: true, errors: [], warnings: ["Inline code added: {'new'}"] });
  });
  test('empty orig', () => expect(inline('no codes', 'use `new` here').isValid).toBe(true));
  test('both empty', () => expect(inline('plain text', 'also plain')).toEqual({ isValid: true, errors: [], warnings: [] }));
  test('wired into validate', () => {
    expect(validate('Run `rm -rf /` to delete', 'Run  to delete').errors).toEqual(["Inline code lost: {'rm -rf /'}"]);
  });
});

describe('inner backtick spans', () => {
  test('double-backtick span with inner backtick', () => {
    expect(extractInlineCodes('use ``a`b`` here and `c`')).toEqual(['a`b', 'c']);
  });
  test('single-backtick span with inner double run', () => {
    expect(extractInlineCodes('see `a``b` now')).toEqual(['a``b']);
  });
  test('rewrite still fails', () => {
    const orig = '# T\n\nRun ``git log --format=`%h` -1`` first.\n';
    expect(inline(orig, orig.replace('%h', '%H')).isValid).toBe(false);
  });
});

describe('indented code is validated', () => {
  test('mutated indented command fails', () => {
    const result = validate('# Cleanup\n\nRun this:\n\n    kubectl delete pod --all -n prod\n\nDone.\n', '# Cleanup\n\nRun this:\n\n    kubectl delete pod -n dev\n\nDone.\n');
    expect(result.errors).toEqual(['Code blocks not preserved exactly']);
  });
  test('nested bullets are not code', () => {
    expect(JSON.stringify(extractCodeBlocks('# Doc\n\n- a bullet\n    - nested prose that should stay compressible\n'))).toBe('[]');
  });
});

describe('cross-type block order', () => {
  const ORIG = "Intro.\n\n```python\nprint('hi')\n```\n\nMiddle.\n\n    kubectl delete pod --all -n prod\n\nEnd.\n";
  const SWAPPED = "Intro.\n\n    kubectl delete pod --all -n prod\n\nMiddle.\n\n```python\nprint('hi')\n```\n\nEnd.\n";

  test('extraction reflects document order', () => {
    expect(extractCodeBlocks(ORIG)).toEqual(["```python\nprint('hi')\n```", '    kubectl delete pod --all -n prod']);
    expect(extractCodeBlocks(SWAPPED)).toEqual(['    kubectl delete pod --all -n prod', "```python\nprint('hi')\n```"]);
  });
  test('swapped order fails', () => {
    expect(validate(ORIG, SWAPPED).errors).toEqual(['Code blocks not preserved exactly']);
  });
  test('identical document passes', () => {
    expect(validate(ORIG, ORIG)).toEqual({ isValid: true, errors: [], warnings: [] });
  });
});

describe('preservation promises are errors', () => {
  test('renamed heading fails', () => {
    expect(validate('# Configuration Options\n\nSome prose about the options here.\n', '# Config\n\nOptions prose.\n').errors).toEqual(["Heading text/order changed: lost=['Configuration Options'], added=['Config']"]);
  });
  test('dropped path fails', () => {
    expect(validate('# Hooks\n\nThe shared module lives at src/hooks/caveman-config.js and is required.\n', '# Hooks\n\nShared module required.\n')).toEqual({
      isValid: false,
      errors: ["File paths lost: ['src/hooks/caveman-config.js']"],
      warnings: [],
    });
  });
  test('heading count, level, URL and bullet rules', () => {
    expect(validate('# A\n## B\n', '# A\n').errors).toEqual(['Heading count mismatch: 2 vs 1']);
    expect(validate('# A\n', '## A\n')).toEqual({ isValid: true, errors: [], warnings: ['Heading levels changed'] });
    expect(validate('see https://a.example/x and more', 'see more').errors).toEqual(["URL mismatch: lost={'https://a.example/x'}, added=set()", "File paths lost: ['//a.example/x']"]);
    expect(validate('- a\n- b\n- c\n', '- a\n').warnings).toEqual(['Bullet count changed too much: 3 -> 1']);
    expect(validate('pros/cons apply', 'it applies')).toEqual({
      isValid: true,
      errors: [],
      warnings: ["Path mismatch: lost=['pros/cons'], added=[]"],
    });
  });
});

describe('upstream fixture pairs', () => {
  const dir = join(import.meta.dirname, '..', 'upstream', 'compress-fixtures');
  const names = readdirSync(dir)
    .filter((n) => n.endsWith('.original.md'))
    .map((n) => n.slice(0, -'.original.md'.length))
    .sort();

  test('all five fixture pairs present', () => {
    expect(names).toEqual(['claude-md-preferences', 'claude-md-project', 'mixed-with-code', 'project-notes', 'todo-list']);
  });
  test.each(names)('%s validates with no errors', (name) => {
    const original = readFileSync(join(dir, `${name}.original.md`), 'utf8');
    const compressed = readFileSync(join(dir, `${name}.md`), 'utf8');
    const result = validate(original, compressed);
    expect(JSON.stringify(result.errors)).toBe('[]');
    expect(result.isValid).toBe(true);
  });
});
