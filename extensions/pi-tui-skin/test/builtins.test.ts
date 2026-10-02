import { SettingsManager } from '@earendil-works/pi-coding-agent';
import { describe, expect, test, vi } from 'vitest';
import { loadToolSettings } from '../src/tools/builtins.ts';

function failSettingsRead(message: string): void {
  vi.spyOn(SettingsManager, 'create').mockImplementation(() => {
    throw new Error(message);
  });
}

describe('tool settings loading', () => {
  test('a readable settings store loads without a fallback', () => {
    const settings = loadToolSettings('/tmp/workspace');

    expect(settings.kind).toBe('loaded');
  });

  test('unreadable settings fall back with the reason', () => {
    const consoleError = vi.spyOn(console, 'error');
    failSettingsRead('settings.json is not valid JSON');

    const settings = loadToolSettings('/tmp/workspace');

    expect(settings.kind).toBe('fallback');
    if (settings.kind !== 'fallback') throw new Error('expected a fallback');
    expect(settings.reason).toBe('settings.json is not valid JSON');
    expect(settings.manager.getShellPath()).toBeUndefined();
    expect(settings.manager.getShellCommandPrefix()).toBeUndefined();
    expect(consoleError.mock.calls).toEqual([]);
  });

  test('every failing load returns its own fallback instead of a once-only flag', () => {
    failSettingsRead('unreadable');

    expect(loadToolSettings('/tmp/a').kind).toBe('fallback');
    expect(loadToolSettings('/tmp/b').kind).toBe('fallback');
  });

  test('a failure that is not an Error reports its text', () => {
    vi.spyOn(SettingsManager, 'create').mockImplementation(() => {
      throw 'plain text';
    });

    const settings = loadToolSettings('/tmp/workspace');

    expect(settings.kind === 'fallback' && settings.reason).toBe('plain text');
  });
});
