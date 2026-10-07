import assert from 'node:assert/strict';

import { cancelFirstDialog, lastToolResult, messageText, startObserved } from './pstack-tools-lib.js';

const PACKAGE = 'extensions/pi-pstack';

function answeredPath(context) {
  const { session } = context;
  const result = lastToolResult(session, 'AskQuestion');
  assert.ok(result, 'no AskQuestion tool result recorded');
  const answers = JSON.parse(messageText(result));
  const dialogs = session.dialogs.filter((dialog) => dialog.request.method === 'select' || dialog.request.method === 'input');
  return { answers, dialogs };
}

export default async function pstackToolsQuestions(context) {
  const { session } = await startObserved(context, 'questions', {
    answers: {
      select: (request) => request.options[0],
      input: () => 'typed probe answer',
    },
  });
  let answered;
  let answeredCapture;
  try {
    await session.prompt('PT26_ANSWER');
    answered = answeredPath({ session });
    answeredCapture = session.capturePath;
  } finally {
    await session.close();
  }

  const cancelled = await cancelFirstDialog(context, 'PT26_CANCEL', 'questions-cancelled');
  const cancelledDialogs = cancelled.records.filter((record) => record.type === 'extension_ui_request' && record.method === 'select');
  const cancelledResult = JSON.parse(cancelled.result.result.content[0].text);

  context.receipts.assertVerdict({
    surfaceId: 'PS-TOOL-26',
    package: PACKAGE,
    expected: 'Ask the user a preference or required approval through Pi dialogs',
    observed: `answered path: ${answered.dialogs.length} dialogs (${answered.dialogs.map((dialog) => dialog.request.method).join(', ')}) answered ${JSON.stringify(answered.dialogs.map((dialog) => dialog.answer))} returned four entries ${JSON.stringify(answered.answers.map((answer) => answer.answers[0]))}; cancelled path: driver sent extension_ui_response{cancelled:true}, AskQuestion asked ${cancelledDialogs.length} select dialog and returned ${JSON.stringify(cancelledResult)}`,
    evidence: cancelled.capture,
    check: () => {
      assert.equal(answered.dialogs.length, 4, 'expected four dialogs for four questions');
      assert.ok(
        answered.dialogs.every((dialog) => dialog.request.method === 'select'),
        'expected select dialogs with options',
      );
      assert.equal(answered.answers.length, 4, 'expected four answers');
      assert.ok(
        answered.answers.every((answer) => answer.cancelled === false),
        'answered path reported cancellation',
      );
      assert.deepEqual(
        answered.answers.map((answer) => answer.answers[0]),
        ['opt1a', 'opt2a', 'opt3a', 'opt4a'],
      );
      assert.equal(cancelledDialogs.length, 1, 'cancellation should stop before the second question');
      assert.equal(cancelledResult.length, 1, 'cancellation returned an extra answer entry');
      assert.equal(cancelledResult[0].cancelled, true, 'cancellation was not reported as cancelled');
      assert.deepEqual(cancelledResult[0].answers, [], 'cancellation returned answers');
    },
  });
  context.log(`✓ pstack-tools-questions wrote 1 receipt (answered at ${answeredCapture}, cancelled at ${cancelled.capture})`);
}
