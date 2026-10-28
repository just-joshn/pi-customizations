import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import type { ReaSession } from '../session/binary-session.ts';
import { refuseProviderTool } from './provider-refuse-tools.ts';

export const SESSION_LIST_TOOLS = [
  'list_bookmarks',
  'list_documents',
  'list_names',
  'list_procedures',
  'list_segments',
  'list_strings',
] as const;

export type SessionListToolName = (typeof SESSION_LIST_TOOLS)[number];

export const refuseSessionList = (session: ReaSession, operation: SessionListToolName): AgentToolResult<unknown> =>
  refuseProviderTool(session, operation);

export const listBookmarks = (session: ReaSession, params: Record<string, unknown> = {}): AgentToolResult<unknown> =>
  refuseProviderTool(session, 'list_bookmarks', params);

export const listDocuments = (session: ReaSession, params: Record<string, unknown> = {}): AgentToolResult<unknown> =>
  refuseProviderTool(session, 'list_documents', params);

export const listNames = (session: ReaSession, params: Record<string, unknown> = {}): AgentToolResult<unknown> =>
  refuseProviderTool(session, 'list_names', params);

export const listProcedures = (session: ReaSession, params: Record<string, unknown> = {}): AgentToolResult<unknown> =>
  refuseProviderTool(session, 'list_procedures', params);

export const listSegments = (session: ReaSession, params: Record<string, unknown> = {}): AgentToolResult<unknown> =>
  refuseProviderTool(session, 'list_segments', params);

export const listStrings = (session: ReaSession, params: Record<string, unknown> = {}): AgentToolResult<unknown> =>
  refuseProviderTool(session, 'list_strings', params);
