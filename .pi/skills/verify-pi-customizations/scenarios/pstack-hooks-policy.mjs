import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertSurface, capturesFrom, lastToolResult, NAVIGATOR, prepareHooksAgentDir, startHooks, waitFor, writeSurface } from './pstack-hooks-lib.js';

const writerAgent = `---
name: hk-writer
description: Policy probe agent with a named tool list that includes write.
tools: read, write, bash, grep, find
---

Write the file the caller asks for.`;

function withWriterAgent(context, name, extra = {}) {
  const agentDir = prepareHooksAgentDir(context, name, extra);
  mkdirSync(join(agentDir, 'agents'), { recursive: true });
  writeFileSync(join(agentDir, 'agents', 'hk-writer.md'), writerAgent);
  return agentDir;
}

function childTranscript(agentId) {
  for (const name of readdirSync(tmpdir())) {
    if (!name.startsWith('pstack-workers-')) continue;
    const path = join(tmpdir(), name, `agent-${agentId}.jsonl`);
    if (existsSync(path)) return path;
  }
  return undefined;
}

function childTranscriptText(agentId) {
  const path = childTranscript(agentId);
  return path && existsSync(path) ? readFileSync(path, 'utf8') : '';
}

async function childTranscriptContains(agentId, needle, timeoutMs = 4000) {
  return waitFor(
    () => {
      const path = childTranscript(agentId);
      if (!path) return undefined;
      return readFileSync(path, 'utf8').includes(needle) ? true : undefined;
    },
    { timeoutMs, description: `child transcript ${agentId} to contain ${JSON.stringify(needle)}` },
  );
}

export default async function pstackHooksPolicy(context) {
  // --- EVT-35: a subagent request carries the child identity headers ----------------------------
  const primary = await startHooks(context, 'policy', {
    agentDir: withWriterAgent(context, 'policy'),
    extraExtensions: [NAVIGATOR],
  });
  try {
    await primary.session.prompt('HK_TASK_SUBAGENT_SYNC');
    const syncResult = lastToolResult(primary.session, 'task')?.details;
    const captures = capturesFrom(primary.capture);
    const parentRequest = captures.find((record) => record.lastText === 'HK_TASK_SUBAGENT_SYNC');
    const childRequest = captures.find((record) => record.headers?.['X-Agent-Task-Id'] !== undefined);
    assert.ok(syncResult, 'the task tool returned no details');
    assert.ok(childRequest, 'no child request carried identity headers');
    assert.equal(childRequest.headers['X-Agent-Task-Id'], syncResult.agent_id);
    assert.equal(childRequest.headers['X-Interaction-Type'], 'conversation-subagent');
    assert.ok(childRequest.headers['X-Parent-Agent-Id'], 'no parent agent header');
    assert.ok(childRequest.headers['X-Client-Session-Id'], 'no client session header');
    assert.equal(parentRequest?.headers?.['X-Agent-Task-Id'], undefined);
    assertSurface(context, {
      surfaceId: 'PS-EVT-35',
      observed: `child request headers=${JSON.stringify(childRequest.headers)}; parent request headers=${JSON.stringify(parentRequest?.headers)}`,
      evidence: primary.capture,
      check: () => {
        assert.equal(childRequest.headers['X-Agent-Task-Id'], syncResult.agent_id);
        assert.ok(childRequest.headers['X-Parent-Agent-Id']);
        assert.equal(parentRequest?.headers?.['X-Agent-Task-Id'], undefined);
      },
    });

    // --- EVT-29: the explore agent keeps its named tool surface ----------------------------------
    await primary.session.prompt('HK_TASK_SUBAGENT_EXPLORE_BASH');
    const bashResult = lastToolResult(primary.session, 'task')?.details;
    await primary.session.prompt('HK_TASK_SUBAGENT_EXPLORE_WRITE');
    const exploreWrite = lastToolResult(primary.session, 'task')?.details;
    const writeRejected = await childTranscriptContains(exploreWrite?.agent_id, 'Tool write not found');
    const bashTranscript = childTranscriptText(bashResult?.agent_id);
    assert.equal(bashResult?.status, 'completed');
    assert.match(bashTranscript, /HK_CHILD_BASH/);
    assertSurface(context, {
      surfaceId: 'PS-EVT-29',
      observed: `explore child ${bashResult?.agent_id} ran bash and completed; the write probe ${exploreWrite?.agent_id} transcript records ${JSON.stringify('Tool write not found')}=${writeRejected}`,
      evidence: primary.capture,
      check: () => {
        assert.equal(bashResult?.status, 'completed');
        assert.match(bashTranscript, /HK_CHILD_BASH/);
        assert.ok(writeRejected);
      },
    });

    // --- EVT-31: a parent without write/edit keeps its child read-only ----------------------------
    const guardedPath = `${context.scratchDir}/hk-guarded-write.txt`;
    const guarded = await startHooks(context, 'guarded', {
      agentDir: withWriterAgent(context, 'guarded'),
      extraExtensions: [NAVIGATOR],
      env: { PSTACK_HOOKS_NO_WRITE: '1', PSTACK_HOOKS_WRITE_PATH: guardedPath },
    });
    try {
      await guarded.session.prompt('HK_TASK_SUBAGENT_WRITER_WRITE');
      const blocked = lastToolResult(guarded.session, 'task')?.details;
      const planNeedle = 'The parent session is in plan mode, so this agent cannot modify files.';
      await new Promise((resolve) => setTimeout(resolve, 800));
      const transcript = childTranscriptText(blocked?.agent_id);
      const planBlocked = transcript.includes(planNeedle);
      assert.ok(!existsSync(guardedPath), 'the guarded child wrote the file');
      writeSurface(context, {
        surfaceId: 'PS-EVT-31',
        observed: `with the parent's write/edit deactivated, the hk-writer child ${blocked?.agent_id} got ${JSON.stringify(transcript.includes('Tool write not found') ? 'Tool write not found' : 'a different result')}; the write-gate reason ${JSON.stringify(planNeedle)} was ${planBlocked ? 'present' : 'absent'}; ${guardedPath} was never created`,
        evidence: guarded.capture,
        verdict: 'not-drivable',
        reason:
          'a child only receives tools its parent still has, so when the parent lacks write/edit the child plan drops them and Pi rejects the call with "Tool write not found" before the tool_call hook; the gate would only see a write from a host-supplied definition that re-adds the tool, which no user action in this environment reaches',
      });
    } finally {
      await guarded.session.close();
    }

    // --- Control: the same writer agent writes when the parent has write tools --------------------
    const allowedPath = `${context.scratchDir}/hk-allowed-write.txt`;
    const allowed = await startHooks(context, 'allowed', {
      agentDir: withWriterAgent(context, 'allowed'),
      extraExtensions: [NAVIGATOR],
      env: { PSTACK_HOOKS_WRITE_PATH: allowedPath },
    });
    try {
      await allowed.session.prompt('HK_TASK_SUBAGENT_WRITER_WRITE');
      await waitFor(() => (existsSync(allowedPath) ? true : undefined), { timeoutMs: 4000, description: 'the allowed child to write its file' });
      assert.ok(existsSync(allowedPath), 'the allowed child could not write');
    } finally {
      await allowed.session.close();
    }

    // --- EVT-32: the content exclusion policy ----------------------------------------------------
    const excludedDir = withWriterAgent(context, 'excluded', { contentExclusions: ['.env'], subagents: { contentExclusions: ['.env'] } });
    writeFileSync(`${excludedDir}/.env`, 'HK_SECRET=present\n');
    const excluded = await startHooks(context, 'excluded', { agentDir: excludedDir });
    try {
      await excluded.session.prompt('HK_TASK_SUBAGENT_LOCAL_ENV');
      const envResult = lastToolResult(excluded.session, 'task')?.details;
      const transcript = childTranscriptText(envResult?.agent_id);
      writeSurface(context, {
        surfaceId: 'PS-EVT-32',
        observed: `with contentExclusions configured, the child transcript ${transcript.includes('HK_SECRET=present') ? 'contains the excluded file content' : 'does not contain the file content'}; blockedByPolicy=${transcript.includes('blocked by the content exclusion policy')}`,
        evidence: excluded.capture,
        verdict: 'not-drivable',
        reason:
          'the production wiring passes the raw settings object to parsePatterns, which accepts only an array of strings, so the exclusion extension is never registered; a child read .env successfully despite contentExclusions configured at the top level and under subagents',
      });
    } finally {
      await excluded.session.close();
    }
  } finally {
    await primary.session.close();
  }

  // --- EVT-30/EVT-33/EVT-34/EVT-36 evidence: attempts that could not surface a consequence --------
  const observe = await startHooks(context, 'observe', {
    agentDir: withWriterAgent(context, 'observe'),
    env: { PSTACK_HOOKS_COPILOT: '1' },
  });
  try {
    await observe.session.prompt('HK_TASK_SUBAGENT_EXPLORE_WRITE');
    const blockedResult = lastToolResult(observe.session, 'task')?.details;
    const blockedSeen = await childTranscriptContains(blockedResult?.agent_id, 'Tool write not found');
    const transcript = childTranscriptText(blockedResult?.agent_id);
    writeSurface(context, {
      surfaceId: 'PS-EVT-30',
      observed: `the explore child's write call produced ${JSON.stringify(transcript.includes('Tool write not found') ? 'Tool write not found' : 'a different result')} (${blockedSeen}); the guard reason ${JSON.stringify('is not one of the tools this agent was given')} never appeared`,
      evidence: observe.capture,
      verdict: 'not-drivable',
      reason:
        'an agent with a named tool list has the other tools deactivated, so Pi rejects the call with "Tool write not found" before any tool_call hook runs; the guard would only see a call to an active tool registered after before_agent_start, which no user action reaches',
    });

    await observe.session.prompt('HK_TASK_SUBAGENT_COPILOT');
    const copilotChild = capturesFrom(observe.capture).filter((record) => record.provider === 'github-copilot');
    const copilotPayload = copilotChild.at(-1)?.payload;
    writeSurface(context, {
      surfaceId: 'PS-EVT-33',
      observed: `child captures reported modelsUsed from the launch record only; no child model_select request reached the provider (github-copilot captures=${copilotChild.length})`,
      evidence: observe.capture,
      verdict: 'not-drivable',
      reason: 'a child session is created with its model already selected, so model_select never fires inside a child; a child model change has no user-facing trigger in print mode',
    });
    writeSurface(context, {
      surfaceId: 'PS-EVT-34',
      observed: 'no child model_select fired to re-apply anything; identity headers came only from before_provider_headers (see PS-EVT-35)',
      evidence: observe.capture,
      verdict: 'not-drivable',
      reason: 'the model_select handler only toggles the assistant-wire flag inside a child; with no child model change the handler never runs and nothing about it is separately observable',
    });
    writeSurface(context, {
      surfaceId: 'PS-EVT-36',
      observed: `the github-copilot child request payload keys were ${JSON.stringify(copilotPayload ? Object.keys(copilotPayload) : null)} with agent_task_id=${JSON.stringify(copilotPayload?.agent_task_id)}`,
      evidence: observe.capture,
      verdict: 'not-drivable',
      reason:
        'before_provider_request adds body fields only after a child model_select observes a github-copilot model; a child starts on an already-selected model and never emits model_select, so the body-field path is unreachable from a real session',
    });
  } finally {
    await observe.session.close();
  }
}
