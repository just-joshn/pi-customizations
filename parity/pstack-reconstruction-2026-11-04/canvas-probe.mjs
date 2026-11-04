import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { chromium } = require(process.argv[2] ?? 'playwright-core');
const output = dirname(fileURLToPath(import.meta.url));
const repository = resolve(output, '../..');
const plugins = resolve(process.argv[3] ?? join(repository, '../plugins'));
const injection = '</script><script>window.unexpectedCanvasExecution=true</script>';
const patches = {
  changed: `@@ -1,2 +1,3 @@\n-import before from 'old';\n+import after from 'new';\n-const previous = 1;\n+const next = 2;\n+const literal = "${injection}";`,
  moved: '@@ -1,3 +1,0 @@\n-first();\n-second();\n-third();\n@@ -10,0 +7,3 @@\n+first();\n+second();\n+third();',
  whitespace: '@@ -1 +1 @@\n-const value=1;\n+const value = 1;',
};
const body = `<main class="content"><h1>PR canvas verification</h1>${Object.keys(patches)
  .map((key) => `<section class="file-card"><div class="file-hdr" onclick="toggle(this)"><span>${key}</span><span class="chev open">v</span></div><div class="file-body open"><div data-diff="${key}"></div></div></section>`)
  .join('')}</main>`;
const safeJson = JSON.stringify(patches).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e').replaceAll('&', '\\u0026');
const documents = new Map();
for (const [name, root] of [
  ['reference', join(plugins, 'cursor-team-kit/skills/pr-review-canvas')],
  ['native', join(repository, 'extensions/pi-pstack/skills/pr-review-canvas')],
]) {
  const html = readFileSync(join(root, 'template.html'), 'utf8')
    .replace('/* INJECT_CSS */', readFileSync(join(root, 'styles.css'), 'utf8'))
    .replace('/* INJECT_JS */', readFileSync(join(root, 'renderer.js'), 'utf8'))
    .replace('<!-- INJECT_BODY -->', body)
    .replace('{"__PR_DIFFS_PLACEHOLDER__":true}', safeJson);
  documents.set(`/${name}`, html);
}
const server = createServer((request, response) => {
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  response.end(documents.get(request.url) ?? 'Not found');
});
await new Promise((ready) => server.listen(0, '127.0.0.1', ready));
let browser;
try {
  browser = await chromium.launch({ executablePath: process.env.PSTACK_BROWSER ?? '/usr/bin/google-chrome', headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.route('**/*', (route) => (new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort()));
  const observations = [];
  for (const name of ['reference', 'native']) {
    const errors = [];
    const onError = (error) => errors.push(error.message);
    page.on('pageerror', onError);
    await page.goto(`http://127.0.0.1:${server.address().port}/${name}`);
    await page.locator('[data-diff="changed"] .diff-code').first().waitFor();
    const changed = await page.locator('[data-diff="changed"]').innerText();
    assert(changed.includes('const next = 2;'), 'the changed code renders');
    assert(changed.includes(injection), 'script terminators remain literal diff text');
    assert(!changed.includes('import before') && !changed.includes('import after'), 'import-only lines are filtered');
    assert.equal(await page.evaluate(() => window.unexpectedCanvasExecution), undefined, 'the patch executes no injected script');
    assert.equal(await page.locator('[data-diff="moved"] .diff-moved-add').count(), 3, 'three added lines are identified as moved');
    assert.equal(await page.locator('[data-diff="moved"] .diff-moved-del').count(), 3, 'three deleted lines are identified as moved');
    assert.equal(await page.locator('[data-diff="whitespace"] .diff-ctx').count(), 1, 'a whitespace-only change becomes context');
    const header = page.locator('.file-hdr').first();
    await header.click();
    assert.equal(await page.locator('.file-body').first().isVisible(), false, 'a reviewer can collapse a file');
    await header.click();
    assert.equal(await page.locator('.file-body').first().isVisible(), true, 'a reviewer can reopen a file');
    assert.deepEqual(errors, [], 'the page has no JavaScript errors');
    await page.screenshot({ path: join(output, `canvas-${name}.png`), fullPage: true });
    observations.push({ name, changed, movedAdds: 3, movedDeletes: 3, whitespaceContexts: 1, toggled: true, errors });
    page.off('pageerror', onError);
  }
  assert.deepEqual(observations[0].changed, observations[1].changed, 'reference and native renderer output agree for the fixture');
  writeFileSync(join(output, 'canvas-observations.json'), `${JSON.stringify({ browser: await browser.version(), observations }, null, 2)}\n`);
  console.log('VERIFIED for fixture rendering, script-safe assembly, import filtering, moved code, whitespace, and collapse/reopen on both asset sets.');
  console.log('A real-model GitHub review, system-browser launch, and Cursor in-app browser integration remain unobserved.');
} finally {
  await browser?.close();
  await new Promise((done) => server.close(done));
}
