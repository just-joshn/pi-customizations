import { closeSync, openSync } from 'node:fs';
import { lstat, open, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ReadStream, WriteStream } from 'node:tty';
import { pathToFileURL } from 'node:url';

import { privateDirectory, routineDefinition } from './routine-client.mjs';

function terminal() {
  let inputFd;
  let outputFd;
  try {
    inputFd = openSync('/dev/tty', 'r');
    outputFd = openSync('/dev/tty', 'w');
  } catch {
    if (inputFd !== undefined) closeSync(inputFd);
    throw new Error('A controlling terminal is required. Run this initializer in your own terminal.');
  }
  return { input: new ReadStream(inputFd), output: new WriteStream(outputFd) };
}

async function hiddenInput() {
  const { input, output } = terminal();
  let value = '';
  const restore = () => {
    input.setRawMode(false);
    input.pause();
  };
  const interrupt = () => {
    restore();
    process.exitCode = 130;
    input.destroy();
    output.destroy();
  };
  process.once('SIGTERM', interrupt);
  process.once('SIGINT', interrupt);
  try {
    input.setRawMode(true);
    output.write('Webhook sender key (hidden, 32-512 non-space characters): ');
    input.setEncoding('utf8');
    return await new Promise((resolve, reject) => {
      input.on('error', () => reject(new Error('Terminal secret input failed.')));
      input.on('close', () => reject(new Error('Terminal secret input interrupted.')));
      input.on('data', (chunk) => {
        for (const character of chunk) {
          if (character === '\u0003' || character === '\u0004') return reject(new Error('Secret input cancelled.'));
          if (character === '\r' || character === '\n') return resolve(value);
          if (character === '\u007f' || character === '\b') value = value.slice(0, -1);
          else if (value.length < 513) value += character;
        }
      });
      input.resume();
    });
  } finally {
    restore();
    process.removeListener('SIGTERM', interrupt);
    process.removeListener('SIGINT', interrupt);
    output.write('\n');
    input.destroy();
    output.destroy();
  }
}

export async function readSenderKey(directory) {
  await privateDirectory(join(directory, 'secrets'));
  const path = join(directory, 'secrets', 'sender-key');
  const info = await lstat(path);
  if (!info.isFile() || info.uid !== process.getuid?.() || info.mode & 0o077) throw new Error('Sender key must be an owned regular file with mode 0600.');
  const key = await readFile(path, 'utf8');
  if (!/^[!-~]{32,512}$/.test(key)) throw new Error('Sender key format is invalid. Run the hidden terminal initializer.');
  return key;
}

export async function initializeSecret(directory) {
  await routineDefinition(directory);
  await privateDirectory(join(directory, 'secrets'));
  const value = await hiddenInput();
  if (!/^[!-~]{32,512}$/.test(value)) throw new Error('Invalid key. Use 32-512 non-space characters.');
  const file = await open(join(directory, 'secrets', 'sender-key'), 'wx', 0o600);
  try {
    await file.writeFile(value);
    await file.sync();
  } finally {
    await file.close();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [directory, ...extra] = process.argv.slice(2);
  if (!directory || extra.length) throw new Error('Usage: routine-secret.mjs <routine-directory>. Never pass a key as an argument.');
  await initializeSecret(directory).catch(() => {
    process.stderr.write('Secret initialization failed or was cancelled. Use a controlling terminal and a fresh routine draft.\n');
    process.exitCode = 1;
  });
}
