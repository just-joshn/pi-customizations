#!/usr/bin/env node
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createRpcSession } from '../lib/rpc.mjs';
import { compareSkillInjection, prepareRecorderDir, readJsonl, stripFrontmatter } from '../scenarios/lib/resource-surfaces.mjs';

const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO_ROOT = resolve(SKILL_DIR, '../../..');
const PACKAGE = 'extensions/pi-pstack';
const PROVIDER = join(SKILL_DIR, 'scenarios/lib/resource-recorder-provider.mjs');
const OBSERVER = join(SKILL_DIR, 'scenarios/lib/resource-input-observer.mjs');
const MUTATION = join(SKILL_DIR, 'scenarios/lib/resource-mutation-observer.mjs');
const SKILL = 'unslop';
const SENTINEL = 'SENTINEL-MUTATION-CONTROL';
const REPORT = join(REPO_ROOT, 'artifacts/user-perspective/resource-mutation-control/probe.json');

function contextFor(scratchDir, key) {
  return prepareRecorderDir({ scratchDir }, key, PROVIDER);
}

async function driveSkill({ agentDir, recorderPath, inputLogPath, mutationLogPath, mutate }) {
  const extraExtensions = [PROVIDER, OBSERVER, ...(mutate ? [MUTATION] : [])];
  const env = { RESOURCE_RECORDER_PATH: recorderPath, RESOURCE_INPUT_LOG: inputLogPath, ...(mutate ? { RESOURCE_MUTATION_LOG: mutationLogPath } : {}) };
  const session = createRpcSession({ packagePath: join(REPO_ROOT, PACKAGE), agentDir, cwd: agentDir, capturePath: join(agentDir, mutate ? 'capture-mutated.jsonl' : 'capture-normal.jsonl'), extraExtensions, env, requestTimeoutMs: 60000 });
  try {
    const commands = await session.commands();
    const command = commands.find((candidate) => candidate.name === `skill:${SKILL}`);
    assert.ok(command, `skill:${SKILL} is not registered by ${PACKAGE}`);
    const body = stripFrontmatter(readFileSync(command.sourceInfo.path, 'utf8'));
    assert.ok(body.length > 0, `${command.sourceInfo.path} stripped to an empty body`);
    const before = readJsonl(recorderPath).length;
    await session.prompt(`/skill:${SKILL} ${SENTINEL}`);
    const produced = readJsonl(recorderPath)
      .slice(before)
      .filter((record) => typeof record.userText === 'string');
    const record = produced.at(-1);
    const comparison = compareSkillInjection({ userText: record?.userText, name: SKILL, location: command.sourceInfo.path, body, args: SENTINEL });
    return { command, body, record, comparison, capture: session.capturePath };
  } finally {
    await session.close();
  }
}

function writeReport(payload) {
  mkdirSync(dirname(REPORT), { recursive: true });
  writeFileSync(REPORT, `${JSON.stringify(payload, null, 2)}\n`);
  return REPORT;
}

async function main() {
  const scratchDir = mkdtempSync(join(tmpdir(), 'resource-mutation-control-'));
  const normalDir = contextFor(scratchDir, 'normal');
  const mutatedDir = contextFor(scratchDir, 'mutated');
  writeFileSync(mutatedDir.inputLogPath, '');
  const mutationLogPath = join(mutatedDir.agentDir, 'mutations.jsonl');
  writeFileSync(mutationLogPath, '');

  try {
    const normal = await driveSkill({ ...normalDir, mutate: false });
    const mutated = await driveSkill({ ...mutatedDir, mutationLogPath, mutate: true });
    const mutations = readJsonl(mutationLogPath);
    // The comparator itself must separate a real injected block from a corrupted one.
    const corruptedBody = compareSkillInjection({ userText: normal.record.userText, name: SKILL, location: normal.command.sourceInfo.path, body: `${normal.body}\nMUTATED`, args: SENTINEL });
    const wrongLocation = compareSkillInjection({ userText: normal.record.userText, name: SKILL, location: '/tmp/not-the-skill.md', body: normal.body, args: SENTINEL });

    const checks = {
      normalMatched: normal.comparison.matched,
      mutatedRejected: mutated.comparison.matched === false,
      mutatedNamesMissingPayload: mutated.comparison.diff.includes('no <skill name='),
      mutationExecuted: mutations.length >= 1,
      corruptedBodyRejected: corruptedBody.matched === false,
      wrongLocationRejected: wrongLocation.matched === false,
    };
    const report = writeReport({
      skill: SKILL,
      sentinel: SENTINEL,
      sourcePath: normal.command.sourceInfo.path,
      bodyBytes: normal.body.length,
      normalUserText: normal.record?.userText,
      mutatedUserText: mutated.record?.userText,
      normalComparison: normal.comparison,
      mutatedComparison: mutated.comparison,
      corruptedBodyComparison: corruptedBody,
      wrongLocationComparison: wrongLocation,
      mutationCount: mutations.length,
      checks,
      captures: { normal: normal.capture, mutated: mutated.capture },
    });
    for (const [name, ok] of Object.entries(checks)) process.stdout.write(`${ok ? '✓' : '✗'} ${name}\n`);
    process.stdout.write(`report ${report}\n`);
    assert.equal(checks.normalMatched, true, 'the unmutated drive must match the real skill body');
    assert.equal(checks.mutatedRejected, true, 'the mutated drive must be rejected');
    assert.equal(checks.mutationExecuted, true, 'the mutation input transform never ran');
    assert.equal(checks.corruptedBodyRejected, true, 'the comparator accepted a corrupted body');
    assert.equal(checks.wrongLocationRejected, true, 'the comparator accepted a wrong location');
  } finally {
    rmSync(scratchDir, { recursive: true, force: true });
  }
}

await main();
