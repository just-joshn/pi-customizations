import { writeFile } from 'node:fs/promises';

import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { registerQuestions } from '../src/questions.ts';

export default function questionFixture(pi: ExtensionAPI): void {
  let execute: Parameters<ExtensionAPI['registerTool']>[0]['execute'] | undefined;
  registerQuestions({
    ...pi,
    registerTool: (tool) => {
      execute = tool.execute;
    },
  });
  pi.registerCommand('fixture-question', {
    handler: async (args, ctx) => {
      const output = process.env['PSTACK_TUI_ANSWERS'];
      if (!output || !execute) throw new Error('Question fixture requires an output path and registered handler');
      if (!['single', 'multiple', 'text'].includes(args.trim())) throw new Error('Unknown terminal question fixture mode');
      const questions = [
        {
          id: 'fixture',
          prompt: 'Fixture preference',
          ...(args.trim() === 'text'
            ? {}
            : {
                options: [
                  { id: 'one', label: 'First choice' },
                  { id: 'two', label: 'Second choice' },
                ],
                allow_multiple: args.trim() === 'multiple',
              }),
        },
      ];
      const result = await execute('fixture-question', { questions }, undefined, undefined, {
        ...ctx,
        tools: [],
        executeTool: async () => {
          throw new Error('Nested tool execution is disabled in the terminal fixture');
        },
      });
      await writeFile(output, JSON.stringify(result.details), { mode: 0o600 });
      ctx.ui.notify('Fixture answer recorded', 'info');
    },
  });
}
