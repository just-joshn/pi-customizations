import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { PROVIDER_SOURCE } from '../../../../extensions/pi-tui-skin/scripts/lib/scripted-provider.mjs';
import { cleanupProbes, makeLayout, saveCapture, startProbe, waitForCapture } from '../scenarios/lib/tui-probe.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../../..');
const control = process.argv.includes('--without-pstack');
const rawDir = join(root, 'artifacts/user-perspective/pstack-skin-interaction', control ? 'control' : 'combined');
mkdirSync(rawDir, { recursive: true });
const layout = makeLayout('pstack-skin');
const provider = join(layout.root, 'provider.ts');
const script = {
  trigger: 'cross todos',
  calls: [{ type: 'toolCall', id: 'cross-todos', name: 'TodoWrite', arguments: { todos: [{ id: 'cross', content: 'CROSS_EXTENSION_TODO', status: 'in_progress' }] } }],
  sequential: true,
  done: 'CROSS_EXTENSION_DONE',
};
assert.ok(PROVIDER_SOURCE.includes('const SCRIPTS = ['));
writeFileSync(provider, PROVIDER_SOURCE.replace('const SCRIPTS = [', `const SCRIPTS = [${JSON.stringify(script)},`));
const args = ['--no-extensions', '-e', join(root, 'extensions/pi-tui-skin'), ...(control ? [] : ['-e', join(root, 'extensions/pi-pstack')]), '-e', provider, '--model', 'tui-skin-scripted/smoke', '--no-session', '-a', '-nc'];
try {
  const terminal = startProbe({ layout, piArgs: args });
  waitForCapture(
    () => terminal.capture(),
    'skin header',
    (text) => text.includes('Pi Coding Agent'),
  );
  saveCapture(rawDir, 'startup', { plain: terminal.capture(), ansi: terminal.captureAnsi(), ...terminal.paneSize() });
  terminal.send('cross todos');
  waitForCapture(
    () => terminal.capture(),
    'scripted tool result',
    (text) => text.includes('CROSS_EXTENSION_DONE'),
  );
  const combined = terminal.capture();
  saveCapture(rawDir, 'todos', { plain: combined, ansi: terminal.captureAnsi(), ...terminal.paneSize() });
  assert.ok(combined.includes('[>] CROSS_EXTENSION_TODO (in_progress)'), 'pstack todo widget must render inside the skinned UI');
  assert.equal(combined.split('Pi Coding Agent').length - 1, 1, 'one skin header survives the tool update');
  assert.ok(combined.includes('Reference UI Scripted'), 'skin footer survives the pstack widget');
  terminal.resize(70, 28);
  const resized = waitForCapture(
    () => terminal.capture(),
    'resized todo widget',
    (text) => text.includes('[>] CROSS_EXTENSION_TODO'),
  );
  saveCapture(rawDir, 'resized', { plain: resized, ansi: terminal.captureAnsi(), ...terminal.paneSize() });
  terminal.send('/reload');
  const reloaded = waitForCapture(
    () => terminal.capture(),
    'restored widget after reload',
    (text) => text.includes('[>] CROSS_EXTENSION_TODO') && text.includes('Reloaded'),
  );
  saveCapture(rawDir, 'reloaded', { plain: reloaded, ansi: terminal.captureAnsi(), ...terminal.paneSize() });
  assert.equal(reloaded.split('[>] CROSS_EXTENSION_TODO').length - 1, 1, 'reload must not duplicate the pstack widget');
  terminal.send('/quit');
  const exited = waitForCapture(
    () => terminal.capture(),
    'clean Pi exit',
    (text) => text.includes('PI-EXITED-0'),
  );
  saveCapture(rawDir, 'exit', { plain: exited, ansi: terminal.captureAnsi(), ...terminal.paneSize() });
  const result = { packages: ['pi-pstack', 'pi-tui-skin'], realTool: 'TodoWrite', widget: true, header: true, footer: true, resize: true, reload: true, exit: 0 };
  writeFileSync(join(rawDir, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
} finally {
  cleanupProbes();
}
