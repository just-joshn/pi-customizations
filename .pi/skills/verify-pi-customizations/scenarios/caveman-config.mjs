import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import { badgeText, baseCavemanEnv, CAVEMAN_PACKAGE, closeCavemanSessions, noticeMessages, prepareFixture, startCavemanSession, waitForBadge, writeRaw } from './caveman-fixture.js';

function writeConfig(path, text) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

function removeConfig(path) {
  rmSync(path, { force: true });
}

async function waitForStartup(session) {
  await session.waitFor((record) => record.type === 'extension_ui_request' && (record.method === 'setStatus' || record.method === 'notify'), { description: 'session_start render or warning' });
  await new Promise((resolve) => setTimeout(resolve, 150));
}

async function readStartBadge(context, pkg, environment, options = {}) {
  const session = startCavemanSession(context, { ...baseCavemanEnv(context.scratchDir), ...environment }, { packagePath: pkg, ...options });
  try {
    await waitForStartup(session);
    return { badge: badgeText(session), warnings: noticeMessages(session), stderr: session.stderr, evidence: session.capturePath };
  } finally {
    await session.close();
  }
}

function judge(receipts, { surfaceId, expected, observed, evidence, check, verdict = 'verified', reason = null }) {
  let failure = null;
  try {
    check();
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }
  receipts.write({
    surfaceId,
    package: CAVEMAN_PACKAGE,
    expected,
    observed: failure ? `${observed} [check failed: ${failure}]` : observed,
    evidence,
    verdict: failure ? 'failed' : verdict,
    reason: failure ? failure : reason,
  });
}

async function driveDefaultMode(context, pkg) {
  const cases = {};
  cases.unset = await readStartBadge(context, pkg, {}, { captureName: 'rpc-config-unset.jsonl' });
  cases.envMegacave = await readStartBadge(context, pkg, { CAVEMAN_DEFAULT_MODE: 'megacave' }, { captureName: 'rpc-config-env-megacave.jsonl' });
  cases.envLegacyWenyan = await readStartBadge(context, pkg, { CAVEMAN_DEFAULT_MODE: 'wenyan' }, { captureName: 'rpc-config-env-wenyan.jsonl' });
  cases.envOff = await readStartBadge(context, pkg, { CAVEMAN_DEFAULT_MODE: 'off' }, { captureName: 'rpc-config-env-off.jsonl' });
  cases.envInvalid = await readStartBadge(context, pkg, { CAVEMAN_DEFAULT_MODE: 'not-a-mode' }, { captureName: 'rpc-config-env-invalid.jsonl' });
  cases.envManual = await readStartBadge(context, pkg, { CAVEMAN_DEFAULT_MODE: 'manual' }, { captureName: 'rpc-config-env-manual.jsonl' });
  return cases;
}

async function driveManualActivation(context, pkg, env) {
  const session = startCavemanSession(context, { ...env, CAVEMAN_DEFAULT_MODE: 'manual' }, { packagePath: pkg, captureName: 'rpc-config-manual-on.jsonl' });
  try {
    await waitForStartup(session);
    const before = badgeText(session);
    await session.prompt('/caveman');
    await waitForBadge(session, '[CAVEMAN]');
    return { before, after: badgeText(session), evidence: session.capturePath };
  } finally {
    await session.close();
  }
}

async function driveUserConfig(context, pkg) {
  const configPath = join(context.scratchDir, 'xdg', 'caveman', 'config.json');
  const cases = {};
  writeConfig(configPath, JSON.stringify({ defaultMode: 'ultracave' }));
  cases.ultracave = await readStartBadge(context, pkg, {}, { captureName: 'rpc-config-user-ultracave.jsonl' });
  writeConfig(configPath, JSON.stringify({ defaultMode: 'off' }));
  cases.off = await readStartBadge(context, pkg, {}, { captureName: 'rpc-config-user-off.jsonl' });
  writeConfig(configPath, '{"defaultMode":');
  cases.malformed = await readStartBadge(context, pkg, {}, { captureName: 'rpc-config-user-malformed.jsonl' });
  writeConfig(configPath, JSON.stringify({ defaultMode: 42 }));
  cases.badSchema = await readStartBadge(context, pkg, {}, { captureName: 'rpc-config-user-bad-schema.jsonl' });
  writeConfig(configPath, JSON.stringify({ defaultMode: 'ultracave' }));
  cases.invalidEnvFallsBack = await readStartBadge(context, pkg, { CAVEMAN_DEFAULT_MODE: 'not-a-mode' }, { captureName: 'rpc-config-user-invalid-env.jsonl' });
  removeConfig(configPath);
  return { cases, configPath };
}

async function driveRepoConfig(context, pkg) {
  const repoDir = join(context.scratchDir, '.caveman');
  const repoFile = join(repoDir, 'config.json');
  const dotFile = join(context.scratchDir, '.caveman.json');
  const userConfig = join(context.scratchDir, 'xdg', 'caveman', 'config.json');
  const cases = {};

  writeConfig(repoFile, JSON.stringify({ defaultMode: 'megacave' }));
  writeConfig(userConfig, JSON.stringify({ defaultMode: 'off' }));
  cases.repoBeatsUser = await readStartBadge(context, pkg, {}, { captureName: 'rpc-config-repo-beats-user.jsonl' });
  cases.envBeatsAll = await readStartBadge(context, pkg, { CAVEMAN_DEFAULT_MODE: 'megacave' }, { captureName: 'rpc-config-env-beats-all.jsonl' });
  writeConfig(repoFile, 'not json at all');
  cases.malformedFallsToUser = await readStartBadge(context, pkg, {}, { captureName: 'rpc-config-repo-malformed.jsonl' });
  removeConfig(repoFile);
  removeConfig(userConfig);
  writeConfig(dotFile, JSON.stringify({ defaultMode: 'off' }));
  cases.dotfileOff = await readStartBadge(context, pkg, {}, { captureName: 'rpc-config-dotfile.jsonl' });
  removeConfig(dotFile);

  const ancestorDir = join(context.scratchDir, 'ancestor', '.caveman');
  writeConfig(join(ancestorDir, 'config.json'), JSON.stringify({ defaultMode: 'megacave' }));
  const ancestorCwd = join(context.scratchDir, 'ancestor', 'child');
  mkdirSync(ancestorCwd, { recursive: true });
  cases.ancestor = await readStartBadge(context, pkg, {}, { captureName: 'rpc-config-ancestor.jsonl', cwd: ancestorCwd });
  removeConfig(join(ancestorDir, 'config.json'));
  return cases;
}

function probeCommand(command) {
  try {
    return execFileSync('/bin/sh', ['-c', command], { encoding: 'utf8' }).trim();
  } catch (error) {
    return error.status === undefined ? `unavailable: ${error.message}` : (error.stdout ?? '').toString().trim();
  }
}

function summarize(cases) {
  return JSON.stringify(Object.fromEntries(Object.entries(cases).map(([name, value]) => [name, { badge: value.badge, warning: value.warnings?.find((message) => message.includes('direct mode')) ?? null }])));
}

function judgeDefaultMode(receipts, defaults, manual) {
  judge(receipts, {
    surfaceId: 'CV-ENV-1',
    expected: 'CAVEMAN_DEFAULT_MODE selects the start mode: valid values and legacy aliases apply, off and manual start off, and an invalid value falls through to the next source.',
    observed: `${summarize(defaults)}; manual start=${manual.before} then bare /caveman => ${manual.after}`,
    evidence: defaults.envMegacave.evidence,
    check: () => {
      assert.equal(defaults.unset.badge, '[CAVEMAN]', 'unset environment did not fall back to the default mode');
      assert.equal(defaults.envMegacave.badge, '[MEGACAVE]');
      assert.equal(defaults.envLegacyWenyan.badge, '[MEGACAVE]', 'legacy wenyan alias did not map to megacave');
      assert.equal(defaults.envOff.badge, null);
      assert.equal(defaults.envInvalid.badge, '[CAVEMAN]', 'invalid value did not fall through');
      assert.equal(defaults.envManual.badge, null, 'manual starts sessions off');
      assert.equal(manual.before, null);
      assert.equal(manual.after, '[CAVEMAN]', 'bare /caveman did not activate under manual');
    },
  });
}

function judgeUserConfig(receipts, user) {
  judge(receipts, {
    surfaceId: 'CV-CFG-1',
    expected: 'The user config file under XDG_CONFIG_HOME picks defaultMode when no env override exists; missing, malformed or schema-invalid files fall back without a crash.',
    observed: `${summarize(user.cases)}; path ${user.configPath}`,
    evidence: user.cases.ultracave.evidence,
    check: () => {
      assert.equal(user.cases.ultracave.badge, '[ULTRACAVE]');
      assert.equal(user.cases.off.badge, null);
      assert.equal(user.cases.malformed.badge, '[CAVEMAN]', 'malformed user config did not fall back');
      assert.equal(user.cases.badSchema.badge, '[CAVEMAN]', 'schema-invalid user config did not fall back');
      assert.equal(user.cases.invalidEnvFallsBack.badge, '[ULTRACAVE]', 'invalid env should fall through to the user config');
    },
  });
}

function judgeRepoConfig(receipts, repo) {
  judge(receipts, {
    surfaceId: 'CV-CFG-2',
    expected: 'Repo config .caveman/config.json or .caveman.json walked up from cwd picks defaultMode, below env and above the user config, and a malformed repo file falls through.',
    observed: summarize(repo),
    evidence: repo.repoBeatsUser.evidence,
    check: () => {
      assert.equal(repo.repoBeatsUser.badge, '[MEGACAVE]', 'repo config did not beat the user config');
      assert.equal(repo.envBeatsAll.badge, '[MEGACAVE]');
      assert.equal(repo.malformedFallsToUser.badge, null, 'malformed repo config did not fall through to the user config (off)');
      assert.equal(repo.dotfileOff.badge, null, '.caveman.json was not read');
      assert.equal(repo.ancestor.badge, '[MEGACAVE]', 'config was not found in an ancestor directory');
    },
  });
}

function judgeWrapAndDebug(receipts, context, wrap, wrapWarning, debug) {
  judge(receipts, {
    surfaceId: 'CV-ENV-2',
    expected: 'CAVEMAN_PI_HOOK_CMD marks the runtime owner as caveman-wrap instead of letting the package own the runtime.',
    observed: `warning ${JSON.stringify(wrapWarning ?? wrap.warnings)}`,
    evidence: wrap.evidence,
    check: () => {
      assert.match(wrapWarning ?? '', /caveman-wrap runtime extension did not load/);
      assert.ok(!wrap.warnings.some((message) => message.includes('native runtime unreachable')), 'package-owned runtime warning appeared despite the wrap marker');
    },
  });
  judge(receipts, {
    surfaceId: 'CV-EVT-5',
    expected: 'session_start warns when a wrap/enable runtime did not load and direct mode applies.',
    observed: `warning ${JSON.stringify(wrapWarning ?? null)}`,
    evidence: wrap.evidence,
    check: () => {
      assert.match(wrapWarning ?? '', /direct mode, no compression this session.*caveman-wrap runtime extension did not load/);
    },
  });
  writeRaw(context, 'debug-stderr.txt', debug.stderr);
  judge(receipts, {
    surfaceId: 'CV-ENV-7',
    expected: 'CAVEMAN_PI_DEBUG=1 traces handler entry and exit to stderr.',
    observed: `stderr first lines ${JSON.stringify(debug.stderr.split('\n').slice(0, 4))}`,
    evidence: context.rawPath('debug-stderr.txt'),
    check: () => {
      assert.match(debug.stderr, /\[caveman-pi\] enter session_start/);
      assert.match(debug.stderr, /\[caveman-pi\] exit session_start/);
    },
  });
}

function judgeTelemetryAndHome(receipts, context, telemetry, home, homeEntries, cavemanHome) {
  judge(receipts, {
    surfaceId: 'CV-ENV-8',
    expected: 'PI_TELEMETRY feeds the vendor provider-compat telemetry decision (unpreserved attribution headers) when the runtime routes through the local proxy.',
    observed: `session with PI_TELEMETRY=0 warned ${JSON.stringify(telemetry.warnings.find((message) => message.includes('direct mode')) ?? null)}`,
    evidence: context.rawPath('env-probe.txt'),
    check: () => {
      assert.match(telemetry.warnings.find((message) => message.includes('direct mode')) ?? '', /caveman native runtime unreachable/);
    },
    verdict: 'env-limited',
    reason:
      'The provider-compat telemetry decision runs only inside ProviderRouter.openGate after a live caveman proxy and recovery pass; no caveman CLI, proxy binary or listener on 127.0.0.1:8787 exists on this machine, so PI_TELEMETRY has no reachable user-visible effect.',
  });
  judge(receipts, {
    surfaceId: 'CV-ENV-4',
    expected: 'CAVEMAN_HOME overrides ~/.caveman for CLI, MCP and recovery state.',
    observed: `CAVEMAN_HOME=${cavemanHome} had entries ${JSON.stringify(homeEntries)}; session warned ${JSON.stringify(home.warnings.find((message) => message.includes('direct mode')) ?? null)}`,
    evidence: home.evidence,
    check: () => {
      assert.ok(homeEntries.length === 0, 'the runtime wrote state despite the missing CLI');
    },
    verdict: 'env-limited',
    reason:
      'caveman CLI and caveman-mcp are absent, and no proxy is listening on 127.0.0.1:8787; CAVEMAN_HOME is read only by hook/recovery/run-state paths gated on those binaries, so no user-visible behaviour differs from the default ~/.caveman path.',
  });
  judge(receipts, {
    surfaceId: 'CV-CFG-5',
    expected: '~/.caveman (CAVEMAN_HOME) holds caveman CLI/MCP/ccr recovery state.',
    observed: `CAVEMAN_HOME=${cavemanHome} stayed empty (entries ${JSON.stringify(homeEntries)}) and the session reported direct mode`,
    evidence: home.evidence,
    check: () => {
      assert.ok(homeEntries.length === 0, 'the runtime wrote recovery state despite the missing MCP');
    },
    verdict: 'env-limited',
    reason: 'No caveman CLI, caveman-mcp or proxy is installed, so the recovery store under CAVEMAN_HOME never comes into existence; without those binaries there is no state for the override to relocate.',
  });
}

function judgeBinaryLimits(receipts, context, missingProxy) {
  judge(receipts, {
    surfaceId: 'CV-ENV-5',
    expected: 'CAVE_GATEWAY_URL overrides the local proxy URL, default http://127.0.0.1:8787.',
    observed: `command -v caveman-proxy: ${probeCommand('command -v caveman-proxy') || '(missing)'}; listener 8787: ${missingProxy || '(none)'}`,
    evidence: context.rawPath('env-probe.txt'),
    check: () => {
      assert.equal(probeCommand('command -v caveman-proxy'), '');
    },
    verdict: 'env-limited',
    reason:
      'The gateway URL is only probed by the vendored runtime after the caveman CLI SessionStart hook succeeds; the caveman CLI and caveman-proxy binary are absent and nothing listens on 127.0.0.1:8787, so the override has no observable target.',
  });
  judge(receipts, {
    surfaceId: 'CV-ENV-6',
    expected: 'CAVEMAN_MCP_BIN overrides the caveman-mcp binary path used for exact recovery.',
    observed: `command -v caveman-mcp: ${probeCommand('command -v caveman-mcp') || '(missing)'}; CAVEMAN_MCP_BIN=${process.env.CAVEMAN_MCP_BIN ?? '(unset)'}`,
    evidence: context.rawPath('env-probe.txt'),
    check: () => {
      assert.equal(probeCommand('command -v caveman-mcp'), '');
    },
    verdict: 'env-limited',
    reason: 'No caveman-mcp binary exists on PATH or under CAVEMAN_HOME/bin and no CAVEMAN_MCP_BIN was configured beforehand; a configured stub would fake the recovery store, so the override cannot be driven truthfully.',
  });
  judge(receipts, {
    surfaceId: 'CV-ENV-10',
    expected: 'PATH resolves the caveman CLI, cave and caveman-mcp for the vendored runtime.',
    observed: `caveman=${probeCommand('command -v caveman') || '(missing)'} cave=${probeCommand('command -v cave') || '(missing)'} caveman-mcp=${probeCommand('command -v caveman-mcp') || '(missing)'}`,
    evidence: context.rawPath('env-probe.txt'),
    check: () => {
      assert.equal(probeCommand('command -v caveman'), '');
      assert.equal(probeCommand('command -v cave'), '');
      assert.equal(probeCommand('command -v caveman-mcp'), '');
    },
    verdict: 'env-limited',
    reason:
      'None of the three binaries resolvable through PATH exists on this machine, so only the documented fallback (direct mode, hooks unreachable) is observable; successful PATH resolution cannot be driven without installing the external CLI.',
  });
}

export default async function cavemanConfig(context) {
  const { receipts } = context;
  const pkg = join(context.repoRoot, CAVEMAN_PACKAGE);
  prepareFixture(context.scratchDir);
  const env = baseCavemanEnv(context.scratchDir);

  try {
    const defaults = await driveDefaultMode(context, pkg);
    const manual = await driveManualActivation(context, pkg, env);
    judgeDefaultMode(receipts, defaults, manual);
    const user = await driveUserConfig(context, pkg);
    judgeUserConfig(receipts, user);
    judgeRepoConfig(receipts, await driveRepoConfig(context, pkg));

    const wrap = await readStartBadge(context, pkg, { CAVEMAN_PI_HOOK_CMD: '["/bin/echo"]' }, { captureName: 'rpc-config-wrap.jsonl' });
    const wrapWarning = wrap.warnings.find((message) => message.includes('caveman-wrap'));
    const debug = await readStartBadge(context, pkg, { CAVEMAN_PI_DEBUG: '1' }, { captureName: 'rpc-config-debug.jsonl' });
    judgeWrapAndDebug(receipts, context, wrap, wrapWarning, debug);

    const telemetry = await readStartBadge(context, pkg, { PI_TELEMETRY: '0' }, { captureName: 'rpc-config-telemetry.jsonl' });
    const missingProxy = probeCommand('command -v caveman-proxy; lsof -nP -iTCP:8787 -sTCP:LISTEN 2>/dev/null; true');
    writeRaw(
      context,
      'env-probe.txt',
      `command -v caveman: ${probeCommand('command -v caveman')}\ncommand -v cave: ${probeCommand('command -v cave')}\ncommand -v caveman-mcp: ${probeCommand('command -v caveman-mcp')}\ncommand -v caveman-proxy: ${probeCommand('command -v caveman-proxy')}\nlistener 8787: ${missingProxy || '(none)'}\nCAVEMAN_MCP_BIN: ${process.env.CAVEMAN_MCP_BIN ?? '(unset)'}\n`,
    );
    const cavemanHome = join(context.scratchDir, 'caveman-home-probe');
    const home = await readStartBadge(context, pkg, { CAVEMAN_HOME: cavemanHome }, { captureName: 'rpc-config-caveman-home.jsonl' });
    const homeEntries = existsSync(cavemanHome) ? readdirSync(cavemanHome) : [];
    judgeTelemetryAndHome(receipts, context, telemetry, home, homeEntries, cavemanHome);
    judgeBinaryLimits(receipts, context, missingProxy);
  } finally {
    await closeCavemanSessions(context);
  }
}
