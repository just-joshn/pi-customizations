import assert from 'node:assert/strict';
import { test } from 'node:test';

import { checkInteraction } from '../helpers/resource-workflows-local.mjs';

const modelCalls = (records) => checkInteraction(records, 'Hello Ada') ? [{ success: true }] : [];

test('unpaired successful tool text is not a completed model call', () => {
  assert.deepEqual(modelCalls([{ type: 'tool_execution_end', toolName: 'bash', toolCallId: 'fake', isError: false, result: { content: [{ type: 'text', text: 'Hello Ada' }] } }]), []);
});
