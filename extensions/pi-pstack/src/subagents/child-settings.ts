import { type ExtensionContext, getAgentDir, SettingsManager } from '@earendil-works/pi-coding-agent';

/** A child loads project settings and resources only where its parent trusts the project. Left to its default, a child would trust every project. */
export function childSettings(cwd: string, ctx: Pick<ExtensionContext, 'isProjectTrusted'>): SettingsManager {
  return SettingsManager.create(cwd, getAgentDir(), { projectTrusted: ctx.isProjectTrusted() });
}
