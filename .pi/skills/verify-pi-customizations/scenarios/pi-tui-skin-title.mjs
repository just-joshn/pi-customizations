import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';

import { capturePane, cleanup, pause, piBinary, requireTmux, startSession } from '../../../../extensions/pi-tui-skin/scripts/lib/tmux-driver.mjs';
import { waitForCapture } from './lib/tui-probe.mjs';

const SESSION = 'tui-skin-smoke';

/** Poll the tmux pane title until two samples agree; the title is written by OSC 0. */
function settledTitle(socket) {
  let previous = '';
  let title = '';
  for (let attempt = 0; attempt < 20; attempt += 1) {
    pause(250);
    title = execFileSync('tmux', ['-L', socket, 'display-message', '-p', '-t', SESSION, '#{pane_title}'], { encoding: 'utf8', timeout: 20_000 }).trim();
    if (title !== '' && title === previous) return title;
    previous = title;
  }
  return title;
}

export default async function piTuiSkinTitle(context) {
  const { rawDir, receipts, log } = context;
  requireTmux();
  piBinary();
  const socket = `pi-tui-skin-smoke-${process.pid}`;
  let title = '';
  let titlePath = '';
  const { workspace } = startSession({});
  try {
    waitForCapture(capturePane, 'idle frame', (text) => text.includes('Pi Coding Agent'));
    title = settledTitle(socket);
    titlePath = join(rawDir, 'pane-title.txt');
    writeFileSync(titlePath, `${title}\n`);
  } finally {
    cleanup();
  }
  const piTitle = `π - ${basename(workspace)}`;
  receipts.assertVerdict({
    surfaceId: 'TS-UI-1',
    package: 'extensions/pi-tui-skin',
    expected: `session start leaves the terminal title to pi: the settled pane_title is pi's own ${JSON.stringify(piTitle)}`,
    observed: `the settled tmux pane_title is ${JSON.stringify(title)}`,
    evidence: titlePath,
    check: () => {
      assert.equal(title, piTitle, `the skin must not take pi's terminal title; the user sees pane_title ${JSON.stringify(title)} instead of ${JSON.stringify(piTitle)}`);
    },
  });
  log(`✓ ${receipts.receipts().length} title receipt written`);
}
