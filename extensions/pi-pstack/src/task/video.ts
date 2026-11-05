// A video attached to a Task reaches the subagent as frames, since Pi models take images but not video: evenly spaced
// stills with their timestamps, which is what a model sees of a screen recording. ffmpeg and ffprobe extract them.
import { execFile } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { ImageContent } from '@earendil-works/pi-ai';

export const VIDEO = /\.(?:mp4|m4v|mov|webm|avi|mkv)$/i;
const MAX_FRAMES = 8;
const WIDTH = 768;

function run(command: string, args: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { encoding: 'utf8', timeout: 60_000 }, (error, stdout, stderr) => (error === null ? resolve(stdout) : reject(new Error((stderr || error.message).trim()))));
  });
}

export interface VideoFrames {
  duration: number;
  frames: { seconds: number; path: string }[];
}

/** Evenly spaced frames of the video (one per second for short clips, eight at most), as JPEG files in a temp folder. */
export async function extractFrames(video: string): Promise<VideoFrames> {
  const duration = Number.parseFloat(await run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video]));
  if (!Number.isFinite(duration) || duration <= 0) throw new Error(`ffprobe reports no duration for ${video}`);
  const count = Math.min(MAX_FRAMES, Math.max(1, Math.ceil(duration)));
  const dir = mkdtempSync(join(tmpdir(), 'pstack-video-'));
  const frames: VideoFrames['frames'] = [];
  for (let index = 0; index < count; index += 1) {
    const seconds = Math.min(duration, (duration * (index + 0.5)) / count);
    const path = join(dir, `${basename(video).replace(/\W+/g, '_')}-${String(index + 1).padStart(2, '0')}.jpg`);
    await run('ffmpeg', ['-v', 'error', '-y', '-ss', seconds.toFixed(3), '-i', video, '-frames:v', '1', '-vf', `scale='min(${WIDTH},iw)':-2`, '-q:v', '3', path]);
    frames.push({ seconds, path });
  }
  return { duration, frames };
}

/** The text that introduces a video's frames to the subagent, or says why there are none. */
export function videoNote(video: string, result: VideoFrames | Error): string {
  if (result instanceof Error) return `<file name="${video}">[video attachment; its frames could not be extracted (${result.message}). Open the path with a media tool.]</file>`;
  const times = result.frames.map((frame) => `${frame.seconds.toFixed(1)}s`).join(', ');
  return `<file name="${video}">[video attachment, ${result.duration.toFixed(1)}s long: ${result.frames.length} frames follow as images, taken at ${times}]</file>`;
}

/** Frames as image content for an RPC child. */
export async function videoImages(video: string): Promise<{ note: string; images: ImageContent[] }> {
  try {
    const frames = await extractFrames(video);
    return { note: videoNote(video, frames), images: frames.frames.map((frame) => ({ type: 'image', mimeType: 'image/jpeg', data: readFileSync(frame.path).toString('base64') })) };
  } catch (error) {
    return { note: videoNote(video, error instanceof Error ? error : new Error(String(error))), images: [] };
  }
}
