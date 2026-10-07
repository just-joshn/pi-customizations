import assert from 'node:assert/strict';

import { lastToolResult, messageText, prepareChildAgentDir, startObserved } from './pstack-tools-lib.js';

const PACKAGE = 'extensions/pi-pstack';

function result(session, toolName) {
  const message = lastToolResult(session, toolName);
  assert.ok(message, `no ${toolName} tool result recorded`);
  return { text: messageText(message), details: message.details };
}

export default async function pstackToolsSubagents(context) {
  const agentDir = prepareChildAgentDir(context, 'subagents-agent');
  const { session, observerFile } = await startObserved(context, 'subagents', { agentDir, cwd: agentDir });
  try {
    await session.prompt('PT28_SYNC');
    const sync = result(session, 'task');

    await session.prompt('PT28_BG_HOLD');
    const background = result(session, 'task');
    const agentId = background.details.agent_id;

    await session.prompt('PT29_READ_LAST');
    const read = result(session, 'read_agent');

    await session.prompt('PT30_WRITE_LAST');
    const written = result(session, 'write_agent');

    await session.prompt('PT29_READ_LAST');
    const readAgain = result(session, 'read_agent');

    await session.prompt('PT31_LIST');
    const listed = result(session, 'list_agents');

    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-28',
      package: PACKAGE,
      expected: 'Delegates to a built-in/custom agent in a child context',
      observed: `sync task result text=${JSON.stringify(sync.text)} details=${JSON.stringify({ agent_id: sync.details.agent_id, agent_type: sync.details.agent_type, status: sync.details.status, mode: sync.details.mode })}; background start text=${JSON.stringify(background.text.slice(0, 80))} details.status=${background.details.status}`,
      evidence: observerFile,
      check: () => {
        assert.equal(sync.details.agent_type, 'general-purpose', 'sync task launched a different agent type');
        assert.equal(sync.details.status, 'completed', 'sync task did not complete');
        assert.equal(sync.details.mode, 'sync', 'sync task reported a different mode');
        assert.match(sync.text, /scripted fixture reply/, 'sync task did not return the child final text');
        assert.equal(background.details.mode, 'background', 'background task reported a different mode');
        assert.match(background.text, /Agent started in background with agent_id:/, 'background task did not return an id');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-29',
      package: PACKAGE,
      expected: "Read a background agent's status and output",
      observed: `read_agent(agent_id=${agentId}, wait: true) text=${JSON.stringify(read.text.slice(0, 120))} details=${JSON.stringify({ agent_id: read.details.agent_id, status: read.details.status })}; after write_agent the same read reported total_turns=${/total_turns: (\d+)/.exec(readAgain.text)?.[1]}`,
      evidence: session.capturePath,
      check: () => {
        assert.equal(read.details.agent_id, agentId, 'read_agent returned a different agent');
        assert.equal(read.details.status, 'idle', 'read_agent did not settle the background agent');
        assert.match(read.text, /scripted fixture reply/, 'read_agent did not return the child output');
        assert.match(readAgain.text, /total_turns: 2/, 'the second read did not observe the follow-up turn');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-30',
      package: PACKAGE,
      expected: 'Sends a follow-up to a running/idle background agent',
      observed: `write_agent(${agentId}) text=${JSON.stringify(written.text)} details.agent_id=${written.details.agent_id}; next read_agent saw total_turns=${/total_turns: (\d+)/.exec(readAgain.text)?.[1]} and turn 1 ${readAgain.text.includes('[Turn 1]') ? 'present' : 'absent'}`,
      evidence: session.capturePath,
      check: () => {
        assert.equal(written.details.agent_id, agentId, 'write_agent answered for a different agent');
        assert.match(written.text, new RegExp(`Message sent to agent ${agentId}`), 'write_agent did not confirm delivery');
        assert.match(readAgain.text, /\[Turn 1\]/, 'the follow-up turn is missing from the next read');
      },
    });
    context.receipts.assertVerdict({
      surfaceId: 'PS-TOOL-31',
      package: PACKAGE,
      expected: 'Lists started agents',
      observed: `list_agents text=${JSON.stringify(listed.text)}`,
      evidence: session.capturePath,
      check: () => {
        assert.match(listed.text, new RegExp(`agent_id: ${agentId}`), 'list_agents did not list the background agent');
        assert.match(listed.text, /status: idle/, 'list_agents did not report the idle status');
      },
    });
  } finally {
    await session.close();
  }
  context.log('✓ pstack-tools-subagents wrote 4 receipts');
}
