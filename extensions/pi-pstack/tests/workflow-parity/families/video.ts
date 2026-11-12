// ketchup-video (spec 12.5): a real, silent, landscape mp4 with burned-in subtitles, measured frame by frame.
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario, shQuote } from '../fixtures/dsl.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { check, fail, src, when } from '../lib/check.ts';
import { callsInTurn, openedAt, parentReads, replyOfTurn, skillFile, userText, userTurns } from '../lib/checks.ts';
import { PKG } from '../lib/driver.ts';
import { dirtyRepo, parentSession, rewriteSession, setSessionCwd } from '../lib/mutate.ts';
import type { RunView } from '../lib/view.ts';
import type { Family } from './types.ts';

const RENDER = join(PKG, 'tests/workflow-parity/fixtures/render-video.mjs');
const W = 640;
const H = 360;
const STRIP = 48;
const FPS = 10;
const hasFfmpeg = spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0 && spawnSync('ffprobe', ['-version'], { stdio: 'ignore' }).status === 0;
const TURN_ONE_REPLY = 'The cart tests pass. One call is yours: should I merge the branch coupon-fix into main now? I would wait until you have looked at the coupon change.';
const GREEN: [number, number, number] = [40, 160, 80];
const YELLOW: [number, number, number] = [220, 180, 40];
const SLIDES = [
  { subtitle: 'The cart tests pass and the coupon fix is ready', hold: 4, shapes: [{ x: 80, y: 80, w: 200, h: 140, color: GREEN }] },
  { subtitle: 'The fix waits for your okay before it merges', hold: 4, shapes: [{ x: 80, y: 80, w: 200, h: 140, color: GREEN }, { x: 300, y: 140, w: 60, h: 20, color: [200, 200, 200] }, { x: 380, y: 80, w: 180, h: 140, color: YELLOW }] },
  { subtitle: 'A coupon over 100 percent can no longer pay you', hold: 4, shapes: [{ x: 80, y: 80, w: 200, h: 140, color: GREEN }, { x: 300, y: 140, w: 60, h: 20, color: [200, 200, 200] }, { x: 370, y: 70, w: 200, h: 160, color: [220, 60, 60] }, { x: 380, y: 80, w: 180, h: 140, color: YELLOW }] },
];
const NOTES = 'One sentence: the cart is healthy and one merge is yours to call.\nSlide 1: the tests pass.\nSlide 2: the fix waits for your okay.\nSlide 3: what the fix changes for a customer.\n';
const REPLY_OK = (video: string) => `One call is waiting on you: whether to merge the coupon fix.

![what happened](${video})

Nothing else is left that I can do myself.

Action items
- Merge the coupon fix into main. My pick: wait until you have looked at it. It stops a coupon over 100 percent from paying the customer. The evidence is that the cart tests pass today. Low risk: it only bounds one number.`;
const REPLY_FAIL = `The video did not render, because ffmpeg could not run here.

One call is waiting on you: whether to merge the coupon fix.

Action items
- Merge the coupon fix into main. My pick: wait until you have looked at it. It stops a coupon over 100 percent from paying the customer. The evidence is that the cart tests pass today. Low risk: it only bounds one number.`;

const videoOf = (view: RunView) => join(view.sandbox, 'video', 'catch-up.mp4');
const wordsOf = (text: string) => text.toLowerCase().split(/\s+/).filter(Boolean);
const added = (index: number): number => (index === 0 ? wordsOf(SLIDES[0]!.subtitle).length : wordsOf(SLIDES[index]!.subtitle).filter((word) => !wordsOf(SLIDES[index - 1]!.subtitle).includes(word)).length);

interface Decoded {
  streams: { codec_type: string; width?: number; height?: number }[];
  format: string;
  frames: Buffer[];
}

/** Decodes the real file: ffprobe for its streams, ffmpeg for every frame as 8-bit gray. */
function decode(path: string): Decoded | null {
  if (!existsSync(path)) return null;
  const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'stream=codec_type,width,height:format=format_name', '-of', 'json', path], { encoding: 'utf8' })) as { streams: Decoded['streams']; format: { format_name: string } };
  const video = probe.streams.find((stream) => stream.codec_type === 'video');
  const raw = execFileSync('ffmpeg', ['-v', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'gray', '-'], { maxBuffer: 400_000_000 });
  const width = video?.width ?? 0;
  const height = video?.height ?? 0;
  const size = width * height;
  return { streams: probe.streams, format: probe.format.format_name, frames: size === 0 ? [] : Array.from({ length: Math.floor(raw.length / size) }, (_, index) => raw.subarray(index * size, (index + 1) * size)) };
}

const diff = (a: Buffer, b: Buffer, from: number, to: number): number => {
  let sum = 0;
  for (let i = from; i < to; i++) sum += Math.abs((a[i] as number) - (b[i] as number));
  return sum / (to - from);
};

/** Consecutive frames that match the run's first frame form a hold. A fade frame differs from both neighbours, so it ends a run. */
function holds(decoded: Decoded): { start: number; length: number }[] {
  const runs: { start: number; length: number }[] = [];
  let first = 0;
  for (let index = 1; index <= decoded.frames.length; index++) {
    if (index === decoded.frames.length || diff(decoded.frames[first] as Buffer, decoded.frames[index] as Buffer, 0, decoded.frames[0]!.length) > 0.6) {
      if (index - first >= 8) runs.push({ start: first, length: index - first });
      first = index;
    }
  }
  return runs;
}

function videoChecks(prefix: string): ReturnType<typeof check>[] {
  const decoded = (view: RunView) => decode(videoOf(view));
  return [
    check(`${prefix}.file-is-a-silent-landscape-mp4`, 'a video file exists outside the repository, in an mp4 container, one video stream, no audio, wider than tall', src('ketchup-video/SKILL.md', 'Render one silent landscape video, such as an mp4'), (view) => {
      const file = decoded(view);
      if (file === null) return fail(`no video at ${videoOf(view)}`);
      const video = file.streams.filter((stream) => stream.codec_type === 'video');
      return when(/mp4/.test(file.format) && video.length === 1 && file.streams.length === 1 && (video[0]?.width ?? 0) > (video[0]?.height ?? 1) && !videoOf(view).startsWith(view.repo), `${file.format}, ${video[0]?.width}x${video[0]?.height}, ${file.frames.length} frames, no audio, outside the repo`, `format ${file.format}; streams ${file.streams.map((stream) => stream.codec_type).join(',')}; size ${video[0]?.width}x${video[0]?.height}`);
    }),
    check(`${prefix}.holds-match-the-slides-and-are-long-enough`, 'matching the file\'s frames to the slides gives one hold per slide, and each hold is at least one second for every three words that slide adds', src('ketchup-video/SKILL.md', 'at least one second for each three words'), (view) => {
      const file = decoded(view);
      if (file === null) return fail('no video');
      const found = holds(file);
      const problems = SLIDES.flatMap((_, index) => {
        const hold = found[index];
        if (hold === undefined) return [`slide ${index + 1} has no hold`];
        const seconds = hold.length / FPS;
        return seconds >= added(index) / 3 ? [] : [`slide ${index + 1} holds ${seconds}s for ${added(index)} words`];
      });
      return when(found.length === SLIDES.length && problems.length === 0, `${found.length} holds of ${found.map((hold) => hold.length / FPS).join(', ')} s against ${SLIDES.map((_, index) => added(index)).join(', ')} added words`, `${found.length} holds, want ${SLIDES.length}; ${problems.join('; ')}`);
    }),
    check(`${prefix}.subtitle-strip-is-readable-and-covers-nothing`, 'in every hold the strip below the slide has a subtitle of bright pixels on a black strip of the same height, and no bright pixel falls inside the slide', src('ketchup-video/SKILL.md', 'Put the subtitle in a strip below the slide'), (view) => {
      const file = decoded(view);
      if (file === null) return fail('no video');
      const width = W;
      const slideEnd = (H - STRIP) * width;
      const problems = holds(file).flatMap((hold, index) => {
        const frame = file.frames[hold.start + Math.floor(hold.length / 2)] as Buffer;
        let textPixels = 0;
        let slideBright = 0;
        for (let i = 0; i < frame.length; i++) {
          if ((frame[i] as number) > 215) {
            if (i < slideEnd) slideBright += 1;
            else textPixels += 1;
          }
        }
        const stripTopBlack = diff(frame, Buffer.alloc(frame.length), slideEnd, slideEnd + width * 2) < 3;
        return [...(textPixels >= 150 ? [] : [`slide ${index + 1}: ${textPixels} subtitle pixels`]), ...(slideBright === 0 ? [] : [`slide ${index + 1}: ${slideBright} bright pixels over the slide`]), ...(stripTopBlack ? [] : [`slide ${index + 1}: the strip is not clear at its top`])];
      });
      return when(problems.length === 0 && holds(file).length === SLIDES.length, `${SLIDES.length} holds with a subtitle in a ${STRIP}px strip and a clear slide`, problems.join('; ') || 'no holds');
    }),
    check(`${prefix}.each-slide-changes-the-picture`, 'consecutive slides differ, so every slide changes what the user knows', src('ketchup-video/SKILL.md', 'Drop each slide that does not change what the user knows'), (view) => {
      const file = decoded(view);
      if (file === null) return fail('no video');
      const found = holds(file);
      const same = found.slice(1).flatMap((hold, index) => (diff(file.frames[found[index]!.start] as Buffer, file.frames[hold.start] as Buffer, 0, file.frames[0]!.length) > 1 ? [] : [`slides ${index + 1} and ${index + 2}`]));
      return when(found.length >= 2 && found.length <= 10 && same.length === 0, `${found.length} slides, each different from the last`, `${found.length} slides; identical pairs ${same.join(', ')}`);
    }),
  ];
}

function history(): Family['spec'] {
  return {
    family: 'ketchup-video',
    runId: 'ketchup-video-unused',
    history: cartHistory,
    prepare: (ctx) => {
      const run = (...args: string[]) => execFileSync('git', ['-C', ctx.repo, '-c', 'user.name=wf', '-c', 'user.email=wf@example.com', '-c', 'commit.gpgsign=false', ...args]);
      run('checkout', '-q', '-b', 'coupon-fix');
      writeFileSync(join(ctx.repo, 'NOTES.md'), 'coupon fix notes\n');
      run('add', 'NOTES.md');
      run('commit', '-q', '-m', 'wip: coupon fix notes');
      run('checkout', '-q', 'main');
    },
    prompt: () => 'run the tests for me and tell me whether the cart is healthy',
    followUps: () => ['/ketchup-video'],
    scenario: (ctx) => scenario(new Parent(ctx)),
  };
}

function build(renders: boolean): Family {
  const id = renders ? 'ketchup-video' : 'ketchup-video-render-fails';
  const base = history();
  return {
    id,
    title: renders ? 'ketchup-video: a real silent landscape mp4 with burned-in subtitles, holds measured against the words, a frame of each slide inspected (spec 12.5)' : 'ketchup-video when the render fails: one line says so and only the calls follow (ketchup-video SKILL.md)',
    ...(renders ? {} : {}),
    spec: {
      ...base,
      family: id,
      scenario: (ctx) => {
        const parent = new Parent(ctx);
        const dir = join(ctx.sandbox, 'video');
        const video = join(dir, 'catch-up.mp4');
        parent.bash('node --test').text(TURN_ONE_REPLY);
        parent.readSkill('ketchup-video').readSkill('ketchup').readSkill('bro').bash('git branch --list').bash('git log --oneline -3 coupon-fix').bash('git status --short');
        parent.bash(`mkdir -p ${JSON.stringify(dir)}`).write(join(dir, 'notes.md'), NOTES);
        parent.write(join(dir, 'slides.json'), JSON.stringify({ out: video, width: W, height: H, strip: STRIP, fps: FPS, fade: 4, slides: SLIDES }));
        if (renders) {
          parent.bash(`node ${shQuote(RENDER)} ${shQuote(join(dir, 'slides.json'))}`);
          parent.bash(`ffprobe -v error -show_entries stream=codec_type,width,height,duration -of compact ${shQuote(video)}`);
          const frames = [2, 6, 10].map((_second, index) => join(dir, `frame-${index + 1}.png`));
          [2, 6, 10].forEach((second, index) => parent.bash(`ffmpeg -y -loglevel error -ss ${second} -i ${shQuote(video)} -frames:v 1 ${shQuote(frames[index] as string)}`));
          for (const frame of frames) parent.read(frame);
          parent.text(REPLY_OK(video));
        } else {
          parent.bash(`FFMPEG=/nonexistent/ffmpeg node ${shQuote(RENDER)} ${shQuote(join(dir, 'slides.json'))}; echo "render exit $?"`);
          parent.text(REPLY_FAIL);
        }
        return scenario(parent);
      },
    },
    checks: [
      check(`${id}.routes-and-follows-ketchup`, '/ketchup-video arrives as the second user turn, and the parent opens ketchup-video and ketchup', src('ketchup-video/SKILL.md', 'Follow [`/ketchup`](../ketchup/SKILL.md)'), (view) => when(userTurns(view).length === 2 && userText(view, 1).includes('Use the pstack `ketchup-video` skill for this request.') && openedAt(view.parent, skillFile('ketchup')) !== -1 && openedAt(view.parent, skillFile('ketchup-video')) !== -1, 'turn 2 routes to ketchup-video and both skills were opened', `user turns ${userTurns(view).length}; second: ${userText(view, 1).slice(0, 80)}`)),
      check(`${id}.repository-untouched-video-outside`, 'the turn changed nothing in the repository: the only writes and the video are outside it', src('ketchup-video/SKILL.md', 'Writing and rendering the video, outside the repo, is the one exception to its read-only rule.'), (view) => {
        const writes = callsInTurn(view, 1).filter((call) => call.name === 'write' || call.name === 'edit').map((call) => String(call.args['path']));
        return when(view.git.dirty.length === 0 && view.git.commitsSinceBase.length === 0 && writes.every((path) => !path.startsWith(view.repo)), `${writes.length} writes, all outside the repo; checkout clean`, `dirty ${view.git.dirty.join(',')}; writes ${writes.join(',')}`);
      }),
      check(`${id}.plan-notes-stay-out-of-the-reply`, 'the one-sentence note and the line per slide were written down before drawing and are not in the reply', src('ketchup-video/SKILL.md', 'Neither note goes in the reply.'), (view) => {
        const notes = join(view.sandbox, 'video', 'notes.md');
        const reply = replyOfTurn(view, 1);
        const lines = existsSync(notes) ? readFileSync(notes, 'utf8').split('\n').filter(Boolean) : [];
        const written = callsInTurn(view, 1).findIndex((call) => call.name === 'write' && String(call.args['path']).endsWith('notes.md'));
        const slides = callsInTurn(view, 1).findIndex((call) => call.name === 'write' && String(call.args['path']).endsWith('slides.json'));
        return when(lines.length === 1 + SLIDES.length && written !== -1 && written < slides && lines.every((line) => !reply.includes(line)), `${lines.length} note lines written before slides.json, none in the reply`, `lines ${lines.length}; written at ${written}, slides at ${slides}`);
      }),
      ...(renders
        ? [
            ...videoChecks(id),
            check(`${id}.a-frame-of-each-slide-was-inspected`, 'before embedding, the parent extracted one frame per slide and opened each image', src('ketchup-video/SKILL.md', 'Look at one frame from each slide at chat size'), (view) => {
              const reads = callsInTurn(view, 1).filter((call) => call.name === 'read' && /frame-\d\.png$/.test(String(call.args['path'])));
              const probe = callsInTurn(view, 1).find((call) => call.name === 'bash' && /ffprobe/.test(String(call.args['command'])));
              const reply = callsInTurn(view, 1).at(-1)?.order ?? 0;
              return when(reads.length === SLIDES.length && reads.every((call) => !call.isError && existsSync(String(call.args['path']))) && probe !== undefined && probe.resultText.includes('codec_type=video') && reads.every((call) => call.order < reply + 1), `${reads.length} frames opened, the file was probed`, `frames read ${reads.length}; probe ${probe?.resultText.slice(0, 60)}`);
            }),
            check(`${id}.reply-embeds-the-video-and-lists-the-calls`, 'the reply opens with a sentence naming what waits, embeds the video file that exists, names the work left, and lists the call with a pick and its risk', src('ketchup-video/SKILL.md', 'The reply is ketchup\'s opening sentence, the embedded video, one line naming any work left that you can do yourself, and the action items.'), (view) => {
              const reply = replyOfTurn(view, 1);
              const embedded = /!\[[^\]]*\]\(([^)]+\.mp4)\)/.exec(reply)?.[1];
              const items = (reply.split(/Action items\s*/i)[1] ?? '').split('\n').filter((line) => line.startsWith('- '));
              return when(/^One call is waiting/.test(reply) && embedded !== undefined && existsSync(embedded) && /left that I can do myself|Nothing else is left/i.test(reply) && items.length === 1 && /pick/i.test(items[0] ?? '') && /risk/i.test(items[0] ?? ''), `opening, the video ${embedded}, work left, 1 action item`, `embedded ${embedded}; items ${items.length}; reply ${reply.slice(0, 100)}`);
            }),
          ]
        : [
            check(`${id}.render-failed-for-real`, 'the render command really failed and no video was left behind', src('ketchup-video/SKILL.md', 'If the render fails, say so in one line and give only the calls.'), (view) => {
              const render = callsInTurn(view, 1).find((call) => call.name === 'bash' && /render-video/.test(String(call.args['command'])));
              return when(render !== undefined && /render failed: cannot run ffmpeg/.test(render.resultText) && /render exit 1/.test(render.resultText) && !existsSync(videoOf(view)), 'the renderer exited 1 and wrote no file', `render output: ${render?.resultText.slice(0, 120)}`);
            }),
            check(`${id}.one-line-then-only-the-calls`, 'the reply says the render failed in one line, embeds nothing, and then gives only the calls', src('ketchup-video/SKILL.md', 'If the render fails, say so in one line and give only the calls.'), (view) => {
              const reply = replyOfTurn(view, 1);
              const failure = reply.split('\n').filter((line) => /did not render|render failed/i.test(line));
              return when(failure.length === 1 && !/!\[|\.mp4/.test(reply) && /Action items/.test(reply), 'one failure line, no embed, the action items follow', `failure lines ${failure.length}; embed ${/!\[|\.mp4/.test(reply)}`);
            }),
          ]),
    ],
    negatives: renders
      ? [
          { name: 'the holds were far too short', mutate: (sandbox) => rerender(sandbox, (spec) => spec.slides.forEach((slide) => (slide.hold = 1))), fails: [`${id}.holds-match-the-slides-and-are-long-enough`] },
          { name: 'the video was portrait', mutate: (sandbox) => rerender(sandbox, (spec) => Object.assign(spec, { width: 360, height: 640 })), fails: [`${id}.file-is-a-silent-landscape-mp4`] },
          { name: 'the video carried an audio track', mutate: (sandbox) => addAudio(join(sandbox, 'video', 'catch-up.mp4')), fails: [`${id}.file-is-a-silent-landscape-mp4`] },
          { name: 'every slide was the same picture', mutate: (sandbox) => rerender(sandbox, (spec) => spec.slides.forEach((slide) => ((slide.shapes = spec.slides[0]!.shapes), (slide.subtitle = spec.slides[0]!.subtitle)))), fails: [`${id}.each-slide-changes-the-picture`] },
          { name: 'the subtitle strip was too thin to hold the text', mutate: (sandbox) => rerender(sandbox, (spec) => Object.assign(spec, { strip: 8 })), fails: [`${id}.subtitle-strip-is-readable-and-covers-nothing`] },
          { name: 'no frame was looked at', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'frame-1.png', 'zzz-1.png'), fails: [`${id}.a-frame-of-each-slide-was-inspected`] },
          { name: 'the repository was edited', mutate: (sandbox) => dirtyRepo(sandbox, 'src/cart.js'), fails: [`${id}.repository-untouched-video-outside`] },
        ]
      : [
          { name: 'the reply embedded a video that was never made', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'One call is waiting on you', '![x](/tmp/none.mp4) One call is waiting on you'), fails: [`${id}.one-line-then-only-the-calls`] },
          { name: 'the failure was never said', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'The video did not render, because ffmpeg could not run here.', 'Here is the summary.'), fails: [`${id}.one-line-then-only-the-calls`] },
          { name: 'the render actually succeeded', mutate: (sandbox) => rewriteSession(parentSession(sandbox), 'render exit 1', 'render exit 0'), fails: [`${id}.render-failed-for-real`] },
        ],
  };
}

interface RenderSpec {
  out: string;
  width: number;
  height: number;
  strip: number;
  fps: number;
  slides: { hold: number; subtitle: string; shapes: unknown[] }[];
}

function rerender(sandbox: string, change: (spec: RenderSpec) => void): void {
  const path = join(sandbox, 'video', 'slides.json');
  const spec = JSON.parse(readFileSync(path, 'utf8')) as RenderSpec;
  change(spec);
  const next = join(sandbox, 'video', 'mutant.json');
  writeFileSync(next, JSON.stringify(spec));
  execFileSync('node', [RENDER, next], { stdio: 'ignore' });
}

function addAudio(path: string): void {
  const out = `${path}.audio.mp4`;
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-i', path, '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-shortest', '-c:v', 'copy', '-c:a', 'aac', out]);
  execFileSync('mv', [out, path]);
}

void [setSessionCwd, parentReads];
export const videoFamilies: Family[] = [...(hasFfmpeg ? [build(true)] : []), build(false)];
export const ketchupVideoPrerequisite = hasFfmpeg ? 'ffmpeg and ffprobe found on PATH' : 'ffmpeg and ffprobe are missing: install ffmpeg (with libx264) to render and check the video';
