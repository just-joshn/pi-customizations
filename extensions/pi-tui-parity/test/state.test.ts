import { describe, expect, it } from 'vitest';
import { createSession, createSessionState, reduceSession } from '../src/state.ts';

describe('session state', () => {
  it('dispatch returns a fresh snapshot without touching the previous one', () => {
    const session = createSession();
    const before = session.read();

    const after = session.dispatch({ type: 'toggleRunEverything' });

    expect(after).not.toBe(before);
    expect(after.runEverything).toBe(true);
    expect(before.runEverything).toBe(false);
    expect(session.read()).toBe(after);
  });

  it('reduceSession never writes into the state it received', () => {
    const initial = createSessionState({ mode: 'plan', vim: 'normal' });

    const next = reduceSession(initial, { type: 'cycleMode' });

    expect(next.mode).toBe('debug');
    expect(initial.mode).toBe('plan');
    expect(initial.vim).toBe('normal');
    expect(next).not.toBe(initial);
  });

  it('toggleAsk alternates ask mode with the default mode', () => {
    const session = createSession();

    expect(session.dispatch({ type: 'toggleAsk' }).mode).toBe('ask');
    expect(session.dispatch({ type: 'toggleAsk' }).mode).toBe('default');
  });

  it('each set action stores its requested value', () => {
    const session = createSession();

    expect(session.dispatch({ type: 'setVim', vim: 'normal' }).vim).toBe('normal');
    expect(session.dispatch({ type: 'setMode', mode: 'debug' }).mode).toBe('debug');
  });

  it('createSessionState applies overrides over the defaults', () => {
    const state = createSessionState({ autoReview: true, compact: false });

    expect(state).toEqual({
      mode: 'default',
      customMode: undefined,
      runEverything: false,
      autoReview: true,
      vim: 'insert',
      compact: false,
    });
  });
});
