import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { SessionManager, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { modelConfigPath } from './models.ts';
import { boundedResult } from './results.ts';
import type { StateStore } from './state.ts';

const root = fileURLToPath(new URL('../', import.meta.url));

export function registerContext(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'pstack_context', label: 'Pstack context',
    description: 'Return current Pi transcript location, active branch entries, tools, available models, and optional history scoped to the current workspace. Use file pointers for delegation.',
    parameters: Type.Object({ history: Type.Optional(Type.Boolean()) }),
    async execute(_id, params, signal, _update, ctx) {
      const details = {
        cwd: ctx.cwd,
        sessionFile: ctx.sessionManager.getSessionFile(),
        entries: ctx.sessionManager.getBranch(),
        tools: pi.getAllTools().map((tool) => ({ name: tool.name, description: tool.description })),
        models: ctx.modelRegistry.getAvailable().map((model) => `${model.provider}/${model.id}`),
        history: params.history ? await SessionManager.list(ctx.cwd, undefined, undefined, signal) : [],
      };
      const text = JSON.stringify(details);
      return boundedResult(text, details, ctx);
    },
  });
}

export function registerStatus(pi: ExtensionAPI, store: StateStore): void {
  pi.registerCommand('pstack', {
    description: 'Show pstack status, source version, model rule, and host compatibility limits.',
    handler: async (_args, ctx) => {
      const state = store.read();
      const skillCount = (await readdir(join(root, 'skills'), { withFileTypes: true })).filter((entry) => entry.isDirectory()).length;
      const promptCount = (await readdir(join(root, 'prompts'))).filter((name) => name.endsWith('.md')).length;
      pi.sendMessage({ customType: 'pstack-status', display: true, details: state, content: [
        `pstack 0.15.5 with cursor-team-kit 1.2.0 for Pi 0.87.1. ${skillCount} skills, ${promptCount} prompt templates. Poteto mode ${state.enabled ? 'on' : 'off'}.`,
        `Model configuration: ${modelConfigPath()}`,
        `Compatibility report: ${join(root, 'docs/parity.md')}`,
        'Partial runtime parity. Cursor cloud agents, hosted automation editor, loops/goals, bot routines, server-synced create-skill and credential isolation are not supplied.',
      ].join('\n') });
      store.showState(ctx);
    },
  });
}
