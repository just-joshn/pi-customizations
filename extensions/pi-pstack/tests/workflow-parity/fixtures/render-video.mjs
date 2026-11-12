// Renders a silent landscape mp4 from slide shapes, with each subtitle burned into a strip below its slide.
// ffmpeg here has no drawtext or subtitles filter, so the frames are drawn in Node (a 5x7 bitmap font) and piped to ffmpeg.
//   node render-video.mjs spec.json        env FFMPEG names the ffmpeg binary
// spec: { out, width, height, strip, fps, fade, slides: [{ shapes: [{ x, y, w, h, color: [r,g,b] }], subtitle, hold }] }
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FONT = {
  A: '01110 10001 10001 11111 10001 10001 10001', B: '11110 10001 10001 11110 10001 10001 11110', C: '01110 10001 10000 10000 10000 10001 01110', D: '11110 10001 10001 10001 10001 10001 11110',
  E: '11111 10000 10000 11110 10000 10000 11111', F: '11111 10000 10000 11110 10000 10000 10000', G: '01110 10001 10000 10111 10001 10001 01111', H: '10001 10001 10001 11111 10001 10001 10001',
  I: '01110 00100 00100 00100 00100 00100 01110', J: '00111 00010 00010 00010 00010 10010 01100', K: '10001 10010 10100 11000 10100 10010 10001', L: '10000 10000 10000 10000 10000 10000 11111',
  M: '10001 11011 10101 10101 10001 10001 10001', N: '10001 11001 10101 10011 10001 10001 10001', O: '01110 10001 10001 10001 10001 10001 01110', P: '11110 10001 10001 11110 10000 10000 10000',
  Q: '01110 10001 10001 10001 10101 10010 01101', R: '11110 10001 10001 11110 10100 10010 10001', S: '01111 10000 10000 01110 00001 00001 11110', T: '11111 00100 00100 00100 00100 00100 00100',
  U: '10001 10001 10001 10001 10001 10001 01110', V: '10001 10001 10001 10001 10001 01010 00100', W: '10001 10001 10001 10101 10101 10101 01010', X: '10001 10001 01010 00100 01010 10001 10001',
  Y: '10001 10001 01010 00100 00100 00100 00100', Z: '11111 00001 00010 00100 01000 10000 11111', 0: '01110 10001 10011 10101 11001 10001 01110', 1: '00100 01100 00100 00100 00100 00100 01110',
  2: '01110 10001 00001 00010 00100 01000 11111', 3: '11110 00001 00001 01110 00001 00001 11110', 4: '00010 00110 01010 10010 11111 00010 00010', 5: '11111 10000 11110 00001 00001 10001 01110',
  6: '00110 01000 10000 11110 10001 10001 01110', 7: '11111 00001 00010 00100 01000 01000 01000', 8: '01110 10001 10001 01110 10001 10001 01110', 9: '01110 10001 10001 01111 00001 00010 01100',
};
const SCALE = 2;

const spec = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const { width: W, height: H, strip: S, fps, fade } = spec;
const slideH = H - S;

function frameOf(slide) {
  const px = Buffer.alloc(W * H * 3);
  const paint = (x, y, color) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const at = (y * W + x) * 3;
    px[at] = color[0];
    px[at + 1] = color[1];
    px[at + 2] = color[2];
  };
  for (let y = 0; y < slideH; y++) for (let x = 0; x < W; x++) paint(x, y, [24, 28, 40]);
  for (const shape of slide.shapes) for (let y = shape.y; y < shape.y + shape.h; y++) for (let x = shape.x; x < shape.x + shape.w; x++) paint(x, y, shape.color);
  for (let y = slideH; y < H; y++) for (let x = 0; x < W; x++) paint(x, y, [0, 0, 0]);
  const text = slide.subtitle.toUpperCase();
  const width = text.length * 6 * SCALE;
  let cursor = Math.floor((W - width) / 2);
  const top = slideH + Math.floor((S - 7 * SCALE) / 2);
  for (const char of text) {
    const rows = (FONT[char] ?? '').split(' ');
    rows.forEach((row, ry) => [...row].forEach((bit, rx) => bit === '1' && [...Array(SCALE * SCALE).keys()].forEach((cell) => paint(cursor + rx * SCALE + (cell % SCALE), top + ry * SCALE + Math.floor(cell / SCALE), [255, 255, 255]))));
    cursor += 6 * SCALE;
  }
  return px;
}

const blend = (a, b, t) => {
  const out = Buffer.alloc(a.length);
  for (let i = 0; i < a.length; i++) out[i] = Math.round(a[i] * (1 - t) + b[i] * t);
  return out;
};

const ffmpeg = spawn(process.env.FFMPEG ?? 'ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', `${W}x${H}`, '-r', String(fps), '-i', '-', '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '12', spec.out], { stdio: ['pipe', 'inherit', 'inherit'] });
ffmpeg.on('error', (error) => {
  console.error(`render failed: cannot run ffmpeg (${error.code})`);
  process.exit(1);
});
ffmpeg.stdin.on('error', () => {});
const frames = spec.slides.map(frameOf);
const write = (buffer) => ffmpeg.stdin.write(buffer);
spec.slides.forEach((slide, index) => {
  for (let n = 0; n < Math.round(slide.hold * fps); n++) write(frames[index]);
  if (index + 1 < frames.length) for (let n = 1; n <= fade; n++) write(blend(frames[index], frames[index + 1], n / (fade + 1)));
});
ffmpeg.stdin.end();
ffmpeg.on('close', (code) => process.exit(code ?? 1));
