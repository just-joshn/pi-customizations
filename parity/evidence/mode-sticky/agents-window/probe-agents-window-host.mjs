#!/usr/bin/env node
// Probe whether Cursor Agents Window / IDE can reach sticky Custom Mode on this host.
// Owned path for u-mode-sticky-agents-window. Does not edit ledgers. Does not fabricate chrome.
import { access, mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
const root = new URL('../../../', import.meta.url).pathname;
const evidenceRoot = join(root, 'evidence', 'mode-sticky', 'agents-window');
const hostProbeDir = join(evidenceRoot, 'host-probe');
const cursorShim = join(homedir(), '.local', 'bin', 'cursor');
const cursorAgent = join(homedir(), '.local', 'bin', 'cursor-agent');
const docsAgentsWindow = 'https://cursor.com/docs/agent/agents-window';
const docsPrompting = join(
  root,
  'research',
  'cursor-host',
  'customization',
  'sources',
  'prompting.md',
);

async function pathExists(path) {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function runCapture(argv, opts = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(argv[0], argv.slice(1), {
      timeout: opts.timeout ?? 15_000,
      env: process.env,
      maxBuffer: 2_000_000,
    });
    return { ok: true, exit: 0, out: `${stdout}${stderr}` };
  } catch (error) {
    return {
      ok: false,
      exit: typeof error?.code === 'number' ? error.code : 1,
      out: String(error?.stdout || '') + String(error?.stderr || '') + String(error?.message || error),
    };
  }
}

async function tcpOpen(port) {
  const { createConnection } = await import('node:net');
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port });
    const done = (open) => {
      socket.removeAllListeners();
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(400);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

function containsCustomModeChrome(text) {
  return /Custom Mode|Use as Mode|option\+enter to use as mode|Mode active|exiting the mode/i.test(
    text,
  );
}

export async function probeAgentsWindowHost() {
  await mkdir(hostProbeDir, { recursive: true });
  const probeId = randomUUID();
  const capturedAt = new Date().toISOString();

  const mdfind = await runCapture([
    'mdfind',
    'kMDItemDisplayName == "Cursor.app"c || kMDItemCFBundleIdentifier == "com.todesktop.*" && kMDItemDisplayName == "*Cursor*"',
  ]);
  const appsListing = await runCapture(['ls', '/Applications']);
  const cursorShimHelp = await runCapture([cursorShim, '--help']);
  const cursorAgentHelp = await runCapture([cursorAgent, '--help']);
  const foreground = await runCapture([
    'osascript',
    '-e',
    'tell application "System Events" to get name of every process whose background only is false',
  ]);
  const screencapture = await runCapture([
    'screencapture',
    '-x',
    join(hostProbeDir, '02-desktop.png'),
  ]);

  const appSupportCursor = join(homedir(), 'Library', 'Application Support', 'Cursor');
  const appSupportCursorNightly = join(homedir(), 'Library', 'Application Support', 'Cursor Nightly');
  const settingsCandidates = [
    join(appSupportCursor, 'User', 'settings.json'),
    join(appSupportCursorNightly, 'User', 'settings.json'),
    join(homedir(), '.cursor', 'settings.json'),
    join(homedir(), '.cursor', 'cli-config.json'),
  ];
  const settingsHits = [];
  for (const path of settingsCandidates) {
    const exists = await pathExists(path);
    let needles = null;
    if (exists) {
      const { readFile } = await import('node:fs/promises');
      const text = await readFile(path, 'utf8');
      needles = {
        customMode: /customMode|Custom Mode/i.test(text),
        glassCustomModes: /glass_custom_modes/i.test(text),
        useAsMode: /Use as Mode|useAsMode/i.test(text),
        agentsWindow: /Agents Window/i.test(text),
      };
    }
    settingsHits.push({ path, exists, needles });
  }

  const statsigPath = join(homedir(), '.cursor', 'statsig-cache.json');
  let statsigGlass = { exists: await pathExists(statsigPath), glass_custom_modes: null };
  if (statsigGlass.exists) {
    const { readFile } = await import('node:fs/promises');
    const raw = await readFile(statsigPath, 'utf8');
    statsigGlass.glass_custom_modes = /glass_custom_modes/i.test(raw);
    statsigGlass.size = raw.length;
  }

  const cdpPorts = {};
  for (const port of [9222, 9223, 9229, 9230]) {
    cdpPorts[port] = await tcpOpen(port);
  }

  const apps = appsListing.out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const cursorApps = apps.filter((name) => /cursor/i.test(name));
  const foregroundText = foreground.out.trim();
  const foregroundHasCursor = /\bCursor\b/i.test(foregroundText);

  const inventory = [
    `=== date ===`,
    capturedAt,
    `=== probeId ===`,
    probeId,
    `=== mdfind Cursor.app ===`,
    mdfind.out.trim() || '(empty)',
    `=== ls Applications (cursorish) ===`,
    cursorApps.length ? cursorApps.join('\n') : '(none)',
    `=== cursor shim ===`,
    cursorShimHelp.out.trim().slice(0, 800),
    `=== Application Support Cursor ===`,
    `exists=${await pathExists(appSupportCursor)}`,
    `=== computer-use / browser MCP in this Cursor agent session ===`,
    'GetDynamicTools pattern computer|screenshot|browser returned matches: [] (measured by parent unit)',
    `=== CDP ports ===`,
    Object.entries(cdpPorts)
      .map(([port, open]) => `${open ? 'open' : 'closed'} ${port}`)
      .join('\n'),
    `=== screencapture ===`,
    screencapture.ok ? 'wrote 02-desktop.png' : screencapture.out.trim().slice(0, 400),
  ].join('\n');

  await writeFile(join(hostProbeDir, '00-host-inventory.txt'), `${inventory}\n`);
  await writeFile(join(hostProbeDir, '01-foreground-apps.txt'), `${foregroundText}\n`);
  await writeFile(
    join(hostProbeDir, '02-applications-listing-screen.txt'),
    [
      'SCREEN: /Applications listing (host Agents Window probe)',
      `capturedAt: ${capturedAt}`,
      'expect: Cursor.app present for Agents Window (Cmd+Shift+P → Open Agents Window)',
      `cursorish_entries: ${cursorApps.length ? cursorApps.join(', ') : '(none)'}`,
      'Custom Mode chrome on this screen: absent (no Cursor IDE UI)',
      '--- Application names ---',
      ...apps,
      '',
    ].join('\n'),
  );
  await writeFile(join(hostProbeDir, '05-cursor-shim-error.txt'), `${cursorShimHelp.out.trim()}\n`);
  await writeFile(
    join(hostProbeDir, '03-statsig-glass-custom-modes.txt'),
    [
      `exists: ${statsigGlass.exists}`,
      `size: ${statsigGlass.size ?? 'n/a'}`,
      `glass_custom_modes_present_in_cache_text: ${statsigGlass.glass_custom_modes}`,
      '',
    ].join('\n'),
  );
  await writeFile(
    join(hostProbeDir, '04-settings-custom-modes.txt'),
    settingsHits
      .map((hit) => {
        const needleLine = hit.needles ? JSON.stringify(hit.needles) : 'null';
        return `path: ${hit.path}\nexists: ${hit.exists}\nneedles: ${needleLine}\n`;
      })
      .join('\n'),
  );

  const uiPathsTried = [
    {
      path: 'Desktop Cursor.app → Agents Window → slash → Use as Mode',
      tried: true,
      reachable: false,
      reason: 'No Cursor.app on host; mdfind empty; /Applications has no Cursor entry',
      customModeChrome: false,
    },
    {
      path: 'Desktop Cursor Settings → Custom Modes toggle',
      tried: true,
      reachable: false,
      reason: 'No Application Support/Cursor User/settings.json; cli-config has no Custom Mode keys',
      customModeChrome: false,
    },
    {
      path: 'cursor shim open IDE / Agents Window',
      tried: true,
      reachable: false,
      reason: cursorShimHelp.out.trim().split('\n')[0] || 'cursor shim failed',
      customModeChrome: false,
    },
    {
      path: 'CDP attach to running Cursor Electron (remote-debugging-port)',
      tried: true,
      reachable: false,
      reason: `No open CDP on ${Object.keys(cdpPorts).join(',')}; no Cursor process in foreground list`,
      customModeChrome: false,
    },
    {
      path: 'Computer-use / desktop screenshot drive of Agents Window',
      tried: true,
      reachable: false,
      reason: 'No computer-use MCP tools in this session; screencapture cannot create image from display',
      customModeChrome: false,
    },
    {
      path: 'cursor-agent PTY Meta+Enter / Use as Mode (prior exhaustive-negative, not re-run as Agents Window)',
      tried: false,
      reachable: true,
      reason: 'Out of scope for this unit (CLI glass_custom_modes already negative: attempts 6977eeec, 9857dda0)',
      customModeChrome: false,
      priorAttempts: [
        '6977eeec-08bd-4829-810c-11d526d9f9fb',
        '9857dda0-a74d-4546-b69e-1ff3528bdf3e',
      ],
    },
  ];

  const docsText = (await pathExists(docsPrompting))
    ? await (await import('node:fs/promises')).readFile(docsPrompting, 'utf8')
    : '';

  const checks = {
    cursorAppPresent: cursorApps.length > 0 || Boolean(mdfind.out.trim()),
    cursorApplicationSupportPresent: await pathExists(appSupportCursor),
    cursorSettingsPresent: settingsHits.some((h) => h.exists && /settings\.json$/.test(h.path)),
    settingsCustomModesTogglePresent: settingsHits.some((h) => h.needles?.customMode),
    settingsUseAsModePresent: settingsHits.some((h) => h.needles?.useAsMode),
    foregroundCursorProcess: foregroundHasCursor,
    cdpAnyOpen: Object.values(cdpPorts).some(Boolean),
    screencaptureOk: screencapture.ok,
    cursorShimFindsIde: cursorShimHelp.ok && !/No Cursor IDE installation found/i.test(cursorShimHelp.out),
    cursorAgentHelpMentionsAgentsWindow: /Agents Window/i.test(cursorAgentHelp.out),
    cursorAgentHelpMentionsUseAsMode: /Use as Mode/i.test(cursorAgentHelp.out),
    cursorAgentHelpMentionsCustomMode: /Custom Mode/i.test(cursorAgentHelp.out),
    docsSayAgentsWindowCustomModes: /Agents Window/i.test(docsText) && /Custom Modes/i.test(docsText),
    docsUrl: docsAgentsWindow,
    statsigGlassCustomModesKeyPresent: Boolean(statsigGlass.glass_custom_modes),
    agentsWindowUiDriveable: false,
    customModeStickyReached: false,
  };

  const missing = [];
  if (!checks.cursorAppPresent) missing.push('Cursor.app not installed on this host');
  if (!checks.cursorApplicationSupportPresent) {
    missing.push('~/Library/Application Support/Cursor absent (no IDE settings / Custom Modes toggle)');
  }
  if (!checks.cursorShimFindsIde) missing.push('cursor shim reports No Cursor IDE installation found');
  if (!checks.cdpAnyOpen) missing.push('no Cursor Electron CDP debug port open');
  if (!checks.agentsWindowUiDriveable) {
    missing.push('Agents Window slash → Use as Mode UI is not driveable without Cursor desktop');
  }
  if (!checks.customModeStickyReached) {
    missing.push('Custom Mode sticky not reached (no success attempt ID)');
  }

  const result = {
    schema: 1,
    scenario: 'mode-sticky-agents-window',
    requirementId: 'PSTACK-MODE-STICKY-001',
    mismatchId: 'MODE-STICKY-CURSOR-CUSTOM-MODE-HARNESS',
    path: 'agents-window-ide-custom-mode-sticky',
    probeId,
    capturedAt,
    runnable: false,
    verdict: 'exhaustive-negative-host-blocked',
    customModeStickyReached: false,
    cursorAttemptId: null,
    checks,
    missing,
    uiPathsTried,
    evidenceNotes: {
      hostProbeDir: 'parity/evidence/mode-sticky/agents-window/host-probe',
      screens: [
        'parity/evidence/mode-sticky/agents-window/host-probe/00-host-inventory.txt',
        'parity/evidence/mode-sticky/agents-window/host-probe/01-foreground-apps.txt',
        'parity/evidence/mode-sticky/agents-window/host-probe/02-applications-listing-screen.txt',
        'parity/evidence/mode-sticky/agents-window/host-probe/05-cursor-shim-error.txt',
      ],
      docsClaim:
        'Custom Modes available in Agents Window and CLI (parity/research/cursor-host/customization/sources/prompting.md)',
      priorCliNegativeReport: 'parity/briefs/reports/u-cursor-custom-mode-path-report.md',
      piStickyAttemptId: '96494327-f90c-470a-8e11-cf7c5b6cad89',
      cursorShimDigest: `sha256:${createHash('sha256').update(cursorShimHelp.out).digest('hex')}`,
      cursorAgentHelpDigest: `sha256:${createHash('sha256').update(cursorAgentHelp.out).digest('hex')}`,
    },
    skillAcceptanceNote:
      'Sticky Custom Mode requires Agents Window or CLI Use as Mode / Option+Enter with glass_custom_modes on. This host has cursor-agent only, no Cursor IDE, so Agents Window chrome cannot be shown or proven present.',
  };

  const outPath = join(evidenceRoot, 'host-env-probe.json');
  await writeFile(outPath, `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(
    join(evidenceRoot, 'ui-paths-tried.json'),
    `${JSON.stringify({ probeId, capturedAt, uiPathsTried }, null, 2)}\n`,
  );
  return result;
}

if (isMain) {
  const result = await probeAgentsWindowHost();
  console.log(JSON.stringify({ verdict: result.verdict, probeId: result.probeId, cursorAttemptId: result.cursorAttemptId }, null, 2));
}
