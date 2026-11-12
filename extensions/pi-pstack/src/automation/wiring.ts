// The Benny serve process's parts, assembled with their external edges injected: Slack's fetch, the `gh` exec, and the
// worker spawn. serve-cli.ts passes the real ones; tests pass fakes.
import { type Automation, type AutomationConfig, createAutomation } from '../../adapters/automation-events.ts';
import { controlProbes } from './control-adapter.ts';
import type { BennyConfig } from './configuration.ts';
import type { SpawnWorker } from './dispatch.ts';
import type { Prerequisite, Probe } from './model.ts';
import type { TrackerDestination } from './outbox.ts';
import { slackDestination } from './slack.ts';
import { type GhExec, githubTracker } from './tracker-github.ts';
import { createTrackerPolicy } from './tracker-policy.ts';

export interface WiringDeps {
  fetch: typeof fetch;
  slackToken: string;
  exec: GhExec;
  spawnWorker?: SpawnWorker;
  inputCommit?: () => string;
  now?: () => Date;
  packageRoot?: string;
  /** Where `~/.pi/agent/skills` and `~/.agents/skills` are looked up. Defaults to the user's home. */
  home?: string;
}

export function wireBenny(config: BennyConfig, deps: WiringDeps): Automation {
  const destination = slackDestination({ fetch: deps.fetch, token: deps.slackToken });
  const probes: Partial<Record<Prerequisite, Probe>> = controlProbes(config.projectRoot, config.control, { ...(deps.packageRoot === undefined ? {} : { packageRoot: deps.packageRoot }), ...(deps.home === undefined ? {} : { home: deps.home }) });
  let tracker: TrackerDestination | undefined;
  let policy: ReturnType<typeof createTrackerPolicy> | undefined;
  // Only the GitHub adapter ships. Any other tracker type has no probe, so cases needing a tracker are logged blocked.
  if (config.tracker.type === 'github' && config.tracker.repo !== undefined) {
    const github = githubTracker({ exec: deps.exec, repo: config.tracker.repo, ...(deps.now === undefined ? {} : { now: deps.now }) });
    tracker = github;
    probes.tracker = () => github.reachable();
    policy = createTrackerPolicy({ tracker: config.tracker, reader: github, destination, canCompensate: true });
  }
  const automationConfig: AutomationConfig = config;
  return createAutomation(automationConfig, {
    destination,
    prerequisites: probes,
    ...(tracker === undefined || policy === undefined ? {} : { tracker, trackerPolicy: policy }),
    ...(deps.spawnWorker === undefined ? {} : { spawnWorker: deps.spawnWorker }),
    ...(deps.inputCommit === undefined ? {} : { inputCommit: deps.inputCommit }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
}
