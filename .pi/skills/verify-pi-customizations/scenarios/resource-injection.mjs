import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { comparePromptExpansion, compareSkillInjection, encodePromptArgument, prepareRecorderDir, readJsonl, resourceRows, stripFrontmatter, surfaceName } from './lib/resource-surfaces.mjs';

const PROVIDER = fileURLToPath(new URL('./lib/resource-recorder-provider.mjs', import.meta.url));
const OBSERVER = fileURLToPath(new URL('./lib/resource-input-observer.mjs', import.meta.url));
const SETUP_BUDGET = 'small — medium reasoning';
const PROMPT_ARGS = 'add cache';

// Rows whose expected text is a workflow outcome rather than transport. The injected payload is
// still compared, but the row stays inconclusive because no workflow ran.
const OUTCOME_ROWS = {
  'RS-SKILL-1': 'The row claims a workflow outcome (report Pi setup health, then apply only confirmed fixes). This drive proves the full doctor skill body is injected, but it runs no doctor workflow.',
  'RS-SKILL-2': 'The row claims a workflow outcome (launch the real app per bundled recipes). This drive proves the full run skill body is injected and does not launch any app.',
  'RS-SKILL-3': 'The row claims a workflow outcome (four parallel cleanup reviewers, then applied fixes). This drive proves the full simplify skill body is injected and spawns no reviewers.',
  'RS-SKILL-4': 'The row claims a workflow outcome (an .re/ evidence workspace, probe scripts, reports). This drive proves the full reverse-engineer-cli skill body is injected and creates no workspace.',
  'RS-SKILL-5': 'The row claims a workflow outcome (a differential implementation against a captured contract). This drive proves the full implement-cli-from-contract skill body is injected and implements nothing.',
};

const SESSIONS = [
  { key: 'pstack', packagePath: 'extensions/pi-pstack', packages: ['extensions/pi-pstack'] },
  { key: 'caveman', packagePath: 'extensions/pi-caveman', packages: ['extensions/pi-caveman'] },
  { key: 's50', packagePath: 'extensions/pi-s50', packages: ['extensions/pi-s50'] },
  { key: 'root', packagePath: '.', packages: ['skills'] },
];

function setupAnswers() {
  return {
    select: (request) => {
      if (request.options?.includes('Accept as-is')) return 'Accept as-is';
      if (String(request.title ?? '').startsWith('pstack reasoning budget')) return SETUP_BUDGET;
      return 'auto';
    },
    input: () => 'auto',
    confirm: () => true,
  };
}

function writeResourceReceipt(context, row, { observed, evidence, transport }) {
  const reason = OUTCOME_ROWS[row.surface_id] ?? null;
  const verdict = !transport.ok ? 'failed' : reason ? 'inconclusive' : 'verified';
  context.receipts.write({
    surfaceId: row.surface_id,
    package: row.package,
    expected: row.expected,
    observed: transport.ok ? observed : `${observed} [transport check failed: ${transport.diff}]`,
    evidence,
    verdict,
    scope: 'behaviour',
    reason: verdict === 'failed' ? transport.diff || 'transport check reported a failure without a diff' : reason,
  });
}

function newRecords(state) {
  const records = readJsonl(state.recorderPath);
  const fresh = records.slice(state.recordCount);
  state.recordCount = records.length;
  return fresh;
}

function injectedTexts(records) {
  return records.flatMap((record) => (Array.isArray(record.userTexts) ? record.userTexts : []));
}

function isPstackOwnedPrompt(context, path) {
  return ['extensions/pi-pstack/prompts', 'extensions/pi-pstack/host/prompts'].some((dir) => path.startsWith(join(context.repoRoot, dir)));
}

async function driveSkill(context, state, session, commands, row) {
  const name = surfaceName(row);
  const command = commands.find((candidate) => candidate.name === `skill:${name}` && candidate.source === 'skill');
  if (!command) {
    writeResourceReceipt(context, row, { observed: `skill:${name} is not registered`, evidence: state.evidence, transport: { ok: false, diff: `skill:${name} missing from the discovered skill commands` } });
    return;
  }
  const location = command.sourceInfo.path;
  const body = stripFrontmatter(readFileSync(location, 'utf8')).trim();
  const sentinel = `SENTINEL-${row.surface_id}`;
  await session.prompt(`/skill:${name} ${sentinel}`);
  const records = newRecords(state);
  const texts = injectedTexts(records);

  const transport = compareSkillInjection({ userTexts: texts, name, location, body, args: sentinel });
  // `/skill:poteto-mode` is intercepted by registerNativeInput: it toggles sticky mode on and then
  // injects the block. The row only claims the injection, so the toggle is recorded alongside it.
  const toggledOn = row.surface_id === 'PS-SKILL-24' && session.entries.some((entry) => entry.type === 'custom' && entry.customType === 'pstack-state' && entry.data?.enabled === true);
  if (row.surface_id === 'PS-SKILL-24' && !toggledOn) transport.diff = `${transport.diff ? `${transport.diff}; ` : ''}no pstack-state entry with enabled true was appended`;
  if (row.surface_id === 'PS-SKILL-24') transport.ok = transport.ok && toggledOn;
  if (body.length === 0) {
    transport.ok = false;
    transport.diff = `${location} stripped to an empty body`;
  }
  writeResourceReceipt(context, row, {
    observed: `injected block name=${name} location=${location} body=${body.length} bytes sentinel=${sentinel}; recorded ${texts.length} new user message(s) in ${records.length} model call(s)${row.surface_id === 'PS-SKILL-24' ? `; sticky mode toggled on: ${toggledOn}` : ''}`,
    evidence: state.evidence,
    transport,
  });
}

async function drivePrompt(context, state, session, commands, row) {
  const name = surfaceName(row);
  const command = commands.find((candidate) => candidate.name === name && candidate.source === 'prompt');
  if (!command) {
    writeResourceReceipt(context, row, { observed: `prompt ${name} is not registered`, evidence: state.evidence, transport: { ok: false, diff: `prompt ${name} missing from the discovered prompt templates` } });
    return;
  }
  const path = command.sourceInfo.path;
  const content = stripFrontmatter(readFileSync(path, 'utf8'));
  const requoted = isPstackOwnedPrompt(context, path) && name !== 'bro';
  const expectedInput = requoted ? `/${name} ${encodePromptArgument(PROMPT_ARGS)}` : `/${name} ${PROMPT_ARGS}`;
  const inputCount = readJsonl(state.inputLogPath).length;
  await session.prompt(`/${name} ${PROMPT_ARGS}`);
  const inputs = readJsonl(state.inputLogPath)
    .slice(inputCount)
    .filter((entry) => entry.text.startsWith(`/${name}`) || entry.text.startsWith(`/skill:${name}`));
  const observedInput = inputs.at(-1)?.text;
  const texts = injectedTexts(newRecords(state));
  const diffs = [];
  if (observedInput !== expectedInput) diffs.push(`input hook ${JSON.stringify(observedInput)} != ${JSON.stringify(expectedInput)}`);
  if (content.length === 0) diffs.push('prompt template stripped to an empty body');

  const expansion = comparePromptExpansion({ userTexts: texts, content, args: requoted ? encodePromptArgument(PROMPT_ARGS) : PROMPT_ARGS });
  if (!expansion.ok) diffs.push(expansion.diff);
  writeResourceReceipt(context, row, {
    observed: `input hook ${JSON.stringify(observedInput)}; expanded ${expansion.expected.length} bytes from ${content.length} source bytes for ${JSON.stringify(PROMPT_ARGS)}`,
    evidence: state.evidence,
    transport: { ok: diffs.length === 0, diff: diffs.join('; ') },
  });
}

function persistEvidence(context, spec, dirs) {
  const records = context.rawPath(`resource-injection-${spec.key}-records.jsonl`);
  const inputs = context.rawPath(`resource-injection-${spec.key}-inputs.jsonl`);
  copyFileSync(dirs.recorderPath, records);
  copyFileSync(dirs.inputLogPath, inputs);
  return { records, inputs };
}

export default async function resourceInjection(context) {
  const allRows = resourceRows(context.repoRoot).filter((row) => row.kind === 'skill' || row.kind === 'prompt-template');
  for (const spec of SESSIONS) {
    const rows = allRows.filter((row) => spec.packages.includes(row.package));
    if (rows.length === 0) continue;
    const dirs = prepareRecorderDir(context, `resource-injection-${spec.key}`, PROVIDER);
    const session = context.startSession({
      packagePath: join(context.repoRoot, spec.packagePath),
      agentDir: dirs.agentDir,
      cwd: dirs.agentDir,
      captureName: `resource-injection-${spec.key}.jsonl`,
      extraExtensions: [PROVIDER, OBSERVER],
      env: {
        RESOURCE_RECORDER_PATH: dirs.recorderPath,
        RESOURCE_INPUT_LOG: dirs.inputLogPath,
        ...(spec.key === 'caveman'
          ? {
              HOME: join(context.scratchDir, 'caveman-home'),
              XDG_CONFIG_HOME: join(context.scratchDir, 'caveman-xdg'),
              XDG_DATA_HOME: join(context.scratchDir, 'caveman-data'),
              CAVEMAN_HOME: join(context.scratchDir, 'caveman'),
              PI_OFFLINE: '1',
            }
          : {}),
      },
      answers: setupAnswers(),
      requestTimeoutMs: 60000,
    });
    try {
      const commands = await session.commands();
      const evidence = context.rawPath(`resource-injection-${spec.key}-records.jsonl`);
      persistEvidence(context, spec, dirs);
      const state = { recorderPath: dirs.recorderPath, inputLogPath: dirs.inputLogPath, recordCount: 0, evidence };
      for (const row of rows.filter((candidate) => candidate.kind === 'skill')) await driveSkill(context, state, session, commands, row);
      for (const row of rows.filter((candidate) => candidate.kind === 'prompt-template')) await drivePrompt(context, state, session, commands, row);
      writeFileSync(context.rawPath(`${spec.key}-observations.json`), `${JSON.stringify({ rows: rows.map((row) => row.surface_id), records: readJsonl(dirs.recorderPath).length, inputs: readJsonl(dirs.inputLogPath) }, null, 2)}\n`);
    } finally {
      persistEvidence(context, spec, dirs);
      await session.close();
    }
  }
  context.log(`✓ resource-injection wrote ${context.receipts.receipts().length} receipts`);
}
