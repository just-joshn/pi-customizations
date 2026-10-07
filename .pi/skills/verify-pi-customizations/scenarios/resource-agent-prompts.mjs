import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { literalSegments, prepareRecorderDir, readJsonl, readSurfaces, singleQuotedConst, stripFrontmatter, templateLiteral } from './lib/resource-surfaces.mjs';

const PROVIDER = fileURLToPath(new URL('./lib/resource-recorder-provider.mjs', import.meta.url));
const PSTACK = 'extensions/pi-pstack';

const BUILTIN_AGENTS = [
  { surfaceId: 'PS-AGENT-01', agent: 'general-purpose', promptExport: null },
  { surfaceId: 'PS-AGENT-02', agent: 'explore', promptExport: 'explorePrompt' },
  { surfaceId: 'PS-AGENT-03', agent: 'task', promptExport: 'taskPrompt' },
  { surfaceId: 'PS-AGENT-04', agent: 'code-review', promptExport: 'codeReviewPrompt' },
  { surfaceId: 'PS-AGENT-05', agent: 'security-review', promptExport: 'securityReviewPrompt' },
  { surfaceId: 'PS-AGENT-06', agent: 'research', promptExport: 'researchPrompt' },
  { surfaceId: 'PS-AGENT-07', agent: 'rubber-duck', promptExport: 'rubberDuckPrompt' },
  { surfaceId: 'PS-AGENT-08', agent: 'rem-agent', promptExport: 'remAgentPrompt' },
];

const PERSONA_AGENTS = [
  { surfaceId: 'PS-AGENT-09', persona: 'shell', inlineConst: 'shell', files: [] },
  { surfaceId: 'PS-AGENT-10', persona: 'poteto-agent', files: ['upstream/agents/poteto-agent.md', 'skills/poteto-mode/SKILL.md'] },
  { surfaceId: 'PS-AGENT-11', persona: 'comment-sicko', files: ['upstream/agents/comment-sicko.md'] },
  { surfaceId: 'PS-AGENT-12', persona: 'ci-watcher', files: ['upstream-team-kit/agents/ci-watcher.md'] },
  { surfaceId: 'PS-AGENT-13', persona: 'thermo-nuclear-code-quality-review', files: ['upstream-team-kit/agents/thermo-nuclear-code-quality-review.md', 'skills/thermo-nuclear-code-quality-review/SKILL.md'] },
];

const CREW_AGENTS = [
  { surfaceId: 'CV-AGENT-1', role: 'builder' },
  { surfaceId: 'CV-AGENT-2', role: 'investigator' },
  { surfaceId: 'CV-AGENT-3', role: 'reviewer' },
];

// The general-purpose definition carries an empty builtin prompt, so no persona text exists to
// compare. The launch is still observed, but the row's source cannot be distinguished by prompt.
const INCONCLUSIVE = {
  'PS-AGENT-01':
    'The general-purpose AgentDefinition has an empty prompt, so the child system prompt carries only the assembled built-in sections. The child launch and those sections are observed, but the row source has no persona text to match.',
};

function rowFor(repoRoot, surfaceId) {
  const row = readSurfaces(repoRoot).find((candidate) => candidate.surface_id === surfaceId);
  if (!row) throw new Error(`surfaces.tsv has no ${surfaceId}`);
  return row;
}

function writeAgentReceipt(context, row, { observed, evidence, transport }) {
  const reason = INCONCLUSIVE[row.surface_id] ?? null;
  const verdict = !transport.ok ? 'failed' : reason ? 'inconclusive' : 'verified';
  context.receipts.write({
    surfaceId: row.surface_id,
    package: row.package,
    expected: row.expected,
    observed: transport.ok ? observed : `${observed} [transport check failed: ${transport.diff}]`,
    evidence,
    verdict,
    scope: 'behaviour',
    reason: verdict === 'failed' ? transport.diff : reason,
  });
}

async function driveChild(context, state, session, row, driveText, expectedSegments, { requireParentFirst = true } = {}) {
  const before = readJsonl(state.recorderPath).length;
  await session.prompt(driveText);
  const fresh = readJsonl(state.recorderPath).slice(before);
  const systemTexts = fresh.map((record) => record.systemText ?? '');
  const matches = systemTexts.map((systemText, index) => ({ index, systemText })).filter((candidate) => expectedSegments.every((segment) => candidate.systemText.includes(segment)));
  // The drive's own model call is the first record; the child's is a later one. General-purpose has
  // an empty prompt, so its assembled section tags also appear in the parent and the child is told
  // apart by the longer appended system prompt instead.
  const parentCarries = expectedSegments.every((segment) => systemTexts[0]?.includes(segment));
  const dispatched = requireParentFirst ? !parentCarries && matches.length >= 1 : matches.some((match) => match.index > 0 && match.systemText.length > (systemTexts[0]?.length ?? 0));
  const matched = requireParentFirst ? matches[0] : matches.find((match) => match.index > 0 && match.systemText.length > (systemTexts[0]?.length ?? 0));
  const checks = [`${fresh.length} model call(s) recorded`, `${matches.length} system prompt(s) carry the full source`, `parent carries the source: ${parentCarries}`];
  if (!dispatched) checks.push(`no child system prompt carried the full source (${expectedSegments.length} segments)`);
  writeAgentReceipt(context, row, {
    observed: `child systemPrompt ${matched ? `${matched.systemText.length} bytes at call ${matched.index}` : 'not matched'}; ${checks.join('; ')}`,
    evidence: state.evidence,
    transport: { ok: dispatched, diff: dispatched ? '' : checks.join('; ') },
  });
}

async function sessionFor(context, spec) {
  const dirs = prepareRecorderDir(context, `resource-agent-${spec.key}`, PROVIDER);
  const session = context.startSession({
    packagePath: join(context.repoRoot, spec.packagePath),
    agentDir: dirs.agentDir,
    cwd: dirs.agentDir,
    captureName: `resource-agent-${spec.key}.jsonl`,
    extraExtensions: [PROVIDER],
    env: {
      RESOURCE_RECORDER_PATH: dirs.recorderPath,
      RESOURCE_INPUT_LOG: join(dirs.agentDir, 'inputs.jsonl'),
      ...spec.env,
    },
    requestTimeoutMs: 60000,
  });
  return { dirs, session, state: { recorderPath: dirs.recorderPath, evidence: context.rawPath(`resource-agent-${spec.key}-records.jsonl`) } };
}

function persist(context, spec, dirs) {
  copyFileSync(dirs.recorderPath, context.rawPath(`resource-agent-${spec.key}-records.jsonl`));
}

async function drivePstackAgents(context, builtinPrompts, personasSource) {
  const { dirs, session, state } = await sessionFor(context, { key: 'pstack', packagePath: PSTACK, env: { COPILOT_SUBCONSCIOUS: '1' } });
  try {
    for (const spec of BUILTIN_AGENTS) {
      const row = rowFor(context.repoRoot, spec.surfaceId);
      const segments = spec.promptExport === null ? ['<tools>', '<prohibited_actions>', '<tool_calling>', '<environment_context>'] : literalSegments(templateLiteral(builtinPrompts, spec.promptExport) ?? '');
      if (segments.length === 0) throw new Error(`${spec.surfaceId} has no builtin prompt source to compare`);
      await driveChild(context, state, session, row, `LAUNCH_TASK:${spec.agent}`, segments, { requireParentFirst: spec.promptExport !== null });
    }
    for (const spec of PERSONA_AGENTS) {
      const row = rowFor(context.repoRoot, spec.surfaceId);
      const segments = spec.inlineConst ? [singleQuotedConst(personasSource, spec.inlineConst)] : spec.files.map((file) => readFileSync(join(context.repoRoot, PSTACK, file), 'utf8'));
      if (segments.some((segment) => typeof segment !== 'string' || segment.length === 0)) throw new Error(`${spec.surfaceId} has no persona source to compare`);
      await driveChild(context, state, session, row, `LAUNCH_PERSONA:${spec.persona}`, segments);
    }
  } finally {
    persist(context, { key: 'pstack' }, dirs);
    await session.close();
  }
}

async function driveCrewAgents(context) {
  const { dirs, session, state } = await sessionFor(context, {
    key: 'caveman',
    packagePath: 'extensions/pi-caveman',
    env: {
      HOME: join(context.scratchDir, 'caveman-home'),
      XDG_CONFIG_HOME: join(context.scratchDir, 'caveman-xdg'),
      XDG_DATA_HOME: join(context.scratchDir, 'caveman-data'),
      CAVEMAN_HOME: join(context.scratchDir, 'caveman'),
      PI_OFFLINE: '1',
      CAVECREW_INVESTIGATOR_MODEL: undefined,
      CAVECREW_BUILDER_MODEL: undefined,
      CAVECREW_REVIEWER_MODEL: undefined,
    },
  });
  try {
    for (const [index, spec] of CREW_AGENTS.entries()) {
      const row = rowFor(context.repoRoot, spec.surfaceId);
      const prompt = stripFrontmatter(readFileSync(join(context.repoRoot, 'extensions/pi-caveman/agents', `cavecrew-${spec.role}.md`), 'utf8'));
      await driveChild(context, state, session, row, `CAVEMAN_CALL_CAVECREW_${index + 1} ROLE=${spec.role}`, [prompt]);
    }
  } finally {
    persist(context, { key: 'caveman' }, dirs);
    await session.close();
  }
}

export default async function resourceAgentPrompts(context) {
  const builtinPrompts = readFileSync(join(context.repoRoot, PSTACK, 'src/subagents/builtin-prompts.ts'), 'utf8');
  const personasSource = readFileSync(join(context.repoRoot, PSTACK, 'src/personas.ts'), 'utf8');
  await drivePstackAgents(context, builtinPrompts, personasSource);
  await driveCrewAgents(context);
  writeFileSync(
    context.rawPath('agent-summary.json'),
    `${JSON.stringify({ pstackRecords: readJsonl(context.rawPath('resource-agent-pstack-records.jsonl')).length, cavemanRecords: readJsonl(context.rawPath('resource-agent-caveman-records.jsonl')).length }, null, 2)}\n`,
  );
  context.log(`✓ resource-agent-prompts wrote ${context.receipts.receipts().length} receipts`);
}
