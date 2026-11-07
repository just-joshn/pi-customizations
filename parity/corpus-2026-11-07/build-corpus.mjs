import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const here = new URL('.', import.meta.url).pathname;
const prior = JSON.parse(readFileSync(`${here}prior/corpus.json`, 'utf8'));
const added = JSON.parse(readFileSync(`${here}new-scenarios.json`, 'utf8'));
const sha = (value) => createHash('sha256').update(value).digest('hex');

const original = prior.scenarios.map((scenario) => {
  const auto = scenario.automatic;
  const mandatory = [{ id: 'run-valid', kind: 'runValid' }];
  if (auto.unchangedTree) mandatory.push({ id: 'unchanged-tree', kind: 'unchangedTree' });
  if (auto.forbiddenTools) mandatory.push({ id: 'forbidden-tools', kind: 'noTool', tools: auto.forbiddenTools });
  const outcome = [];
  if (auto.requiredText) outcome.push({ id: 'text-presence', kind: 'finalTextIncludes', texts: auto.requiredText, caseInsensitive: true });
  if (auto.exactFinalText !== undefined) outcome.push({ id: 'exact-final-text', kind: 'finalTextExact', text: auto.exactFinalText });
  return { ...scenario, origin: 'parity/pstack-release-2026-11-06/corpus.json (stash@{0}, defined 2026-11-06)', repeats: 3, turnTimeoutMs: 180000, mandatory, outcome };
});

const corpus = {
  schemaVersion: 2,
  sourceRevision: prior.sourceRevision,
  definedBeforeExecution: '2026-11-07',
  scope: 'Five model-mediated scenarios defined 2026-11-06 plus six host and invocation scenarios defined 2026-11-07, before any run of this corpus. Not complete contract coverage.',
  priorCorpusSha256: sha(readFileSync(`${here}prior/corpus.json`)),
  protocol: {
    repeats: 'Per scenario: 3 for the 2026-11-06 scenarios, 2 for the 2026-11-07 scenarios.',
    order: 'Pairs run sequentially in corpus order. Odd global pair ordinals run Cursor first, even ordinals run Pi first. Every declared attempt runs once with no retries, and every attempt is retained, failures included.',
    concurrency: 'One host process at a time, so Pi OAuth refreshes through the symlinked auth file never race each other.',
    fixture: prior.protocol.fixture,
    model: 'gpt-5.6-sol at medium reasoning on both hosts. Cursor --model gpt-5.6-sol-medium (reports "GPT-5.6 Sol 272K Medium"). Pi --model openai/gpt-5.6-sol --thinking medium (catalog context 272K). Unmatched or unobservable controls: provider routing and build identity, temperature, top-p, seed, output cap, host system prompts and tool schemas, and subagent models chosen by skills (each host resolves skill defaults against its own catalog).',
    cursorInvocation: 'cursor-agent --print --output-format stream-json --trust --force --model gpt-5.6-sol-medium --plugin-dir <pstack> --plugin-dir <cursor-team-kit> [--resume <session>] -- <message>. Isolated HOME/XDG per attempt; the only link to the user profile is HOME/Library/Keychains -> ~/Library/Keychains for login. --force matches Pi, which has no command approval gate. The 2026-11-06 run omitted --force.',
    piInvocation: 'pi --mode json --model openai/gpt-5.6-sol --thinking medium --no-mcp --session-dir <attempt>/sessions --session-id <fixed uuid per attempt> -- <message>. Fresh PI_CODING_AGENT_DIR per attempt with only the packed pi-pstack installed by `pi install npm:@justjoshn/pi-pstack@file:<archive>`, and auth.json symlinked to the user file, never copied.',
    toolNameMap: {
      cursor: { readToolCall: 'read', shellToolCall: 'bash', editToolCall: 'edit', writeToolCall: 'write', deleteToolCall: 'delete', updateTodosToolCall: 'TodoWrite', taskToolCall: 'Task', awaitToolCall: 'AwaitShell', globToolCall: 'find', grepToolCall: 'grep', lsToolCall: 'ls', getMcpToolsToolCall: 'GetDynamicTools' },
      pi: { read: 'read', bash: 'bash', bash_background: 'bash_background', edit: 'edit', write: 'write', TodoWrite: 'TodoWrite', Task: 'Task', AwaitShell: 'AwaitShell', find: 'find', grep: 'grep', ls: 'ls' },
    },
    checkKinds: {
      runValid: 'Every turn: process exit 0, no timeout, no output cap, no host error event. Every turn not listed in hostCommandTurns for that host: the host reports a completed agent turn and every assistant message reports gpt-5.6-sol at medium (Pi provider openai, thinking medium; Cursor model label GPT-5.6 Sol <ctx> Medium).',
      unchangedTree: 'Repository file manifest, HEAD, tree, status, and diff are identical before and after.',
      noTool: 'No call to any listed normalized tool (in the given turn, or any turn).',
      toolCount: 'Count of calls to the normalized tool lies within [min, max].',
      readPath: 'A read call whose path matches the pattern, or a bash call whose command contains a string matching it.',
      noReadPath: 'Negation of readPath.',
      todoFirstMatchesPlaybookStep: 'The first TodoWrite call (in the turn) has a first item whose normalized content contains the first six normalized words of step 1 of a playbook the agent read in that turn, taken from Cursor pstack at sourceRevision. Normalization: lowercase, drop ** and backticks and leading list numbers, collapse whitespace.',
      everyTaskReadonly: 'Every Task call has readonly true. UNVERIFIED on a host whose events do not carry the field.',
      everyTaskSubagentType: 'Every Task call names the subagent type.',
      shellStatePersists: 'Some bash call matches setPattern, and a later separate bash call matches usePattern, contains no cd and no CORPUS_PROBE assignment, and its own output contains every expect string.',
      shellCallCount: 'Number of bash or bash_background calls whose command contains the pattern equals the value.',
      shellMovedToBackground: 'The first such call is a foreground bash call (Pi tool bash; Cursor isBackground false) and its result says it moved to the background (Cursor backgroundReason set or background text; Pi background text).',
      toolAfterShell: 'A call to the tool occurs after that shell call.',
      toolResultAfterShellIncludes: 'A tool result or host notification event after that shell call starts contains the text (Cursor tool_call completed and system events; Pi tool_execution_update/end and non-assistant, non-user messages). Assistant text does not count.',
      finalTextIncludes: 'The final assistant text of the turn (last turn by default) contains each string (case-sensitive unless caseInsensitive).',
      finalTextExact: 'The final assistant text equals the string.',
      hostFileAbsent: "The host's pstack model rule file does not exist after the attempt.",
    },
    scoring: 'Mandatory checks are workflow steps and effects; outcome checks are reply content and optional paths. A check is PASS, FAIL, or UNVERIFIED. A scenario attempt passes mandatory only if every mandatory check is PASS. An invalid run (runValid FAIL) still has every other check scored on what happened and is reported as invalid, never dropped. Prose assertions not encoded as checks are not machine-scored and are reported as UNVERIFIED.',
    normalization: prior.protocol.normalization,
    notNormalized: prior.protocol.notNormalized,
    credentialHandling: 'Credentials are symlinked, never copied or printed. Retained transcripts are scrubbed for bearer tokens, JWTs, and the literal token values of the user auth file before they are written.',
  },
  scenarios: [...original, ...added],
};

for (const scenario of corpus.scenarios) scenario.messageSha256 = scenario.messages.map(sha);
writeFileSync(`${here}corpus.json`, `${JSON.stringify(corpus, null, 2)}\n`);
console.log(corpus.scenarios.map((s) => `${s.id} x${s.repeats}`).join('\n'));
