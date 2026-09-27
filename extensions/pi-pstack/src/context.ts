import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type } from 'typebox';
import { SessionManager, type SessionEntry, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { modelConfigPath } from './models.ts';
import { boundedResult } from './results.ts';
import type { StateStore } from './state.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const evidenceListBytes = 8192;
const summaryCharacters = 160;

function boundedList<T>(items: readonly T[]): { values: T[]; omitted: number } {
  const values: T[] = [];
  let bytes = 2;
  for (const item of items) {
    const size = Buffer.byteLength(JSON.stringify(item)) + Number(values.length > 0);
    if (bytes + size > evidenceListBytes) break;
    values.push(item);
    bytes += size;
  }
  return { values, omitted: items.length - values.length };
}

function entryEvidence(entry: SessionEntry) {
  const message = entry.type === 'message' ? entry.message : undefined;
  const content = message && (message.role === 'user' || message.role === 'assistant') ? message.content : undefined;
  const text = typeof content === 'string' ? content : content?.find(block => block.type === 'text')?.text;
  return { id: entry.id, parentId: entry.parentId, type: entry.type, timestamp: entry.timestamp,
    role: message?.role, toolName: message?.role === 'toolResult' ? message.toolName : undefined,
    summary: text?.slice(0, summaryCharacters) };
}

export function registerContext(pi: ExtensionAPI): void {
  pi.registerTool({
    name: 'pstack_context', label: 'Pstack context',
    description: 'Return current Pi transcript location, active branch entries, tools, available models, and optional history scoped to the current workspace. Use file pointers for delegation.',
    parameters: Type.Object({ history: Type.Optional(Type.Boolean()) }),
    async execute(_id, params, signal, _update, ctx) {
      const branch = ctx.sessionManager.getBranch();
      const entries = boundedList(branch.toReversed().map(entryEvidence));
      const tools = boundedList(pi.getAllTools().map(tool => ({ name: tool.name, description: tool.description.slice(0, summaryCharacters) })));
      const models = boundedList(ctx.modelRegistry.getAvailable().map(model => `${model.provider}/${model.id}`));
      const sessions = params.history ? await SessionManager.list(ctx.cwd, undefined, undefined, signal) : [];
      const history = boundedList(sessions.map(session => ({ id: session.id, path: session.path, name: session.name?.slice(0, summaryCharacters) })));
      const details = {
        cwd: ctx.cwd, sessionFile: ctx.sessionManager.getSessionFile(),
        entries: entries.values.toReversed(), tools: tools.values, models: models.values, history: history.values,
        omitted: { entries: entries.omitted, tools: tools.omitted, models: models.omitted, history: history.omitted },
        historyDiscovery: { mode: params.history ? 'best-effort' : 'not-requested', completeness: 'unknown' },
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
        `pstack 0.15.5 with team-kit 1.2.0 for Pi 0.87.1. ${skillCount} skills, ${promptCount} prompt templates. Poteto mode ${state.enabled ? 'on' : 'off'}.`,
        `Model configuration: ${modelConfigPath()}`,
        `Compatibility report: ${join(root, 'docs/parity.md')}`,
        'Partial runtime parity. Reference cloud agents, hosted automation editor, loops/goals, bot routines, server-synced create-skill and credential isolation are not supplied.',
      ].join('\n') });
      store.showState(ctx);
    },
  });
}
