import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

const records = JSON.parse(await readFile(new URL('./team-kit-source-adaptations.json', import.meta.url), 'utf8'));
const record = records.find((entry) => entry.path === 'skills/pr-review-canvas/renderer.js');
function renderer(source, payload = {}) {
  const target = { innerHTML: '' };
  const elements = Object.keys(payload).map((key) => ({ innerHTML: '', getAttribute: () => key }));
  let discover;
  const context = {
    document: {
      getElementById: (id) => (id === 'pr-diffs-json' ? { textContent: JSON.stringify(payload) } : target),
      querySelector: () => target,
      querySelectorAll: () => elements,
      addEventListener: (_event, callback) => {
        discover = callback;
      },
    },
  };
  runInNewContext(source, context);
  return { context, target, elements, discover: () => discover() };
}
const cases = [
  '',
  null,
  [],
  '@@ -1 +1 @@\n-old\n+new',
  '@@ -4,2 +8,2 @@\n-const x=1;\n+const x = 1;\n context',
  '@@ -1,4 +1,4 @@\n-first\n-second\n-third\n+first\n+second\n+third',
  ['@@ -1 +1 @@', '-import old from "old";', '+import next from "next";', '+<img> & unsafe </img>'].join('\n'),
];
for (const input of cases) {
  const baseline = renderer(record.original);
  const adapted = renderer(record.adapted);
  baseline.context.renderDiff('fixture', input);
  adapted.context.renderDiff('fixture', input);
  assert.equal(adapted.target.innerHTML, baseline.target.innerHTML, `Equivalent rendering for ${JSON.stringify(input)}`);
}
const payload = Object.fromEntries([
  ['hasOwnProperty', '@@ -1 +1 @@\n+owned'],
  ['constructor', '@@ -1 +1 @@\n+also owned'],
]);
const adapted = renderer(record.adapted, payload);
adapted.discover();
assert.ok(
  adapted.elements.every((element) => element.innerHTML.includes('diff-add')),
  'own keys shadowing builtins render',
);
assert.equal(typeof adapted.context.toggle, 'function');
assert.equal(typeof adapted.context.toggleBP, 'function');
const escaped = renderer(record.adapted);
escaped.context.renderDiff('fixture', '+<img> & unsafe </img>');
assert.ok(escaped.target.innerHTML.includes('&lt;img&gt; &amp; unsafe &lt;/img&gt;'));
assert.ok(!escaped.target.innerHTML.includes('<img>'));
process.stdout.write('Renderer equivalence, escaping, own builtin-name keys and classic globals pass.\n');
