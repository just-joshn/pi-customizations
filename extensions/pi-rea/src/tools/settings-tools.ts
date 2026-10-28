import type { AgentToolResult } from '@earendil-works/pi-coding-agent';
import { configurationResult } from '../contract/results.ts';
import type { AnalysisSettingId, SettingChange } from '../session/analysis-settings.ts';
import type { ReaSession } from '../session/binary-session.ts';

export interface InspectAnalysisSettingsParams {
  readonly settings?: readonly string[];
  readonly operation?: string;
  readonly provider?: string;
}

export const inspectAnalysisSettings = (session: ReaSession, params: InspectAnalysisSettingsParams = {}): AgentToolResult<unknown> =>
  configurationResult(
    session.settings.inspect({
      ...(params.settings === undefined ? {} : { settings: params.settings }),
      ...(params.operation === undefined ? {} : { operation: params.operation }),
      ...(params.provider === undefined ? {} : { provider: params.provider }),
    }),
  );

export interface UpdateAnalysisSettingsParams {
  readonly changes: readonly SettingChange[];
  readonly expected_revision?: number;
}

export const updateAnalysisSettings = (session: ReaSession, params: UpdateAnalysisSettingsParams): AgentToolResult<unknown> =>
  configurationResult(
    session.settings.update({
      changes: params.changes,
      ...(params.expected_revision === undefined ? {} : { expected_revision: params.expected_revision }),
    }),
  );

export type { AnalysisSettingId };
