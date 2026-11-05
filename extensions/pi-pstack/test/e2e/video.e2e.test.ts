import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { makeSandbox, runJson, script, toolEnds } from './harness.ts';

const ffmpeg = (() => {
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

test.skipIf(!ffmpeg)('a video attachment reaches the subagent as timestamped frames (G8, needs ffmpeg)', async ({ onTestFinished }) => {
  const sandbox = makeSandbox();
  onTestFinished(() => sandbox.dispose());
  const video = join(sandbox.workDir, 'repro.mp4');
  execFileSync('ffmpeg', ['-v', 'error', '-f', 'lavfi', '-i', 'testsrc=duration=3:size=320x240:rate=10', '-pix_fmt', 'yuv420p', video]);
  const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'watch', prompt: 'go\n@@say SEEN', file_attachments: [video] } }]), ['--no-session']);
  const [result] = toolEnds(run.events, 'Task');
  expect(result?.isError, result?.text).toBe(false);
  const dir = join(sandbox.agentDir, 'pstack/workspaces', `--${sandbox.workDir.replace(/^\//, '').replace(/[/\\:]/g, '-')}--`, 'subagents');
  const transcript = readdirSync(dir).find((name) => name.endsWith('.jsonl')) ?? '';
  const user = readFileSync(join(dir, transcript), 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { type: string; message?: { role: string; content: { type: string; text?: string }[] } })
    .find((entry) => entry.message?.role === 'user');
  const parts = user?.message?.content ?? [];
  expect(parts.filter((part) => part.type === 'image')).toHaveLength(3);
  expect(parts.map((part) => part.text ?? '').join('')).toContain(`<file name="${video}">[video attachment, 3.0s long: 3 frames follow as images, taken at 0.5s, 1.5s, 2.5s]</file>`);
});
