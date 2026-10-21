import type { ExtensionAPI, ExtensionToolContext, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { registerReadonlyShell } from '../../src/readonly-shell.ts';

const tools: ToolDefinition[] = [];
const shutdown: (() => Promise<void>)[] = [];
const pi = {
  registerTool: (tool: ToolDefinition) => tools.push(tool),
  on: (event: string, handler: () => Promise<void>) => {
    if (event === 'session_shutdown') shutdown.push(handler);
  },
} as unknown as ExtensionAPI;
registerReadonlyShell(pi);

const result = await tools[0]?.execute('call', { command: 'echo SANDBOXED' }, undefined, undefined, { cwd: process.cwd() } as ExtensionToolContext);
process.stdout.write(`${result?.content.map((part) => (part.type === 'text' ? part.text : '')).join('')}\n`);
for (const handler of shutdown) await handler();
process.stdout.write('SHUTDOWN-DONE\n');
