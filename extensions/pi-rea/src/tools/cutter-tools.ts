import { homedir } from 'node:os';
import { join } from 'node:path';
import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { configurationResult } from '../contract/results.ts';
import type { ReaSession } from '../session/binary-session.ts';

const cutterBridgeDirectory = (): string => join(homedir(), '.cache', 'rea', 'cutter-bridge');

export const listCutterSessions = (_session: ReaSession, _params: Record<string, unknown> = {}): AgentToolResult<unknown> =>
  configurationResult({
    sessions: [],
    bridge_directory: cutterBridgeDirectory(),
    discovery_status: 'no_live_bridge_found',
    bridge_directory_security: 'not_checked',
  });
