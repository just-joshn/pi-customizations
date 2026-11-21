import { type DebugServerConfig, type ModesRuntimeState, ZERO } from './types.ts';

function buildAskPrompt(): string {
  return [
    '[ASK MODE ACTIVE]',
    'You are in Ask mode — a strictly read-only Q&A mode for explanations, exploration, and answering questions.',
    '',
    'Rules:',
    '- File editing tools (edit, write) are disabled.',
    '- Shell commands are restricted to read-only inspection commands.',
    '- Do NOT attempt to modify files or execute mutating commands.',
    '- Answer questions thoroughly with concrete file paths and code references.',
    '- If the user asks you to implement changes, propose switching to Agent mode using the switch_mode tool.',
  ].join('\n');
}

function buildPlanPrompt(currentPlanUri: string | undefined): string {
  const existingNote = currentPlanUri ? `\nAn existing plan file is saved at: ${currentPlanUri}` : '';
  return [
    '[PLAN MODE ACTIVE]',
    'You are in Plan mode — a strictly read-only exploration and architectural planning mode.',
    '',
    'Rules:',
    '- File editing tools (edit, write) are disabled; shell commands are restricted to read-only inspection.',
    '- Explore the codebase thoroughly before proposing a plan.',
    '- When requirements are ambiguous, call ask_question with concise, concrete options.',
    '- When ready, call create_plan with a clear name, overview, structured todos, and detailed markdown plan.',
    '- Do NOT attempt to make code edits directly; wait for the user to approve and build the plan.',
    existingNote,
  ]
    .filter((line) => line.length > ZERO || line === '')
    .join('\n')
    .trim();
}

function buildDebugPrompt(debugConfig: DebugServerConfig | undefined): string {
  const endpointBlock = debugConfig
    ? [
        'Runtime Telemetry Server (LIVE):',
        `- Ingest endpoint: ${debugConfig.serverEndpoint}`,
        `- Required header: X-Debug-Session-Id: ${debugConfig.sessionId}`,
        `- NDJSON log file: ${debugConfig.logPath}`,
        '',
        'Instrumentation guidance:',
        '- Send NDJSON JSON objects via HTTP POST to the ingest endpoint with header `X-Debug-Session-Id` (or append JSON lines directly to the log file):',
        '  `{"id":"evt-1","timestamp":1700000000000,"location":"file.ts:42","message":"branch taken","data":{...}}`',
      ].join('\n')
    : 'Runtime Telemetry Server: starting on demand.';

  return [
    '[DEBUG MODE ACTIVE]',
    'You are in Debug mode — a hypothesis-driven runtime debugging workflow.',
    '',
    endpointBlock,
    '',
    'Workflow:',
    '1. Inspect the relevant code and form explicit, testable hypotheses for the root cause.',
    '2. Add minimal, targeted runtime logging instrumentation emitting structured NDJSON telemetry.',
    '3. Ask the user to reproduce the issue by wrapping exact reproduction instructions inside `<reproduction_steps>...</reproduction_steps>` tags.',
    '4. After reproduction, read the NDJSON log file to verify or refute each hypothesis with real runtime evidence.',
    '5. Apply a minimal, verified fix. Do not guess without evidence.',
    '6. Once the user marks the issue as fixed, remove all temporary instrumentation and delete the session debug log file.',
  ].join('\n');
}

function buildPlanExecutionPrompt(state: ModesRuntimeState): string | undefined {
  if (!state.planExecuting || state.planSteps.length === ZERO) {
    return undefined;
  }
  const remaining = state.planSteps.filter((step) => !step.completed);
  if (remaining.length === ZERO) {
    return undefined;
  }
  const stepLines = remaining.map((step) => `${step.step}. ${step.text}`).join('\n');
  return ['[EXECUTING PLAN - Agent mode with full tool access]', '', 'Remaining plan steps:', stepLines, '', 'Execute each step in order. After completing a step, include `[DONE:n]` in your response.'].join('\n');
}

export function buildModeContextMessage(state: ModesRuntimeState): string | undefined {
  if (state.mode === 'ask') {
    return buildAskPrompt();
  }
  if (state.mode === 'plan') {
    return buildPlanPrompt(state.currentPlanUri);
  }
  if (state.mode === 'debug') {
    return buildDebugPrompt(state.debugConfig);
  }
  return buildPlanExecutionPrompt(state);
}
