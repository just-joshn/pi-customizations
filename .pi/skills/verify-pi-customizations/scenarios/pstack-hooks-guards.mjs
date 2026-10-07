import assert from 'node:assert/strict';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { buildGuardControl } from '../lib/control-package.mjs';
import { expectedFor, lastToolResult, notifications, PACKAGE_PATH, prepareHooksAgentDir, startHooks, waitFor } from './pstack-hooks-lib.js';

const NAVIGATOR = fileURLToPath(new URL('./pstack-hooks-navigator.js', import.meta.url));
const MCP_SERVER = fileURLToPath(new URL('./pstack-hooks-mcp-server.js', import.meta.url));

const planModeMessage = 'The parent session is in plan mode, so this agent cannot modify files.';
const toolPolicyMessage = 'is not one of the tools this agent was given';
const mcpTool = 'mcp__hkmcp__hk_echo';

const writerAgent = `---
name: hk-writer
description: Write gate probe agent with a named tool list that includes write.
tools: read, write, bash, grep, find
---

Write the file the caller asks for.`;

const policyAgent = `---
name: hk-policy
description: Tool policy probe agent whose named tool list excludes every MCP tool.
tools: read, grep
---

Read the file the caller asks for.`;

function agentDirWith(context, name, agentFile, agentBody, settings = {}) {
  const agentDir = prepareHooksAgentDir(context, name, settings);
  mkdirSync(join(agentDir, 'agents'), { recursive: true });
  writeFileSync(join(agentDir, 'agents', agentFile), agentBody);
  return agentDir;
}

function taskRecord(session, agentId) {
  return session.records
    .filter((record) => record.type === 'entry_appended' && record.entry?.customType === 'reference-assistant-agent')
    .map((record) => record.entry.data)
    .findLast((data) => data?.id === agentId && typeof data?.sessionFile === 'string' && data.sessionFile !== '');
}

async function transcriptWhen(session, agentId, predicate, description, timeoutMs = 90000) {
  const record = await waitFor(() => taskRecord(session, agentId) ?? undefined, { timeoutMs: 30000, description: `a pstack-task record for ${agentId}` });
  const path = record.sessionFile;
  const text = await waitFor(
    () => {
      if (!existsSync(path)) return undefined;
      const value = readFileSync(path, 'utf8');
      return predicate(value) ? value : undefined;
    },
    { timeoutMs, description },
  );
  return { path, text };
}

async function holdChild(barrier, description, timeoutMs = 60000) {
  if (typeof barrier !== 'string') throw new Error(`holdChild needs a barrier path, got ${typeof barrier}`);
  return waitFor(() => (existsSync(`${barrier}.child-ready`) ? true : undefined), { timeoutMs, description });
}

async function setPlanMode(session) {
  await session.prompt('/hk-gate plan');
  const notice = await waitFor(() => notifications(session).find((record) => (record.message ?? '').startsWith('hk-gate plan ')), { timeoutMs: 10000, description: 'the hk-gate plan notification' });
  const text = notice.message;
  const before = JSON.parse(text.slice(text.indexOf('before=') + 'before='.length, text.indexOf(' active=')));
  const active = JSON.parse(text.slice(text.indexOf('active=') + 'active='.length));
  assert.ok(before.includes('write') && before.includes('edit'), `the parent lacked write/edit before the gate: ${text}`);
  assert.ok(!active.includes('write') && !active.includes('edit'), `the parent still had write/edit after the gate: ${text}`);
  return text;
}

async function runWriteGate(context, { label, packagePath }) {
  const barrier = join(context.scratchDir, `gate-${label}`);
  const writePath = join(context.scratchDir, `gated-write-${label}.txt`);
  const { session, capture } = await startHooks(context, `gate-${label}`, {
    agentDir: agentDirWith(context, `gate-${label}`, 'hk-writer.md', writerAgent),
    packagePath,
    extraExtensions: [NAVIGATOR],
    env: { PSTACK_HOOKS_BARRIER: barrier, PSTACK_HOOKS_WRITE_PATH: writePath },
  });
  try {
    await session.prompt('HK_TASK_SUBAGENT_GATE_WRITE');
    const launched = lastToolResult(session, 'task')?.details;
    assert.ok(launched?.agent_id, 'the write gate task returned no agent id');
    await holdChild(barrier, 'the writer child to park before its write call');
    const notice = await setPlanMode(session);
    writeFileSync(`${barrier}.go`, 'go\n');
    const { path, text } = await transcriptWhen(session, launched.agent_id, (value) => value.includes('HK_GATE_DONE'), 'the writer child to finish');
    const evidence = join(context.rawDir, `gate-${label}-child.jsonl`);
    copyFileSync(path, evidence);
    return { agentId: launched.agent_id, capture, transcript: evidence, text, notice, wroteFile: existsSync(writePath), writePath };
  } finally {
    await session.close();
  }
}

async function runToolPolicy(context, { label, packagePath }) {
  const barrier = join(context.scratchDir, `policy-${label}`);
  const readPath = join(context.scratchDir, `policy-read-${label}.txt`);
  writeFileSync(readPath, 'policy read probe\n');
  const agentDir = agentDirWith(context, `policy-${label}`, 'hk-policy.md', policyAgent);
  writeFileSync(join(agentDir, 'mcp.json'), `${JSON.stringify({ mcpServers: { hkmcp: { command: process.execPath, args: [MCP_SERVER], exposure: 'direct' } } }, null, 2)}\n`);
  const { session, capture } = await startHooks(context, `policy-${label}`, {
    agentDir,
    packagePath,
    env: { PSTACK_HOOKS_BARRIER: barrier, PSTACK_HOOKS_READ_PATH: readPath },
  });
  try {
    await session.prompt('HK_TASK_SUBAGENT_GATE_POLICY');
    const launched = lastToolResult(session, 'task')?.details;
    assert.ok(launched?.agent_id, 'the tool policy task returned no agent id');
    await holdChild(barrier, 'the policy child to park before its read call', 90000);
    writeFileSync(`${barrier}.release`, 'release\n');
    const { path, text } = await transcriptWhen(session, launched.agent_id, (value) => value.includes('HK_GATE_DONE'), 'the policy child to finish');
    const evidence = join(context.rawDir, `policy-${label}-child.jsonl`);
    copyFileSync(path, evidence);
    const declared = readFileSync(capture, 'utf8')
      .split('\n')
      .filter((line) => line !== '')
      .some((line) => (JSON.parse(line).toolNames ?? []).includes(mcpTool));
    return { agentId: launched.agent_id, capture, transcript: evidence, text, declared, called: existsSync(`${barrier}.mcp-called`) };
  } finally {
    await session.close();
  }
}

function writeReceipt(context, { surfaceId, observed, evidence, reason }) {
  return context.receipts.write({
    surfaceId,
    package: 'extensions/pi-pstack',
    expected: expectedFor(context, surfaceId),
    observed,
    evidence,
    verdict: reason === undefined ? 'verified' : 'failed',
    scope: 'behaviour',
    ...(reason === undefined ? {} : { reason }),
  });
}

export default async function pstackHooksGuards(context) {
  const production = PACKAGE_PATH(context);
  const writeControl = buildGuardControl(context, 'write-gate');
  const policyControl = buildGuardControl(context, 'tool-policy');
  writeFileSync(join(context.rawDir, 'control-packages.json'), `${JSON.stringify({ 'write-gate': writeControl.removed, 'tool-policy': policyControl.removed }, null, 2)}\n`);

  const write = await runWriteGate(context, { label: 'production', packagePath: production });
  const writeOmitted = await runWriteGate(context, { label: 'control', packagePath: writeControl.packagePath });
  const writeBlocked = write.text.includes(planModeMessage);
  const writeNotFound = write.text.includes('Tool write not found');
  const controlWrote = writeOmitted.wroteFile && writeOmitted.text.includes('HK_GATE_DONE') && !writeOmitted.text.includes(planModeMessage);
  writeReceipt(context, {
    surfaceId: 'PS-EVT-31',
    observed: `parent write/edit active at child creation then removed via /hk-gate plan (${write.notice}); the parked hk-writer child then got ${JSON.stringify(writeBlocked ? planModeMessage : writeNotFound ? 'Tool write not found' : 'a different result')}; gated file exists=${write.wroteFile}; control package with writeGateExtension omitted wrote the file=${writeOmitted.wroteFile}`,
    evidence: write.capture,
    reason: writeBlocked && !writeNotFound && !write.wroteFile && controlWrote ? undefined : 'the write-gate refusal was not observed with the guard present, or the guard-omitted control did not write',
  });

  const policy = await runToolPolicy(context, { label: 'production', packagePath: production });
  const policyOmitted = await runToolPolicy(context, { label: 'control', packagePath: policyControl.packagePath });
  const policyBlocked = policy.text.includes(`${mcpTool} ${toolPolicyMessage}`);
  const policyNotFound = policy.text.includes(`Tool ${mcpTool} not found`);
  const controlCalled = policyOmitted.called && !policyOmitted.text.includes(toolPolicyMessage);
  writeReceipt(context, {
    surfaceId: 'PS-EVT-30',
    observed: `the tool policy child's turn after the MCP server connected called ${mcpTool}; the request declared it to the model=${policy.declared}; the transcript recorded ${JSON.stringify(policyBlocked ? `${mcpTool} ${toolPolicyMessage}` : policyNotFound ? `Tool ${mcpTool} not found` : 'a different result')}; mcp tools/call reached the server=${policy.called}; control package with toolPolicyExtension omitted executed the call=${policyOmitted.called}`,
    evidence: policy.capture,
    reason: policyBlocked && !policyNotFound && policy.declared && !policy.called && controlCalled ? undefined : 'the tool-policy refusal was not observed with the guard present, or the guard-omitted control did not execute the call',
  });
}
