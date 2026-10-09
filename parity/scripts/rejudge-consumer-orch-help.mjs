#!/usr/bin/env node
// Re-observe settled screens + done markers for an existing consumer orch-help pair.
// Does not spawn hosts. Usage: node scripts/rejudge-consumer-orch-help.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import { sha256 } from '../recorder/files.mjs';

const root = new URL('../', import.meta.url).pathname;
const evidenceRoot = join(root, 'evidence', 'consumer');
const pairPath = join(evidenceRoot, 'pair-consumer-orch-help-1.json');
const LOCKED_CONSUMER_DIGEST = 'f091687df627a0b75fabd54af58945a9cd6c7039ef0622012ac9ed60cd8ec434';
const consumerPath =
  'parity/reference/cursor-plugins/pstack/skills/poteto-mode/scripts/orch/orch.ts';
const consumerAbs = join(root, 'reference/cursor-plugins/pstack/skills/poteto-mode/scripts/orch/orch.ts');

function observeHelp(text) {
  return {
    usageOrch: /Usage:\s*orch/i.test(text),
    commandsHeader: /Commands:/i.test(text),
    cmdInit: /\binit\b/.test(text),
    cmdUnit: /\bunit\b/.test(text),
    cmdStanding: /\bstanding\b/.test(text),
    helpFlag: /-h,\s*--help/i.test(text) || /display help for command/i.test(text),
    working: /[\u2800-\u28FF]/.test(text) || /\bWorking\b/.test(text),
  };
}

function helpChromeOk(obs) {
  return obs.usageOrch && obs.commandsHeader && obs.cmdInit && (obs.cmdUnit || obs.cmdStanding);
}

async function rejudgeSide(side, attemptDir) {
  const screenPath = join(attemptDir, 'screen-03-settled.txt');
  const text = await readFile(screenPath, 'utf8');
  const afterHelp = observeHelp(text);
  const donePath = join(evidenceRoot, 'fixture-out', side, 'orch-help-done.txt');
  let doneOk = false;
  try {
    doneOk = (await readFile(donePath, 'utf8')).trim() === 'EXIT=0';
  } catch {
    doneOk = false;
  }
  const consumerHex = (await sha256(consumerAbs)).replace(/^sha256:/, '');
  const observations = {
    afterHelp,
    helpChromeOk: helpChromeOk(afterHelp),
    doneMarkerOk: doneOk,
    consumerPath,
    consumerSha256: consumerHex,
    consumerMatchesLocked: consumerHex === LOCKED_CONSUMER_DIGEST,
    journeyClosed: helpChromeOk(afterHelp) && doneOk && consumerHex === LOCKED_CONSUMER_DIGEST,
    rejudgedFrom: screenPath,
  };
  await writeFile(join(attemptDir, 'observations-orch-help.json'), `${JSON.stringify(observations, null, 2)}\n`);
  return observations;
}

const pair = JSON.parse(await readFile(pairPath, 'utf8'));
const cursorObs = await rejudgeSide('cursor', pair.cursor.dir);
const piObs = await rejudgeSide('pi', pair.pi.dir);
pair.cursor.observations = cursorObs;
pair.pi.observations = piObs;
pair.pairClosed = cursorObs.journeyClosed === true && piObs.journeyClosed === true;
pair.provenance = {
  ...pair.provenance,
  rejudgedWith: 'parity/scripts/rejudge-consumer-orch-help.mjs',
};
await writeFile(pairPath, `${JSON.stringify(pair, null, 2)}\n`);
console.log(
  JSON.stringify({
    pairPath,
    pairClosed: pair.pairClosed,
    cursor: { attemptId: pair.cursor.attemptId, journeyClosed: cursorObs.journeyClosed, afterHelp: cursorObs.afterHelp },
    pi: { attemptId: pair.pi.attemptId, journeyClosed: piObs.journeyClosed, afterHelp: piObs.afterHelp },
  }),
);
