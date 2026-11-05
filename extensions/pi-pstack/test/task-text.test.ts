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

test('file_attachments carries Cursor text unchanged, since a video now reaches the subagent as frames (G8)', () => {
  expect(piDescription('file_attachments')).toBe(parameters['file_attachments']);
});
