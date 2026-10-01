import { getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';
import { depthCap, environmentDepthCap } from './limits.ts';

type DepthContext = Readonly<{ sessionId: string; cwd: string; env: NodeJS.ProcessEnv }>;
type DepthSnapshot = Readonly<{ sessionId: string; setting: number | undefined }>;

function configuredDepth(settings: object): number | undefined {
  if (!('pstack' in settings) || typeof settings.pstack !== 'object' || settings.pstack === null) return undefined;
  if (!('maxSubagentSpawnDepth' in settings.pstack)) return undefined;
  return typeof settings.pstack.maxSubagentSpawnDepth === 'number' ? settings.pstack.maxSubagentSpawnDepth : undefined;
}

export class SessionDepthPolicy {
  private captured: DepthSnapshot | undefined;

  cap(context: DepthContext): number {
    const override = environmentDepthCap(context.env);
    if (override !== undefined) return override;
    if (this.captured?.sessionId !== context.sessionId) {
      const settings = SettingsManager.create(context.cwd, getAgentDir()).getSettings();
      this.captured = { sessionId: context.sessionId, setting: configuredDepth(settings) };
    }
    return depthCap({}, this.captured.setting);
  }
}
