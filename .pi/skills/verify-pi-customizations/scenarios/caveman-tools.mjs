import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

import {
  baseCavemanEnv,
  CAVEMAN_COMPRESS_SOURCE,
  CAVEMAN_COMPRESS_SOURCE_NO_FINAL_NEWLINE,
  CAVEMAN_PACKAGE,
  closeCavemanSessions,
  noticeMessages,
  prepareFixture,
  startCavemanSession,
  toolEnds,
  waitForBadge,
  writeRaw,
} from './caveman-fixture.js';

const ROLES = ['investigator', 'builder', 'reviewer'];
const OVERRIDES = { investigator: 'alt-investigator', builder: 'alt-builder', reviewer: 'alt-reviewer' };

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

function crewResult(end) {
  const structured = end?.result?.structuredContent ?? null;
  const text = end?.result?.content?.find((part) => part.type === 'text')?.text ?? '';
  return { structured, text };
}

async function runCrew(session, role, callIndex) {
  const before = toolEnds(session, 'cavecrew').length;
  await session.prompt(`CAVEMAN_CALL_CAVECREW_${callIndex} ROLE=${role}`);
  const end = toolEnds(session, 'cavecrew')[before];
  assert.ok(end, `cavecrew ${role} did not execute`);
  return { end, ...crewResult(end) };
}

async function driveCompress(context, session, { callIndex, path }) {
  await session.prompt(`CAVEMAN_CALL_COMPRESS_${callIndex} ${path}`);
  const end = toolEnds(session, 'caveman_compress')[callIndex - 1];
  assert.ok(end, `caveman_compress call ${callIndex} did not execute`);
  const stem = basename(path).replace(/\.[^.]+$/, '');
  const backupPath = join(context.scratchDir, 'data', 'caveman-compress', 'backups', basename(context.scratchDir), `${stem}.original.md`);
  return {
    end,
    structured: end.result?.structuredContent ?? null,
    evidence: session.capturePath,
    backupPath,
    sourcePath: join(context.scratchDir, path),
    fileText: readFileSync(join(context.scratchDir, path), 'utf8'),
  };
}

async function driveCrew(context, env, pkg, captureName) {
  const session = startCavemanSession(context, { ...baseCavemanEnv(context.scratchDir), ...env }, { packagePath: pkg, captureName });
  try {
    await waitForBadge(session, '[ULTRACAVE]');
    const runs = {};
    for (const [index, role] of ROLES.entries()) {
      runs[role] = await runCrew(session, role, index + 1);
    }
    return { runs, evidence: session.capturePath };
  } finally {
    await session.close();
  }
}

function crewObserved(run) {
  return `${run.structured?.role ?? 'no-role'} model=${run.structured?.model ?? 'none'} turns=${run.structured?.turns ?? 'none'} output=${JSON.stringify(run.text.slice(0, 90))}`;
}

function judgeCompress(receipts, context, withNewline, withoutNewline) {
  judge(receipts, {
    surfaceId: 'CV-TOOL-1',
    expected: 'caveman_compress compresses a memory file in place, backs up the original out of tree, validates the result, and keeps the source final-newline state.',
    observed: `trailing-newline source: ${withNewline.structured?.originalBytes} -> ${withNewline.structured?.compressedBytes} bytes, file ${JSON.stringify(withNewline.fileText)}; no-newline source: ${withoutNewline.structured?.originalBytes} -> ${withoutNewline.structured?.compressedBytes} bytes, file ${JSON.stringify(withoutNewline.fileText)}`,
    evidence: withNewline.evidence,
    check: () => {
      assert.equal(withNewline.end.isError, false, 'tool reported an error');
      assert.equal(withNewline.structured?.kind, 'compressed');
      assert.ok(withNewline.structured.originalBytes > withNewline.structured.compressedBytes, 'file did not shrink');
      assert.equal(withNewline.fileText, '# Notes\n\nRun tests before push. Gateway config: config/gateway.yaml.\n', 'the source ended with a newline and the rewrite dropped it');
      assert.equal(withoutNewline.fileText, '# Notes\n\nRun tests before push. Gateway config: config/gateway.yaml.', 'the source had no final newline and the rewrite changed that');
      assert.ok(existsSync(withNewline.backupPath), 'backup missing');
      assert.equal(readFileSync(withNewline.backupPath, 'utf8'), CAVEMAN_COMPRESS_SOURCE, 'backup does not hold the original bytes');
    },
  });
  judge(receipts, {
    surfaceId: 'CV-CFG-4',
    expected: 'caveman_compress stores .original.md backups under XDG_DATA_HOME/caveman-compress/backups, out of tree.',
    observed: `backups ${JSON.stringify([withNewline.backupPath, withoutNewline.backupPath])} both exist=${[existsSync(withNewline.backupPath), existsSync(withoutNewline.backupPath)].join('/')} (XDG_DATA_HOME=${join(context.scratchDir, 'data')})`,
    evidence: withNewline.evidence,
    check: () => {
      for (const [result, source] of [
        [withNewline, CAVEMAN_COMPRESS_SOURCE],
        [withoutNewline, CAVEMAN_COMPRESS_SOURCE_NO_FINAL_NEWLINE],
      ]) {
        assert.equal(result.structured?.backupPath, result.backupPath);
        assert.notEqual(dirname(result.backupPath), dirname(result.sourcePath), 'backup landed beside the source file');
        assert.match(result.backupPath, /\.original\.md$/);
        assert.equal(readFileSync(result.backupPath, 'utf8'), source);
      }
    },
  });
  judge(receipts, {
    surfaceId: 'CV-ENV-9',
    expected: 'XDG_CONFIG_HOME and XDG_DATA_HOME change the config and compress-backup locations (APPDATA/LOCALAPPDATA are the Windows counterparts).',
    observed: `user config at ${join(context.scratchDir, 'xdg', 'caveman', 'config.json')} selected [ULTRACAVE]; backups written under ${join(context.scratchDir, 'data', 'caveman-compress')}`,
    evidence: withNewline.evidence,
    check: () => {
      assert.equal(withNewline.structured?.backupPath.startsWith(join(context.scratchDir, 'data')), true);
      assert.ok(existsSync(join(context.scratchDir, 'xdg', 'caveman', 'config.json')));
    },
  });
}

function judgeCrewRoles(receipts, evidence, runs) {
  judge(receipts, {
    surfaceId: 'CV-TOOL-2',
    expected: 'cavecrew runs investigator/builder/reviewer in an isolated Pi process and returns its compressed report.',
    observed: crewObserved(runs.investigator),
    evidence,
    check: () => {
      assert.equal(runs.investigator.end.isError, false);
      assert.equal(runs.investigator.structured?.role, 'investigator');
      assert.match(runs.investigator.text, /^CREW_ROLE_SEEN=investigator TASK_SEEN=true/);
      assert.ok(runs.investigator.structured.turns >= 1);
    },
  });
  for (const [surfaceId, role] of [
    ['CV-AGENT-2', 'investigator'],
    ['CV-AGENT-1', 'builder'],
    ['CV-AGENT-3', 'reviewer'],
  ]) {
    judge(receipts, {
      surfaceId,
      expected: `The cavecrew ${role} role prompt is what the child Pi process receives.`,
      observed: crewObserved(runs[role]),
      evidence,
      check: () => {
        assert.equal(runs[role].end.isError, false);
        assert.equal(runs[role].structured?.role, role);
        assert.ok(runs[role].text.startsWith(`CREW_ROLE_SEEN=${role} TASK_SEEN=true`), `child did not see the ${role} role prompt`);
      },
    });
  }
}

function judgeOverrides(receipts, overridden) {
  judge(receipts, {
    surfaceId: 'CV-ENV-3',
    expected: 'CAVECREW_INVESTIGATOR_MODEL, CAVECREW_BUILDER_MODEL and CAVECREW_REVIEWER_MODEL override the cavecrew child model.',
    observed: ROLES.map((role) => `${role}->${overridden.runs[role].structured?.model} (${overridden.runs[role].text.match(/MODEL_SEEN=\S+/)?.[0]})`).join(', '),
    evidence: overridden.evidence,
    check: () => {
      for (const role of ROLES) {
        assert.equal(overridden.runs[role].structured?.model, `caveman-scripted/${OVERRIDES[role]}`, `${role} did not use its override model`);
        assert.match(overridden.runs[role].text, new RegExp(`MODEL_SEEN=alt-${role}\\b`), `${role} child did not run on the override model`);
      }
    },
  });
}

function judgeRetrieveAndRuntime(receipts, evidence, retrieve, retrieveText, directWarning) {
  judge(receipts, {
    surfaceId: 'CV-TOOL-3',
    expected: 'caveman_retrieve recovers the exact original content behind a ccr_ handle from the Caveman recovery store.',
    observed: `isError=${retrieve.isError} text=${JSON.stringify(retrieveText)}`,
    evidence,
    check: () => {
      assert.equal(retrieve.isError, true);
      assert.match(retrieveText, /caveman-mcp is not available this session/);
    },
    verdict: 'env-limited',
    reason:
      'No caveman-mcp binary exists (PATH and CAVEMAN_HOME/bin are empty) and no proxy/recovery store is running, so the only real result the tool can return is cave_recovery_unavailable; recovering exact bytes requires the external caveman-mcp binary.',
  });
  judge(receipts, {
    surfaceId: 'CV-EVT-6',
    expected: 'The vendor runtime owner path proxies routing, shrinks tool output and serves recovery handles through the caveman CLI/native runtime.',
    observed: `session_start warning ${JSON.stringify(directWarning)}; caveman_retrieve returned ${JSON.stringify(retrieveText)}`,
    evidence,
    check: () => {
      assert.match(directWarning ?? '', /caveman native runtime unreachable/);
    },
    verdict: 'env-limited',
    reason:
      'The caveman CLI, cave, caveman-proxy and caveman-mcp binaries are all absent and nothing listens on 127.0.0.1:8787, so the runtime owner path can only reach its documented direct-mode fallback; proxy routing, output shrinking and recovery handles cannot be observed.',
  });
}

function rolePromptEvidence(pkg) {
  const currentMarkers = { investigator: 'Lead with answer', builder: 'No drive-by refactors', reviewer: 'Findings only' };
  const frontmatterMarkers = { investigator: 'Read-only code locator', builder: 'Surgical 1-2 file edit', reviewer: 'Diff/branch/file reviewer' };
  return Object.fromEntries(
    ROLES.map((role) => {
      const raw = readFileSync(join(pkg, 'agents', `cavecrew-${role}.md`), 'utf8');
      const body = raw.replace(/^---[\s\S]*?---\s*/, '');
      return [
        role,
        {
          oldFixtureMarker: frontmatterMarkers[role],
          oldMarkerInFullFile: raw.includes(frontmatterMarkers[role]),
          oldMarkerInAppendedBody: body.includes(frontmatterMarkers[role]),
          currentFixtureMarker: currentMarkers[role],
          currentMarkerInAppendedBody: body.includes(currentMarkers[role]),
        },
      ];
    }),
  );
}

async function driveRetrieve(session) {
  const before = toolEnds(session, 'caveman_retrieve').length;
  await session.prompt('CAVEMAN_CALL_RETRIEVE');
  const end = toolEnds(session, 'caveman_retrieve')[before];
  assert.ok(end, 'caveman_retrieve did not execute');
  return { end, text: end.result?.content?.find((part) => part.type === 'text')?.text ?? '' };
}

export default async function cavemanTools(context) {
  const { receipts } = context;
  const pkg = process.env.CAVEMAN_PACKAGE_DIR ?? join(context.repoRoot, CAVEMAN_PACKAGE);
  prepareFixture(context.scratchDir);
  const env = baseCavemanEnv(context.scratchDir);
  mkdirSync(join(context.scratchDir, 'xdg', 'caveman'), { recursive: true });
  writeFileSync(join(context.scratchDir, 'xdg', 'caveman', 'config.json'), JSON.stringify({ defaultMode: 'ultracave' }));
  writeFileSync(join(context.scratchDir, 'notes.md'), CAVEMAN_COMPRESS_SOURCE);
  writeFileSync(join(context.scratchDir, 'notes-nonl.md'), CAVEMAN_COMPRESS_SOURCE_NO_FINAL_NEWLINE);

  const session = startCavemanSession(context, env, { packagePath: pkg, captureName: 'rpc-tools.jsonl' });
  const evidence = session.capturePath;

  try {
    await waitForBadge(session, '[ULTRACAVE]', 'user config from XDG_CONFIG_HOME selected [ULTRACAVE]');
    const withNewline = await driveCompress(context, session, { callIndex: 1, path: 'notes.md' });
    const withoutNewline = await driveCompress(context, session, { callIndex: 2, path: 'notes-nonl.md' });
    writeRaw(context, 'compress-summary.json', { withNewline, withoutNewline });
    judgeCompress(receipts, context, withNewline, withoutNewline);

    const runs = {};
    for (const [index, role] of ROLES.entries()) {
      runs[role] = await runCrew(session, role, index + 1);
    }
    writeRaw(context, 'crew-role-evidence.json', { prompts: rolePromptEvidence(pkg), childReplies: Object.fromEntries(ROLES.map((role) => [role, runs[role].text])) });
    judgeCrewRoles(receipts, evidence, runs);

    const overridden = await driveCrew(
      context,
      {
        CAVECREW_INVESTIGATOR_MODEL: 'caveman-scripted/alt-investigator',
        CAVECREW_BUILDER_MODEL: 'caveman-scripted/alt-builder',
        CAVECREW_REVIEWER_MODEL: 'caveman-scripted/alt-reviewer',
      },
      pkg,
      'rpc-tools-overrides.jsonl',
    );
    judgeOverrides(receipts, overridden);

    const retrieve = await driveRetrieve(session);
    judgeRetrieveAndRuntime(
      receipts,
      evidence,
      retrieve.end,
      retrieve.text,
      noticeMessages(session).find((message) => message.includes('direct mode')),
    );
  } finally {
    await closeCavemanSessions(context);
  }
}
