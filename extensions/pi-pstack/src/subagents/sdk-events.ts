import { randomUUID } from 'node:crypto';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';

export const sdkEventChannel = 'pstack:sdk-event';
export const sdkEntryType = 'pstack-sdk-event';
export const hookEventChannel = 'pstack:hook-event';
export const forwardTextFlag = 'forward-subagent-text';
export const hookEventsFlag = 'include-hook-events';

export type FrameBody = Readonly<Record<string, unknown>> & Readonly<{ type: 'system' | 'assistant' | 'user' }>;
export type SdkFrame = FrameBody & Readonly<{ uuid: string; session_id: string }>;

function flagOn(value: boolean | string | undefined): boolean {
  return value === true || value === 'true';
}

/**
 * Claude SDK stream frames. Pi has no extension-to-stdout channel, so each frame is a custom session entry
 * (surfaced as an `entry_appended` record in `--mode json` and RPC) and a `pstack:sdk-event` bus event.
 */
export class SdkEvents {
  private sessionId = '';

  constructor(private readonly pi: ExtensionAPI) {}

  attach(sessionId: string): void {
    this.sessionId = sessionId;
  }

  flag(name: string): boolean {
    return flagOn(this.pi.getFlag(name));
  }

  emit(body: FrameBody): SdkFrame {
    const frame: SdkFrame = { ...body, uuid: randomUUID(), session_id: this.sessionId };
    this.pi.events.emit(sdkEventChannel, frame);
    this.pi.appendEntry(sdkEntryType, frame);
    return frame;
  }

  /** Bridges bus channels owned by other modules into frames. */
  listen(): void {
    this.pi.events.on('pstack:subagent-stats', (stats) => {
      this.emit({ type: 'system', subtype: 'subagent_stats', stats });
    });
    this.pi.events.on(hookEventChannel, (payload) => {
      if (this.flag(hookEventsFlag) && typeof payload === 'object' && payload !== null) this.emit({ ...payload, type: 'system', subtype: 'hook_event' });
    });
  }
}

export function registerEventFlags(pi: ExtensionAPI): void {
  pi.registerFlag(forwardTextFlag, { type: 'boolean', description: 'Forward subagent text and thinking as assistant and user frames carrying parent_tool_use_id (JSON and RPC modes).' });
  pi.registerFlag(hookEventsFlag, { type: 'boolean', description: 'Expose hook events as system frames (JSON and RPC modes).' });
}
