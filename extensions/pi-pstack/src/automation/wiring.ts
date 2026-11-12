// The Benny serve process's parts, assembled with their external edges injected: Slack's fetch, the `gh` exec, and the
// worker spawn. serve-cli.ts passes the real ones; tests pass fakes.
import { type Automation, type AutomationConfig, createAutomation } from '../../adapters/automation-events.ts';
import { controlProbes } from './control-adapter.ts';
import type { BennyConfig } from './configuration.ts';
import { type SpawnWorker, spawnInTmux } from './dispatch.ts';
import type { AbortRun } from './abort.ts';
import type { Prerequisite, Probe, RunId } from './model.ts';
import type { CollectedRun } from './settle.ts';
import type { SteerRun } from './steer.ts';
import type { TrackerDestination, TrackerLander } from './outbox.ts';
import { type SlackApi, slackDestination, slackFileDownloader } from './slack.ts';
import { adapterSkillProblem, adapterTracker } from './tracker-adapter.ts';
import { createForge, type Git, githubRepoOf, nodeGit } from './forge.ts';
import { type GhExec, githubTracker } from './tracker-github.ts';
import { createTrackerPolicy } from './tracker-policy.ts';

export interface WiringDeps {
  fetch: typeof fetch;
  slackToken: string;
  exec: GhExec;
  /** Runs git in a worktree. Defaults to the real one. */
  git?: Git;
  spawnWorker?: SpawnWorker;
  inputCommit?: () => string;
  now?: () => Date;
  /** How a worker's result is read, a worker stopped, and an idle worker sent its next message. Default to the runtime's own. */
  collect?: (runId: RunId) => Promise<CollectedRun>;
  abort?: AbortRun;
  steer?: SteerRun;
  packageRoot?: string;
  /** How long a reply with evidence files waits for Slack to show it in the thread. Tests shorten it. */
  slackUpload?: SlackApi['upload'];
  /** Where `~/.pi/agent/skills` and `~/.agents/skills` are looked up. Defaults to the user's home. */
  home?: string;
}

export function wireBenny(config: BennyConfig, deps: WiringDeps): Automation {
  const destination = slackDestination({ fetch: deps.fetch, token: deps.slackToken, ...(deps.slackUpload === undefined ? {} : { upload: deps.slackUpload }) });
  const probes: Partial<Record<Prerequisite, Probe>> = controlProbes(config.projectRoot, config.control, { ...(deps.packageRoot === undefined ? {} : { packageRoot: deps.packageRoot }), ...(deps.home === undefined ? {} : { home: deps.home }) });
  let tracker: TrackerDestination | TrackerLander | undefined;
  let policy: ReturnType<typeof createTrackerPolicy> | undefined;
  const locations = { ...(deps.packageRoot === undefined ? {} : { packageRoot: deps.packageRoot }), ...(deps.home === undefined ? {} : { home: deps.home }) };
  // GitHub is the one tracker the package ships. Any other type is a project-owned adapter skill, run by a worker.
  if (config.tracker.type !== 'github') {
    tracker = adapterTracker({ projectRoot: config.projectRoot, automation: config.name, tracker: config.tracker, locations, spawnWorker: deps.spawnWorker ?? spawnInTmux(config.projectRoot), ...(config.model === undefined ? {} : { model: config.model }), ...(deps.now === undefined ? {} : { now: deps.now }) });
    probes.tracker = async () => adapterSkillProblem(config.tracker, config.projectRoot, locations) ?? true;
    policy = createTrackerPolicy({ tracker: config.tracker, destination, canCompensate: true });
  } else if (config.tracker.repo !== undefined) {
    const github = githubTracker({ exec: deps.exec, repo: config.tracker.repo, ...(deps.now === undefined ? {} : { now: deps.now }) });
    tracker = github;
    probes.tracker = () => github.reachable();
    policy = createTrackerPolicy({ tracker: config.tracker, reader: github, destination, canCompensate: true });
  }
  const repo = config.tracker.repo;
  const codeRepo = githubRepoOf(config.repositoryUrl);
  const forge = createForge({ git: deps.git ?? nodeGit, gh: deps.exec, target: codeRepo === undefined ? undefined : { repo: codeRepo, baseBranch: config.defaultBranch } });
  const automationConfig: AutomationConfig = config;
  return createAutomation(automationConfig, {
    destination,
    operations: destination,
    downloadAttachment: slackFileDownloader({ fetch: deps.fetch, token: deps.slackToken }),
    prerequisites: probes,
    forge,
    ...(tracker === undefined || policy === undefined ? {} : { tracker, trackerPolicy: policy }),
    ...(config.tracker.type === 'github' && repo !== undefined ? { trackerUrl: (id: string) => `https://github.com/${repo}/issues/${id}` } : {}),
    ...(deps.spawnWorker === undefined ? {} : { spawnWorker: deps.spawnWorker }),
    ...(deps.inputCommit === undefined ? {} : { inputCommit: deps.inputCommit }),
    ...(deps.collect === undefined ? {} : { collect: deps.collect }),
    ...(deps.abort === undefined ? {} : { abort: deps.abort }),
    ...(deps.steer === undefined ? {} : { steer: deps.steer }),
    ...(deps.now === undefined ? {} : { now: deps.now }),
  });
}
