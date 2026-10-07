import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { captureFrame, capturePane, cleanup, piBinary, requireTmux, startSession, tempDir } from '../../../../extensions/pi-tui-skin/scripts/lib/tmux-driver.mjs';
import { saveCapture, waitForCapture } from './lib/tui-probe.mjs';

function lines(path) {
  return readFileSync(path, 'utf8').split('\n');
}

export default async function piTuiSkinEnvironment(context) {
  const { rawDir, receipts, log } = context;
  requireTmux();
  piBinary();
  const home = realpathSync(tempDir('pi-tui-skin-env-home'));
  const agentDir = join(home, '.pi', 'agent');
  mkdirSync(agentDir, { recursive: true });
  writeFileSync(join(agentDir, 'settings.json'), `${JSON.stringify({ quietStartup: true }, null, 2)}\n`);
  let capture = '';
  startSession({ workspaceRoot: home, env: { HOME: home, PI_CODING_AGENT_DIR: agentDir } });
  try {
    const text = waitForCapture(capturePane, 'home-relative frame', (line) => line.includes('Reference UI Scripted'));
    capture = saveCapture(rawDir, '01-home', captureFrame(text));
  } finally {
    cleanup();
  }
  const location = lines(capture).find((line) => /^ {2}~/.test(line)) ?? '';
  receipts.assertVerdict({
    surfaceId: 'TS-ENV-1',
    package: 'extensions/pi-tui-skin',
    expected: 'with HOME set, the footer shortens the workspace path with a leading ~',
    observed: `location row ${JSON.stringify(location)}; absolute home path leaked: ${readFileSync(capture, 'utf8').includes(home)}`,
    evidence: capture,
    check: () => {
      assert.match(location, /^ {2}~\/pi-tui-skin-ws-\w+ · smoke-main$/, 'location row is not a ~-shortened workspace path');
      assert.ok(!readFileSync(capture, 'utf8').includes(home), 'the absolute home path leaked into the frame');
    },
  });
  log(`✓ ${receipts.receipts().length} environment receipts written`);
}
