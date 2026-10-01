import { getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';

export function pstackSetting(cwd: string, key: string): unknown {
  const settings: object = SettingsManager.create(cwd, getAgentDir()).getSettings();
  const pstack = 'pstack' in settings && typeof settings.pstack === 'object' && settings.pstack !== null ? settings.pstack : {};
  return (pstack as Record<string, unknown>)[key];
}
