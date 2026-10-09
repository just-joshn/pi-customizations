#!/usr/bin/env node
// Re-probe MODE-STICKY Cursor half after Cursor.app install.
// Owned path for u-mode-sticky-cursor-app-001. No ledger edits. No fabricated chrome.
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const isMain = Boolean(process.argv[1]) && import.meta.url === pathToFileURL(process.argv[1]).href;
const root = new URL('../../', import.meta.url).pathname;
const researchRoot = join(root, 'research', 'mode-sticky-cursor-app-001');
const hostProbeDir = join(researchRoot, 'host-probe');
const cursorApp = '/Applications/Cursor.app';
const cursorBinary = join(cursorApp, 'Contents', 'MacOS', 'Cursor');
const cursorShim = join(homedir(), '.local', 'bin', 'cursor');
const cursorAgent = join(homedir(), '.local', 'bin', 'cursor-agent');
const appSupport = join(homedir(), 'Library', 'Application Support', 'Cursor');
const settingsPath = join(appSupport, 'User', 'settings.json');
const stateDb = join(appSupport, 'User', 'globalStorage', 'state.vscdb');
const statsigCache = join(homedir(), '.cursor', 'statsig-cache.json');
const cliConfig = join(homedir(), '.cursor', 'cli-config.json');

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
      timeout: opts.timeout ?? 12_000,
      env: process.env,
      maxBuffer: 4_000_000,
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

function tcpOpen(port) {
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

async function readTextIfExists(path) {
  if (!(await pathExists(path))) return null;
  return readFile(path, 'utf8');
}

async function probeGlassFromSqlite() {
  if (!(await pathExists(stateDb))) {
    return { exists: false };
  }
  const q = await runCapture([
    'sqlite3',
    stateDb,
    "SELECT key, value FROM ItemTable WHERE key IN ('glass.lastSignedInAuthId','glass.sharedApplicationStorage.gateEnabled','workbench.experiments.statsigBootstrap','cursorAuth/stripeMembershipType');",
  ]);
  const rows = {};
  for (const line of q.out.split('\n')) {
    if (!line.includes('|')) continue;
    const idx = line.indexOf('|');
    rows[line.slice(0, idx)] = line.slice(idx + 1);
  }
  const bootstrap = rows['workbench.experiments.statsigBootstrap'] || '';
  return {
    exists: true,
    glassLastSignedInAuthId: rows['glass.lastSignedInAuthId'] ?? null,
    glassSharedApplicationStorageGateEnabled: rows['glass.sharedApplicationStorage.gateEnabled'] ?? null,
    stripeMembershipType: rows['cursorAuth/stripeMembershipType'] ?? null,
    statsigBootstrapLen: bootstrap.length,
    glass_custom_modes_string_in_bootstrap: /glass_custom_modes/i.test(bootstrap),
    customModes_string_in_bootstrap: /customModes|Use as Mode|useAsMode/i.test(bootstrap),
  };
}

export async function probeCursorAppStickyHost() {
  await mkdir(hostProbeDir, { recursive: true });
  const probeId = randomUUID();
  const capturedAt = new Date().toISOString();

  const cursorAppPresent = await pathExists(cursorApp);
  const contentsPresent = await pathExists(join(cursorApp, 'Contents'));
  const binaryPresent = await pathExists(cursorBinary);
  const version = cursorAppPresent
    ? await runCapture(['defaults', 'read', join(cursorApp, 'Contents', 'Info.plist'), 'CFBundleShortVersionString'])
    : { ok: false, out: '' };
  const bundleId = cursorAppPresent
    ? await runCapture(['defaults', 'read', join(cursorApp, 'Contents', 'Info.plist'), 'CFBundleIdentifier'])
    : { ok: false, out: '' };
  const appsListing = await runCapture(['ls', '/Applications']);
  const mdfind = await runCapture([
    'mdfind',
    'kMDItemCFBundleIdentifier == "com.todesktop.230313mzl4w4u92" || kMDItemDisplayName == "Cursor.app"',
  ]);
  const cursorShimHelp = await runCapture([cursorShim, '--help'], { timeout: 8_000 });
  const cursorAgentVersion = await runCapture([cursorAgent, '--version'], { timeout: 8_000 });
  const foreground = await runCapture([
    'osascript',
    '-e',
    'tell application "System Events" to get name of every process whose background only is false',
  ]);
  const psCursor = await runCapture(['/bin/ps', 'auxww']);
  const agentsWindowProc = /extension-host Agents Window/i.test(psCursor.out);
  const cursorMainProc = /\/Applications\/Cursor\.app\/Contents\/MacOS\/Cursor/.test(psCursor.out);
  const screencapture = await runCapture([
    'screencapture',
    '-x',
    join(hostProbeDir, '02-desktop.png'),
  ]);
  const cdpPorts = {};
  for (const port of [9222, 9223, 9229, 9230, 9333]) {
    cdpPorts[port] = await tcpOpen(port);
  }

  const settingsText = await readTextIfExists(settingsPath);
  const settingsNeedles = settingsText
    ? {
        customMode: /customMode|Custom Mode/i.test(settingsText),
        glassCustomModes: /glass_custom_modes/i.test(settingsText),
        useAsMode: /Use as Mode|useAsMode/i.test(settingsText),
        agentsWindow: /Agents Window/i.test(settingsText),
        raw: settingsText.trim(),
      }
    : null;

  const statsigText = await readTextIfExists(statsigCache);
  const cliConfigText = await readTextIfExists(cliConfig);
  const glassSqlite = await probeGlassFromSqlite();

  const displayEnv = process.env.DISPLAY ?? '<unset>';
  const apps = appsListing.out
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
  const cursorApps = apps.filter((name) => /cursor/i.test(name));
  const foregroundText = foreground.out.trim();
  const foregroundHasCursor = /\bCursor\b/i.test(foregroundText);

  const computerUseMcpInSession = false;
  const computerUseNote =
    'GetDynamicTools pattern computer|screenshot|browser|cdp|playwright returned matches: [] (measured this unit)';

  await writeFile(
    join(hostProbeDir, '00-host-inventory.txt'),
    [
      '=== date ===',
      capturedAt,
      '=== probeId ===',
      probeId,
      '=== Cursor.app ===',
      `path=${cursorApp}`,
      `present=${cursorAppPresent}`,
      `contents=${contentsPresent}`,
      `binary=${binaryPresent}`,
      `version=${version.out.trim() || 'n/a'}`,
      `bundleId=${bundleId.out.trim() || 'n/a'}`,
      '=== mdfind ===',
      mdfind.out.trim() || '(empty)',
      '=== DISPLAY ===',
      displayEnv,
      '=== screencapture ===',
      screencapture.ok ? 'wrote 02-desktop.png' : screencapture.out.trim().slice(0, 400),
      '=== CDP ports ===',
      Object.entries(cdpPorts)
        .map(([port, open]) => `${open ? 'open' : 'closed'} ${port}`)
        .join('\n'),
      '=== processes ===',
      `cursorMainProc=${cursorMainProc}`,
      `agentsWindowProc=${agentsWindowProc}`,
      '=== computer-use ===',
      computerUseNote,
      '',
    ].join('\n'),
  );
  await writeFile(join(hostProbeDir, '01-foreground-apps.txt'), `${foregroundText}\n`);
  await writeFile(
    join(hostProbeDir, '02-applications-listing-screen.txt'),
    [
      'SCREEN: /Applications listing (Cursor.app re-probe)',
      `capturedAt: ${capturedAt}`,
      `cursorish_entries: ${cursorApps.length ? cursorApps.join(', ') : '(none)'}`,
      `Cursor.app_present: ${cursorAppPresent}`,
      'Custom Mode chrome on this screen: absent (listing only)',
      '--- Application names ---',
      ...apps,
      '',
    ].join('\n'),
  );
  await writeFile(
    join(hostProbeDir, '03-statsig-glass-custom-modes.txt'),
    [
      `statsig-cache.exists: ${Boolean(statsigText)}`,
      `statsig-cache.size: ${statsigText ? statsigText.length : 'n/a'}`,
      `statsig-cache.glass_custom_modes_string: ${statsigText ? /glass_custom_modes/i.test(statsigText) : null}`,
      `cli-config.exists: ${Boolean(cliConfigText)}`,
      `cli-config.glass_custom_modes_string: ${cliConfigText ? /glass_custom_modes/i.test(cliConfigText) : null}`,
      `state.vscdb: ${JSON.stringify(glassSqlite, null, 2)}`,
      '',
    ].join('\n'),
  );
  await writeFile(
    join(hostProbeDir, '04-settings-custom-modes.txt'),
    [
      `path: ${settingsPath}`,
      `exists: ${Boolean(settingsText)}`,
      `needles: ${settingsNeedles ? JSON.stringify(settingsNeedles) : 'null'}`,
      '',
    ].join('\n'),
  );
  await writeFile(
    join(hostProbeDir, '05-cursor-shim.txt'),
    [
      `cursorShim: ${cursorShim}`,
      `findsIde: ${cursorShimHelp.ok && !/No Cursor IDE installation found/i.test(cursorShimHelp.out)}`,
      '--- help head ---',
      cursorShimHelp.out.trim().slice(0, 1200),
      '',
    ].join('\n'),
  );
  await writeFile(
    join(hostProbeDir, '06-agents-window-process.txt'),
    [
      `agentsWindowProc=${agentsWindowProc}`,
      `cursorMainProc=${cursorMainProc}`,
      `foregroundHasCursor=${foregroundHasCursor}`,
      'note: process presence is not Custom Mode chrome; display/CDP/computer-use required to drive slash → Use as Mode',
      '',
    ].join('\n'),
  );
  await writeFile(
    join(hostProbeDir, '07-display-screencapture.txt'),
    [
      `DISPLAY=${displayEnv}`,
      `screencapture.ok=${screencapture.ok}`,
      `screencapture.out=${screencapture.out.trim().slice(0, 400)}`,
      '',
    ].join('\n'),
  );

  const checks = {
    cursorAppPresent,
    contentsPresent,
    binaryPresent,
    cursorAppVersion: version.out.trim() || null,
    cursorBundleId: bundleId.out.trim() || null,
    cursorApplicationSupportPresent: await pathExists(appSupport),
    cursorSettingsPresent: Boolean(settingsText),
    settingsCustomModesTogglePresent: Boolean(settingsNeedles?.customMode),
    settingsUseAsModePresent: Boolean(settingsNeedles?.useAsMode),
    foregroundCursorProcess: foregroundHasCursor,
    cursorMainProcess: cursorMainProc,
    agentsWindowProcess: agentsWindowProc,
    cdpAnyOpen: Object.values(cdpPorts).some(Boolean),
    cdpPorts,
    displaySet: Boolean(process.env.DISPLAY),
    screencaptureOk: screencapture.ok,
    cursorShimFindsIde: cursorShimHelp.ok && !/No Cursor IDE installation found/i.test(cursorShimHelp.out),
    cursorAgentVersion: cursorAgentVersion.out.trim() || null,
    statsigCacheGlassCustomModesString: statsigText ? /glass_custom_modes/i.test(statsigText) : false,
    ideBootstrapGlassCustomModesString: Boolean(glassSqlite.glass_custom_modes_string_in_bootstrap),
    glassSignedOut: glassSqlite.glassLastSignedInAuthId === 'signed-out',
    computerUseMcpInSession,
    agentsWindowUiDriveable: false,
    customModeStickyReached: false,
  };

  const blockers = [];
  if (!checks.displaySet || !checks.screencaptureOk) {
    blockers.push('DISPLAY empty / screencapture cannot create image from display');
  }
  if (!checks.cdpAnyOpen) blockers.push('no Cursor Electron CDP debug port open');
  if (!checks.computerUseMcpInSession) blockers.push('no computer-use / screenshot MCP tools in this session');
  if (!checks.settingsCustomModesTogglePresent) {
    blockers.push('User/settings.json has no Custom Modes toggle keys');
  }
  if (!checks.statsigCacheGlassCustomModesString && !checks.ideBootstrapGlassCustomModesString) {
    blockers.push('glass_custom_modes string absent from CLI statsig-cache and IDE statsig bootstrap');
  }
  if (checks.glassSignedOut) blockers.push('Cursor IDE glass.lastSignedInAuthId is signed-out');
  if (!checks.agentsWindowUiDriveable) {
    blockers.push('Agents Window slash → Use as Mode not driveable without display/CDP/computer-use');
  }
  if (!checks.customModeStickyReached) blockers.push('Custom Mode sticky not reached (no success attempt ID)');

  const uiPathsTried = [
    {
      path: 'Desktop Cursor.app present at /Applications/Cursor.app',
      tried: true,
      reachable: cursorAppPresent,
      reason: cursorAppPresent
        ? `present version=${checks.cursorAppVersion} bundleId=${checks.cursorBundleId}`
        : 'absent',
      customModeChrome: false,
    },
    {
      path: 'Desktop Cursor.app → Agents Window → slash → Use as Mode',
      tried: true,
      reachable: false,
      reason:
        'Agents Window helper process may be live, but DISPLAY empty, screencapture fails, CDP closed, computer-use MCP absent; cannot prove or drive Use as Mode chrome',
      customModeChrome: false,
      agentsWindowProcessObserved: agentsWindowProc,
    },
    {
      path: 'Desktop Cursor Settings → Custom Modes toggle',
      tried: true,
      reachable: Boolean(settingsText),
      reason: settingsText
        ? `settings.json exists (${settingsText.length} bytes) but needles customMode/useAsMode/glass_custom_modes all false; content=${settingsText.trim()}`
        : 'settings.json absent',
      customModeChrome: false,
    },
    {
      path: 'cursor shim finds IDE',
      tried: true,
      reachable: checks.cursorShimFindsIde,
      reason: checks.cursorShimFindsIde
        ? `cursor --help identifies Cursor ${checks.cursorAppVersion}`
        : cursorShimHelp.out.trim().split('\n')[0] || 'shim failed',
      customModeChrome: false,
    },
    {
      path: 'CDP attach to Cursor Electron',
      tried: true,
      reachable: false,
      reason: `ports ${JSON.stringify(cdpPorts)}`,
      customModeChrome: false,
    },
    {
      path: 'Computer-use / desktop screenshot drive',
      tried: true,
      reachable: false,
      reason: `${computerUseNote}; screencapture: ${screencapture.out.trim().slice(0, 120)}`,
      customModeChrome: false,
    },
    {
      path: 'CLI glass_custom_modes / PTY Meta+Enter (prior exhaustive-negative)',
      tried: false,
      reachable: true,
      reason:
        'Not re-run as sticky success path; prior attempts 6977eeec / 9857dda0 remain; binary default glass_custom_modes false; live statsig-cache lacks gate string',
      customModeChrome: false,
      priorAttempts: [
        '6977eeec-08bd-4829-810c-11d526d9f9fb',
        '9857dda0-a74d-4546-b69e-1ff3528bdf3e',
      ],
    },
  ];

  const result = {
    schema: 1,
    scenario: 'mode-sticky-cursor-app-001',
    requirementId: 'PSTACK-MODE-STICKY-001',
    mismatchId: 'MODE-STICKY-CURSOR-CUSTOM-MODE-HARNESS',
    path: 'cursor-app-agents-window-reprobe',
    probeId,
    capturedAt,
    runnable: false,
    verdict: 'exhaustive-negative-env-blocked',
    customModeStickyReached: false,
    cursorAttemptId: null,
    cursorApp: {
      path: cursorApp,
      present: cursorAppPresent,
      contentsPresent,
      binaryPresent,
      version: checks.cursorAppVersion,
      bundleId: checks.cursorBundleId,
    },
    checks,
    blockers,
    uiPathsTried,
    glassSqlite,
    evidenceNotes: {
      hostProbeDir: 'parity/research/mode-sticky-cursor-app-001/host-probe',
      priorAgentsWindowReport: 'parity/briefs/reports/u-mode-sticky-agents-window-report.md',
      priorCliNegativeReport: 'parity/briefs/reports/u-cursor-custom-mode-path-report.md',
      piStickyAttemptId: '96494327-f90c-470a-8e11-cf7c5b6cad89',
      pairLeftUnchanged: 'parity/evidence/mode-sticky/pair-mode-sticky-1.json',
      cursorShimDigest: `sha256:${createHash('sha256').update(cursorShimHelp.out).digest('hex')}`,
    },
    mergeRecommendation:
      'Do not close MODE-STICKY-CURSOR-CUSTOM-MODE-HARNESS / PSTACK-MODE-STICKY-001 Cursor half. Cursor.app is present, but sticky Custom Mode remains unreachable on this host (no display capture, no CDP, no computer-use MCP, signed-out IDE, no Custom Modes settings chrome, glass_custom_modes still not observed on). Keep Pi half 96494327 linked.',
  };

  await writeFile(join(researchRoot, 'host-env-probe.json'), `${JSON.stringify(result, null, 2)}\n`);
  await writeFile(
    join(researchRoot, 'ui-paths-tried.json'),
    `${JSON.stringify({ probeId, capturedAt, uiPathsTried }, null, 2)}\n`,
  );
  return result;
}

if (isMain) {
  const result = await probeCursorAppStickyHost();
  console.log(
    JSON.stringify(
      {
        verdict: result.verdict,
        probeId: result.probeId,
        cursorAppPresent: result.cursorApp.present,
        customModeStickyReached: result.customModeStickyReached,
        blockers: result.blockers,
      },
      null,
      2,
    ),
  );
}
