import assert from 'node:assert/strict';
import { join } from 'node:path';

const STATUS_PATTERN = /pstack \d+\.\d+\.\d+/;
const COUNTS = '71 skills, 69 prompt templates';

function pstackStatusMessages(messages) {
  return messages.filter((message) => message.role === 'custom' && message.customType === 'pstack-status');
}

function textOf(message) {
  return String(message?.content ?? '');
}

export default async function pstackStatus(context) {
  const { repoRoot, receipts, startSession, log } = context;
  const session = startSession({ packagePath: join(repoRoot, 'extensions/pi-pstack') });
  try {
    await session.prompt('/pstack status');
    const statusMessages = pstackStatusMessages(await session.messages());
    const statusText = textOf(statusMessages.at(-1));

    await session.prompt('/pstack todos');
    const afterTodos = pstackStatusMessages(await session.messages());
    const todosText = textOf(afterTodos.at(-1));
    const statusLine = statusText.split('\n').find((line) => STATUS_PATTERN.test(line)) ?? '';

    receipts.assertVerdict({
      surfaceId: 'PS-CMD-4',
      package: 'extensions/pi-pstack',
      expected: '/pstack status and /pstack todos each post a pstack-status custom message, and an empty branch reports "Todos: none."',
      observed: `${afterTodos.length} pstack-status messages; latest line: ${JSON.stringify(todosText.split('\n').at(-1))}`,
      evidence: session.capturePath,
      check: () => {
        assert.ok(statusMessages.length > 0, 'Expected pstack-status message not received');
        assert.ok(afterTodos.length > statusMessages.length, 'Expected /pstack todos to append a pstack-status message');
        assert.match(todosText, /Todos: none\./);
      },
    });

    receipts.assertVerdict({
      surfaceId: 'PS-UI-8',
      package: 'extensions/pi-pstack',
      expected: 'the status block reports the pstack version, the team-kit version, and bundled resource counts of 71 skills and 69 prompt templates',
      observed: statusLine || `no version line; status text: ${JSON.stringify(statusText)}`,
      evidence: session.capturePath,
      check: () => {
        assert.match(statusText, STATUS_PATTERN);
        assert.match(statusText, /team-kit/);
        assert.ok(statusText.includes(COUNTS), `Expected status block to include '${COUNTS}'`);
      },
    });
    log('✓ PS-CMD-4 and PS-UI-8 receipts written for pstack status');
  } finally {
    await session.close();
  }
}
