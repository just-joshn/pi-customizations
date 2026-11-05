// Cursor's `/in-cloud`: the next task the user submits runs as a cloud subagent on its own machine, while this chat keeps
// working locally. `/in-cloud <task>` sends that task at once. The cloud agent's result comes back to this chat as a
// Task completion notification.
import type { ExtensionAPI, ExtensionContext, InputEvent, InputEventResult } from '@earendil-works/pi-coding-agent';

export const IN_CLOUD_TYPE = 'pstack/in-cloud';
const DESCRIPTION_LIMIT = 60;

export type StartCloud = (description: string, prompt: string) => Promise<string>;

/** A short UI name for the cloud agent: the task's first line. */
export function cloudDescription(task: string): string {
  const line =
    task
      .split('\n')
      .find((candidate) => candidate.trim() !== '')
      ?.trim() ?? 'cloud task';
  return line.length > DESCRIPTION_LIMIT ? `${line.slice(0, DESCRIPTION_LIMIT - 1)}…` : line;
}

export function registerInCloud(pi: ExtensionAPI, startCloud: StartCloud): void {
  let armed = false;

  const send = async (task: string, ctx: ExtensionContext) => {
    try {
      const agentId = await startCloud(cloudDescription(task), task);
      pi.sendMessage({ customType: IN_CLOUD_TYPE, content: `Sent to a cloud agent (${agentId}): ${cloudDescription(task)}. Its result arrives here when it finishes.`, display: true, details: { agentId, task } });
    } catch (error) {
      ctx.ui.notify(`Could not start the cloud agent: ${error instanceof Error ? error.message : String(error)}`, 'error');
    }
  };

  pi.registerCommand('in-cloud', {
    description: 'Run the next task you submit (or the task after the command) as a cloud agent on its own machine',
    handler: async (args, ctx) => {
      const task = args.trim();
      if (task !== '') return send(task, ctx);
      armed = !armed;
      ctx.ui.notify(armed ? 'The next task you submit runs as a cloud agent. /in-cloud again cancels.' : 'Cancelled: the next task runs here.', 'info');
      return undefined;
    },
  });

  pi.on('input', async (event: InputEvent, ctx): Promise<InputEventResult> => {
    if (!armed || event.source === 'extension' || event.text.trim() === '' || event.text.trimStart().startsWith('/in-cloud')) return { action: 'continue' };
    armed = false;
    await send(event.text.trim(), ctx);
    return { action: 'handled' };
  });
}
