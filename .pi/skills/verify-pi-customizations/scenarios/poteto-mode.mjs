import assert from 'node:assert/strict';
import { join } from 'node:path';

export default async function potetoMode(context) {
  const { repoRoot, receipts, startSession, log } = context;
  const session = startSession({ packagePath: join(repoRoot, 'extensions/pi-pstack') });
  try {
    await session.prompt('/poteto-mode off');
    const notification = session.notifications.find((record) => record.message === 'Poteto mode is off.');
    const stateEntry = session.entries.find((entry) => entry.type === 'custom' && entry.customType === 'pstack-state' && entry.data?.enabled === false);

    receipts.assertVerdict({
      surfaceId: 'PS-UI-5',
      package: 'extensions/pi-pstack',
      expected: '/poteto-mode off sends the UI notification "Poteto mode is off."',
      observed: `notify message=${JSON.stringify(notification?.message)} notifyType=${JSON.stringify(notification?.notifyType)}`,
      evidence: session.capturePath,
      check: () => assert.ok(notification, 'Expected UI notification "Poteto mode is off." not observed'),
    });

    receipts.assertVerdict({
      surfaceId: 'PS-CMD-1',
      package: 'extensions/pi-pstack',
      expected: '/poteto-mode off appends a pstack-state custom entry with enabled false',
      observed: stateEntry ? `entry customType=pstack-state data=${JSON.stringify(stateEntry.data)}` : `no pstack-state entry; appended types: ${session.entries.map((entry) => entry.customType ?? entry.type).join(', ')}`,
      evidence: session.capturePath,
      check: () => {
        assert.ok(stateEntry, 'Expected pstack-state entry appended to branch');
        assert.equal(stateEntry.data?.enabled, false, 'State entry did not reflect enabled: false');
      },
    });
    log('✓ PS-UI-5 and PS-CMD-1 receipts written for poteto mode');
  } finally {
    await session.close();
  }
}
