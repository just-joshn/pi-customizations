import { homedir } from 'node:os';

import type { AgentSession, ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { getAgentDir } from '@earendil-works/pi-coding-agent';
import type { TaskRecord } from '../worker-records.ts';
import { sumUsage } from '../worker-support.ts';
import { readSettingsLayers } from './settings-layers.ts';
import { runShellCommand } from './shell-command.ts';
import { type Decorations, StatusLinePoller } from './status-line.ts';
import { panelLines, type TaskSnapshot, taskSnapshot } from './task-snapshots.ts';

export const taskPanelWidget = 'pstack-agents';
type Registry = Readonly<{ list: () => readonly TaskRecord[]; liveMessages: (id: string) => AgentSession['messages'] | undefined }>;

async function statusLineCommand(ctx: ExtensionContext): Promise<string | undefined> {
  const { user, project } = await readSettingsLayers({ cwd: ctx.cwd, home: homedir(), agentDir: getAgentDir() });
  const configured = [...user, ...project].findLast((settings) => settings.subagentStatusLine !== undefined)?.subagentStatusLine as { type?: unknown; command?: unknown } | undefined;
  return configured?.type === 'command' && typeof configured.command === 'string' ? configured.command : undefined;
}

class TaskPanel {
  private ctx: ExtensionContext | undefined;
  private decorations: Decorations = {};
  private readonly dismissed = new Set<string>();
  readonly poller: StatusLinePoller;

  constructor(
    private readonly registry: Registry,
    log: (message: string) => void,
    env: NodeJS.ProcessEnv,
  ) {
    this.poller = new StatusLinePoller({
      tasks: () => this.tasks(),
      command: () => (this.ctx ? statusLineCommand(this.ctx) : Promise.resolve(undefined)),
      trusted: () => this.ctx?.isProjectTrusted() ?? false,
      enabled: () => !env.CLAUDE_CODE_SIMPLE,
      columns: () => process.stdout.columns ?? 80,
      base: () => this.hookBase(),
      run: runShellCommand,
      log,
      apply: (decorations) => {
        this.decorations = decorations;
        this.render();
      },
    });
  }

  attach(ctx: ExtensionContext): void {
    this.ctx = ctx.hasUI ? ctx : undefined;
    this.dismissed.clear();
    this.decorations = {};
    if (this.ctx) this.poller.start();
    this.render();
  }

  detach(): void {
    this.poller.stop();
    this.ctx?.ui.setWidget(taskPanelWidget, undefined);
    this.ctx = undefined;
  }

  dismissFinished(): void {
    for (const record of this.registry.list()) if (record.status !== 'running') this.dismissed.add(record.id);
    this.render();
  }

  render(): void {
    const tasks = this.tasks();
    this.ctx?.ui.setWidget(taskPanelWidget, tasks.length ? panelLines(tasks, this.decorations) : undefined);
  }

  private tasks(): TaskSnapshot[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    const sources = {
      liveTokens: (id: string) => {
        const messages = this.registry.liveMessages(id);
        return messages ? sumUsage(messages).totalTokens : undefined;
      },
      contextWindow: (model: string) => {
        const [provider = '', ...id] = model.split('/');
        return ctx.modelRegistry.find(provider, id.join('/'))?.contextWindow;
      },
    };
    return this.registry
      .list()
      .filter((record) => !this.dismissed.has(record.id))
      .map((record) => taskSnapshot(record, sources));
  }

  private hookBase() {
    const transcriptPath = this.ctx?.sessionManager.getSessionFile();
    return { session_id: this.ctx?.sessionManager.getSessionId() ?? '', ...(transcriptPath ? { transcript_path: transcriptPath } : {}), cwd: this.ctx?.cwd ?? process.cwd() };
  }
}

export function registerTaskPanel(pi: ExtensionAPI, registry: Registry, env: NodeJS.ProcessEnv = process.env): void {
  const panel = new TaskPanel(registry, (message) => pi.events.emit('pstack:subagent-log', message), env);
  pi.on('session_start', (_event, ctx) => panel.attach(ctx));
  pi.on('session_shutdown', () => panel.detach());
  pi.on('input', () => {
    panel.dismissFinished();
  });
  for (const event of ['pstack:subagent-started', 'pstack:subagent-settled']) pi.events.on(event, () => panel.render());
}
