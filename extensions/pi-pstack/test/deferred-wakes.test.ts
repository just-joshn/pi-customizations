import type { AgentSession, BoundaryContextPreview, ExtensionFactory } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { DeferredWakes } from '../src/deferred-wakes.ts';
import { fixture, prompt } from './session-fixture.ts';

const notice = { customType: 'deferred-wake-test', content: 'Finished work.', display: true };

function notices(session: AgentSession) {
  return session.messages.filter((message) => message.role === 'custom' && message.customType === notice.customType);
}

async function run(extension: ExtensionFactory, check: (session: AgentSession) => Promise<void>) {
  const f = await fixture({ extensionDisabled: true, extensionFactories: [extension] });
  try {
    const { session } = await f.open();
    await check(session);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
}

test('an idle parent receives a wake immediately without holding it for a boundary', async () => {
  let wakes: DeferredWakes | undefined;
  await run(
    (pi) => {
      wakes = new DeferredWakes(pi);
    },
    async (session) => {
      wakes?.send('work', true, notice);
      await session.waitForIdle();
      expect(notices(session)).toHaveLength(1);
      await prompt(session, 'clean run');
      expect(notices(session)).toHaveLength(1);
    },
  );
});

test('a held wake reaches the next request before final settlement exactly once', async () => {
  let boundaries = 0;
  let initiallyRunnable: boolean | undefined;
  await run(
    (pi) => {
      pi.on('agent_before_settle', (event) => {
        if (boundaries === 0) initiallyRunnable = event.context.canContinue;
      });
      const wakes = new DeferredWakes(pi);
      pi.on('agent_end', () => {
        if (boundaries === 0) wakes.send('work', false, notice);
      });
      pi.on('agent_before_settle', (event) => {
        boundaries++;
        if (boundaries === 1) expect(event.context.pendingMessages).toContainEqual(expect.objectContaining(notice));
      });
    },
    async (session) => {
      await prompt(session, 'start');
      expect(initiallyRunnable).toBe(false);
      expect(boundaries).toBe(2);
      expect(notices(session)).toHaveLength(1);
    },
  );
});

test.for(['drop', 'clear'])('%s suppresses a held wake before either hook delivers it', async (operation) => {
  await run(
    (pi) => {
      const wakes = new DeferredWakes(pi);
      pi.on('agent_end', () => {
        wakes.send('work', false, notice);
        if (operation === 'drop') wakes.drop('work');
        else wakes.clear();
      });
    },
    async (session) => {
      await prompt(session, 'consume');
      expect(notices(session)).toEqual([]);
    },
  );
});

test('a wake added by a later boundary handler is retained for the next boundary', async () => {
  let boundaries = 0;
  await run(
    (pi) => {
      const wakes = new DeferredWakes(pi);
      pi.on('agent_end', () => {
        if (boundaries === 0) wakes.send('first', false, notice);
      });
      pi.on('agent_before_settle', () => {
        if (++boundaries === 1) wakes.send('second', false, { ...notice, content: 'Second work.' });
      });
    },
    async (session) => {
      await prompt(session, 'start');
      expect(notices(session).map((message) => (message.role === 'custom' ? message.content : undefined))).toEqual(['Finished work.', 'Second work.']);
      expect(boundaries).toBe(3);
    },
  );
});

test('an abort during the boundary leaves the native queued wake for one clean retry', async () => {
  let abort: (() => Promise<void>) | undefined;
  let aborted: Promise<void> | undefined;
  let boundaries = 0;
  await run(
    (pi) => {
      const wakes = new DeferredWakes(pi);
      pi.on('agent_end', () => {
        if (boundaries === 0) wakes.send('work', false, notice);
      });
      pi.on('agent_before_settle', () => {
        if (++boundaries === 1) aborted = abort?.();
      });
    },
    async (session) => {
      abort = () => session.abort();
      await prompt(session, 'start');
      await aborted;
      expect(notices(session)).toEqual([]);
      await prompt(session, 'retry');
      expect(notices(session)).toHaveLength(1);
      await prompt(session, 'another clean run');
      expect(notices(session)).toHaveLength(1);
    },
  );
});

test('a later handler removing runnable context preserves the native wake for one clean retry', async () => {
  let boundaries = 0;
  let runnable: boolean | undefined;
  await run(
    (pi) => {
      const wakes = new DeferredWakes(pi);
      pi.on('agent_end', () => {
        if (boundaries === 0) wakes.send('work', false, notice);
      });
      pi.on('agent_before_settle', (event) => {
        if (++boundaries !== 1) return;
        return {
          entries: [
            ...event.entries,
            ...event.context.contextEntries.flatMap(({ sourceEntry: entry }) => (entry.type === 'message' && entry.message.role !== 'system' ? [{ type: 'context_edit' as const, targetId: entry.id, replacement: null }] : [])),
          ],
        };
      });
      pi.on('agent_before_settle', (event) => {
        if (boundaries === 1) {
          runnable = event.context.canContinue;
        }
      });
    },
    async (session) => {
      await prompt(session, 'start');
      expect(runnable).toBe(false);
      expect(notices(session)).toEqual([]);
      await prompt(session, 'clean retry restores runnable context');
      expect(notices(session)).toHaveLength(1);
      await prompt(session, 'another clean run');
      expect(notices(session)).toHaveLength(1);
    },
  );
});

test.for(['aborted', 'error'])('a %s run postpones a held wake through both hooks until a clean retry', async (reason) => {
  let wakes: DeferredWakes | undefined;
  let context: BoundaryContextPreview | undefined;
  await run(
    (pi) => {
      wakes = new DeferredWakes(pi);
      pi.on('agent_before_settle', (event) => {
        context = event.context;
      });
    },
    async (session) => {
      await prompt(session, 'initial clean run');
      wakes?.send('work', false, notice);
      const assistant = session.messages.findLast((message) => message.role === 'assistant');
      if (assistant?.role !== 'assistant' || !context) throw new Error('Missing fixture boundary');
      if (reason !== 'aborted' && reason !== 'error') throw new Error('Invalid fixture reason');
      await session.extensionRunner.emit({ type: 'agent_end', messages: [{ ...assistant, stopReason: reason }] });
      const preview = context;
      await session.extensionRunner.emitBoundary({ type: 'agent_before_settle', outcome: reason }, () => preview);
      await session.extensionRunner.emit({ type: 'agent_settled' });
      expect(notices(session)).toEqual([]);
      await prompt(session, 'clean retry');
      expect(notices(session)).toHaveLength(1);
    },
  );
});

test('the settlement fallback delivers a wake arriving after the actionable handler once', async () => {
  let sent = false;
  await run(
    (pi) => {
      const wakes = new DeferredWakes(pi);
      pi.on('agent_before_settle', () => {
        if (!sent) {
          sent = true;
          wakes.send('late', false, notice);
        }
      });
    },
    async (session) => {
      await prompt(session, 'start');
      await session.waitForIdle();
      expect(notices(session)).toHaveLength(1);
      await prompt(session, 'retry');
      expect(notices(session)).toHaveLength(1);
    },
  );
});
