// Shared wait/dump helpers for the paired journey capture drivers. Each call renders
// the live screen from the attempt's recorded event stream, so a wait is always judged
// against what the user would actually see.
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { renderScreen } from '../recorder/screen.mjs';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function screenLines(attempt, geometry) {
  const { lines } = await renderScreen(attempt.events(), geometry);
  return lines;
}

export async function waitScreen(attempt, geometry, needle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lines = [];
  while (Date.now() < deadline) {
    lines = await screenLines(attempt, geometry);
    if (lines.some((line) => line.includes(needle))) return lines;
    await sleep(120);
  }
  throw new Error(`Screen did not show "${needle}" within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

export async function waitEither(attempt, geometry, needles, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lines = [];
  while (Date.now() < deadline) {
    lines = await screenLines(attempt, geometry);
    const match = needles.find((needle) => lines.some((line) => line.includes(needle)));
    if (match) return match;
    await sleep(120);
  }
  throw new Error(`Screen did not show any of ${JSON.stringify(needles)} within ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

export async function waitGone(attempt, geometry, needle, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let lines = [];
  while (Date.now() < deadline) {
    lines = await screenLines(attempt, geometry);
    if (!lines.some((line) => line.includes(needle))) return lines;
    await sleep(120);
  }
  throw new Error(`Screen still showed "${needle}" after ${timeoutMs}ms. Last screen:\n${lines.join('\n')}`);
}

export async function waitSettled(attempt, geometry, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let calm = 0;
  while (Date.now() < deadline) {
    const lines = await screenLines(attempt, geometry);
    const busy = lines.some((line) => /[\u2800-\u28FF]/.test(line));
    calm = busy ? 0 : calm + 1;
    if (calm >= 2) return;
    await sleep(300);
  }
  throw new Error(`Agent did not settle within ${timeoutMs}ms`);
}

export async function dumpScreen(attempt, dir, name, geometry) {
  const lines = await screenLines(attempt, geometry);
  await writeFile(join(dir, `screen-${name}.txt`), `${lines.join('\n').replace(/\n+$/, '')}\n`);
  return lines;
}