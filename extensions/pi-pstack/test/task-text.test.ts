import { expect, test } from 'vitest';
import { TaskParams } from '../src/task/tool.ts';
import { cursorAgents, cursorTaskText } from './cursor-reference.ts';

const { parameters } = cursorAgents.task;
const piDescription = (name: string) => (TaskParams.properties as Record<string, { description?: string }>)[name]?.description;

test.for([
  { name: 'description', changes: 0 },
  { name: 'prompt', changes: 0 },
  { name: 'model', changes: 1 },
  { name: 'resume', changes: 0 },
  { name: 'subagent_type', changes: 1 },
  { name: 'run_in_background', changes: 0 },
])('Task parameter $name carries the text a live Cursor session showed', ({ name, changes }) => {
  expect(piDescription(name)).toBe(cursorTaskText(parameters[name] ?? '', changes));
});

test('file_attachments carries Cursor text, then says Pi models take no video', () => {
  expect(piDescription('file_attachments')).toBe(`${parameters['file_attachments']} A video path is named for the agent but not sent as video, because Pi models have no video input.`);
});
