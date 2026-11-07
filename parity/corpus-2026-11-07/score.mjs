// Scores every retained attempt under runs/ against the pre-registered checks in corpus.json.
// Usage: node score.mjs [--runs runs] [--plugins /path/to/cursor/plugins]
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { parseArgs } from 'node:util';

const here = dirname(new URL(import.meta.url).pathname);
const { values: opts } = parseArgs({ options: { runs: { type: 'string', default: join(here, 'runs') }, plugins: { type: 'string', default: '/Users/josh-desktop/src/experiments/plugins' } } });
const corpus = JSON.parse(readFileSync(join(here, 'corpus.json'), 'utf8'));
const nameMap = corpus.protocol.toolNameMap;

const playbookStep1 = new Map();
function step1(name) {
  if (!playbookStep1.has(name)) {
    let text = null;
    try {
      const source = execFileSync('git', ['-C', opts.plugins, 'show', `${corpus.sourceRevision}:pstack/skills/poteto-mode/playbooks/${name}.md`], { encoding: 'utf8' });
      text = source.split('\n').find((line) => /^1\.\s/.test(line)) ?? null;
    } catch {}
    playbookStep1.set(name, text);
  }
  return playbookStep1.get(name);
}
const normalize = (text) => String(text ?? '').toLowerCase().replace(/\*\*|`/g, '').replace(/^\s*\d+\.\s*/, '').replace(/\s+/g, ' ').trim();

function lines(raw) {
  const events = [];
  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    try { events.push(JSON.parse(line)); } catch { events.push({ type: '__malformed__', line }); }
  }
  return events;
}
const textOf = (message) => typeof message?.content === 'string' ? message.content
  : (Array.isArray(message?.content) ? message.content : []).filter((part) => part.type === 'text').map((part) => part.text).join('');

// One normalized view per turn: tools in call order with args and result text, notification texts, final text, completion, identities, host errors.
function parseTurn(host, raw) {
  const events = lines(raw);
  const tools = []; const byId = new Map(); const errors = []; const identities = []; const after = [];
  let finalText = ''; let completed = false; let malformed = 0;
  for (const event of events) {
    if (event.type === '__malformed__') { malformed += 1; continue; }
    if (host === 'pi') {
      if (event.type === 'error' || event.type === 'extension_error') errors.push(event.error ?? event.message ?? 'error event');
      if (event.type === 'auto_retry_end' && event.success === false) errors.push(event.finalError ?? 'retry failed');
      if (event.type === 'agent_settled') completed = event.aborted === false;
      if (event.type === 'message_end') {
        const message = event.message;
        if (message?.role === 'assistant') {
          identities.push({ provider: message.provider, model: message.model, thinking: message.thinkingLevel });
          if (message.stopReason === 'error' || message.stopReason === 'aborted') errors.push(message.errorMessage ?? message.stopReason);
          const text = textOf(message);
          if (text.trim()) finalText = text;
        } else if (message?.role !== 'user') {
          after.push({ at: tools.length, text: JSON.stringify(message) });
        }
      }
      if (event.type === 'tool_execution_start') {
        const tool = { id: event.toolCallId, name: nameMap.pi[event.toolName] ?? event.toolName, args: event.args ?? {}, resultText: '', isError: false };
        tools.push(tool); byId.set(tool.id, tool);
      }
      if (event.type === 'tool_execution_update') after.push({ at: tools.length, text: JSON.stringify(event.partialResult ?? event) });
      if (event.type === 'tool_execution_end') {
        const tool = byId.get(event.toolCallId);
        const text = (event.result?.content ?? []).filter((part) => part.type === 'text').map((part) => part.text).join('\n');
        if (tool) { tool.resultText = text; tool.isError = Boolean(event.isError); }
        after.push({ at: tools.length, text });
      }
    } else {
      if (event.type === 'system' && event.subtype === 'init') identities.push({ model: event.model });
      else if (event.type === 'system') after.push({ at: tools.length, text: JSON.stringify(event) });
      if (event.type === 'error') errors.push(JSON.stringify(event).slice(0, 500));
      if (event.type === 'result') {
        completed = event.subtype === 'success' && event.is_error === false;
        if (!completed) errors.push(JSON.stringify(event).slice(0, 500));
        if (typeof event.result === 'string') finalText = event.result;
      }
      if (event.type === 'tool_call') {
        for (const [key, value] of Object.entries(event.tool_call ?? {})) {
          if (!key.endsWith('ToolCall')) continue;
          if (event.subtype === 'started') {
            const tool = { id: event.call_id, name: nameMap.cursor[key] ?? key, args: value?.args ?? {}, resultText: '', isError: false };
            tools.push(tool); byId.set(tool.id, tool);
          } else if (event.subtype === 'completed') {
            const tool = byId.get(event.call_id);
            const result = value?.result ?? {};
            const success = result.success ?? {};
            const text = key === 'shellToolCall'
              ? [success.stdout ?? success.interleavedOutput ?? '', success.stderr ?? '', success.backgroundReason ? `backgroundReason=${success.backgroundReason}` : '', result.failure ? JSON.stringify(result.failure) : '', result.rejected ? JSON.stringify(result.rejected) : ''].join('\n')
              : JSON.stringify(result);
            if (tool) { tool.resultText = text; tool.isError = Boolean(result.failure || result.error || result.rejected); tool.result = result; tool.completedArgs = value?.args; }
            after.push({ at: tools.length, text });
          }
        }
      }
    }
  }
  return { tools, after, finalText, completed, identities, errors, malformed, eventCount: events.length };
}

const pass = (detail) => ({ status: 'PASS', detail });
const fail = (detail) => ({ status: 'FAIL', detail });
const unverified = (detail) => ({ status: 'UNVERIFIED', detail });
const tokens = (command) => String(command ?? '').split(/[\s'"]+/).filter(Boolean);
const commandOf = (tool) => tool.args.command ?? '';
const readMatches = (tool, re) => (tool.name === 'read' && re.test(tool.args.path ?? tool.args.file_path ?? tool.args.targetFile ?? ''))
  || (tool.name === 'bash' && tokens(commandOf(tool)).some((token) => re.test(token)));
const subagentType = (args) => {
  if (typeof args.subagent_type === 'string') return args.subagent_type;
  const type = args.subagentType;
  if (typeof type === 'string') return type;
  if (type?.custom?.name) return type.custom.name;
  const key = type && Object.keys(type)[0];
  return key === 'unspecified' ? 'generalPurpose' : key ?? null;
};
const identityOk = (host, identity) => host === 'pi'
  ? identity.provider === 'openai' && identity.model === 'gpt-5.6-sol' && identity.thinking === 'medium'
  : /^GPT-5\.6 Sol\b.*\bMedium$/i.test(identity.model ?? '');

function evaluate(check, ctx) {
  const scoped = check.turn ? [ctx.turns[check.turn - 1]].filter(Boolean) : ctx.turns;
  const tools = scoped.flatMap((turn) => turn.parsed.tools);
  const after = (index) => scoped.flatMap((turn) => turn.parsed.after.filter((entry) => entry.at > index).map((entry) => entry.text));
  switch (check.kind) {
    case 'runValid': {
      const problems = [];
      if (ctx.result.setupError) problems.push(`setup: ${ctx.result.setupError}`);
      if (ctx.turns.length !== ctx.scenario.messages.length) problems.push(`ran ${ctx.turns.length}/${ctx.scenario.messages.length} turns`);
      const commandTurns = ctx.scenario.hostCommandTurns?.[ctx.host] ?? [];
      for (const turn of ctx.turns) {
        if (turn.exit?.code !== 0 || turn.exit?.timedOut) problems.push(`turn ${turn.turn} exit ${turn.exit?.code} timedOut ${turn.exit?.timedOut}`);
        if (turn.parsed.errors.length) problems.push(`turn ${turn.turn} errors ${JSON.stringify(turn.parsed.errors).slice(0, 300)}`);
        if (turn.parsed.malformed) problems.push(`turn ${turn.turn} malformed lines ${turn.parsed.malformed}`);
        if (!commandTurns.includes(turn.turn)) {
          if (!turn.parsed.completed) problems.push(`turn ${turn.turn} not completed`);
          if (!turn.parsed.identities.length) problems.push(`turn ${turn.turn} no model identity`);
        }
        const bad = turn.parsed.identities.filter((identity) => !identityOk(ctx.host, identity));
        if (bad.length) problems.push(`turn ${turn.turn} model ${JSON.stringify(bad)}`);
      }
      return problems.length ? fail(problems) : pass('valid');
    }
    case 'unchangedTree': {
      const { before, after: end } = ctx.result;
      const same = before && end && JSON.stringify(before.files) === JSON.stringify(end.files) && before.head === end.head && before.tree === end.tree && end.status === '' && end.diff === '';
      return same ? pass('unchanged') : fail({ status: end?.status, files: end?.files?.map((file) => file.path) });
    }
    case 'noTool': {
      const hits = tools.filter((tool) => check.tools.includes(tool.name));
      return hits.length ? fail(hits.map((tool) => ({ name: tool.name, args: JSON.stringify(tool.args).slice(0, 200) }))) : pass('none');
    }
    case 'toolCount': {
      const count = tools.filter((tool) => tool.name === check.tool).length;
      return count >= (check.min ?? 0) && count <= (check.max ?? Infinity) ? pass(count) : fail(count);
    }
    case 'readPath': case 'noReadPath': {
      const re = new RegExp(check.pattern);
      const hits = tools.filter((tool) => readMatches(tool, re)).map((tool) => tool.args.path ?? commandOf(tool));
      return (hits.length > 0) === (check.kind === 'readPath') ? pass(hits) : fail(hits);
    }
    case 'todoFirstMatchesPlaybookStep': {
      const re = /poteto-mode\/playbooks\/([a-z0-9-]+)\.md$/;
      const names = [...new Set(tools.flatMap((tool) => readMatches(tool, re) ? [(tool.args.path ?? tokens(commandOf(tool)).find((token) => re.test(token))).match(re)[1]] : []))];
      const todo = tools.find((tool) => tool.name === 'TodoWrite');
      if (!names.length) return fail('no playbook read');
      if (!todo) return fail({ playbooks: names, todo: 'no TodoWrite' });
      const first = normalize(todo.args.todos?.[0]?.content);
      const matched = names.find((name) => { const step = step1(name); return step && first.includes(normalize(step).split(' ').slice(0, 6).join(' ')); });
      return matched ? pass({ playbook: matched, first }) : fail({ playbooks: names, expected: names.map((name) => normalize(step1(name)).split(' ').slice(0, 6).join(' ')), first });
    }
    case 'everyTaskReadonly': {
      const tasks = tools.filter((tool) => tool.name === 'Task');
      if (!tasks.length) return unverified('no Task calls');
      if (tasks.some((tool) => tool.args.readonly === false)) return fail(tasks.map((tool) => tool.args.readonly));
      if (tasks.some((tool) => tool.args.readonly === undefined || tool.args.readonly === null)) return unverified({ reason: 'readonly not present in host events', values: tasks.map((tool) => tool.args.readonly ?? null) });
      return pass(tasks.length);
    }
    case 'everyTaskSubagentType': {
      const tasks = tools.filter((tool) => tool.name === 'Task');
      if (!tasks.length) return unverified('no Task calls');
      const types = tasks.map((tool) => subagentType(tool.args));
      return types.every((type) => type === check.equals) ? pass(types) : fail(types);
    }
    case 'shellStatePersists': {
      const shells = tools.filter((tool) => tool.name === 'bash');
      const set = shells.findIndex((tool) => new RegExp(check.setPattern).test(commandOf(tool)));
      if (set < 0) return fail({ reason: 'no setting call', commands: shells.map(commandOf) });
      const use = shells.slice(set + 1).find((tool) => new RegExp(check.usePattern).test(commandOf(tool)) && !/\bcd\b/.test(commandOf(tool)) && !/CORPUS_PROBE=/.test(commandOf(tool)));
      if (!use) return fail({ reason: 'no later separate use call', commands: shells.map(commandOf) });
      const missing = check.expect.filter((text) => !use.resultText.includes(text));
      return missing.length ? fail({ command: commandOf(use), output: use.resultText.slice(0, 300), missing }) : pass({ command: commandOf(use), output: use.resultText.slice(0, 200) });
    }
    case 'shellCallCount': {
      const count = tools.filter((tool) => ['bash', 'bash_background'].includes(tool.name) && commandOf(tool).includes(check.pattern)).length;
      return count === check.equals ? pass(count) : fail(count);
    }
    case 'shellMovedToBackground': case 'toolAfterShell': case 'toolResultAfterShellIncludes': {
      const index = tools.findIndex((tool) => ['bash', 'bash_background'].includes(tool.name) && commandOf(tool).includes(check.pattern));
      if (index < 0) return fail('no matching shell call');
      const shell = tools[index];
      if (check.kind === 'shellMovedToBackground') {
        const foreground = shell.name === 'bash' && shell.args.isBackground !== true && shell.args.is_background !== true;
        const moved = /background/i.test(shell.resultText);
        return foreground && moved ? pass({ timeoutArg: shell.args.timeout ?? null, result: shell.resultText.slice(-200) }) : fail({ tool: shell.name, foreground, timeoutArg: shell.args.timeout ?? null, result: shell.resultText.slice(-300) });
      }
      if (check.kind === 'toolAfterShell') {
        const later = tools.slice(index + 1).filter((tool) => tool.name === check.tool);
        return later.length ? pass(later.length) : fail({ later: tools.slice(index + 1).map((tool) => tool.name) });
      }
      const texts = [...after(scopedIndex(scoped, shell)), ...tools.slice(index).map((tool) => tool.resultText)];
      return texts.some((text) => text.includes(check.text)) ? pass('observed') : fail('not in any tool result or notification');
    }
    case 'finalTextIncludes': {
      const turn = check.turn ? ctx.turns[check.turn - 1] : ctx.turns.at(-1);
      const text = turn?.parsed.finalText ?? '';
      const hay = check.caseInsensitive ? text.toLowerCase() : text;
      const missing = check.texts.filter((needle) => !hay.includes(check.caseInsensitive ? needle.toLowerCase() : needle));
      return missing.length ? fail({ missing, final: text.slice(0, 300) }) : pass('present');
    }
    case 'finalTextExact': {
      const text = ctx.turns.at(-1)?.parsed.finalText ?? '';
      return text === check.text ? pass(text) : fail(text.slice(0, 300));
    }
    case 'hostFileAbsent':
      return ctx.result.hostModelRule?.exists === false ? pass(ctx.result.hostModelRule.path) : fail(ctx.result.hostModelRule);
    default:
      return unverified(`unknown check kind ${check.kind}`);
  }
}
// Position of a tool within its own turn's tool list, for the per-turn `after` offsets.
function scopedIndex(scoped, shell) {
  for (const turn of scoped) { const at = turn.parsed.tools.indexOf(shell); if (at >= 0) return at; }
  return -1;
}

const attempts = readdirSync(opts.runs, { withFileTypes: true }).filter((entry) => entry.isDirectory() && /^\d\d-/.test(entry.name)).map((entry) => entry.name).sort();
const rows = [];
for (const attempt of attempts) {
  for (const host of ['cursor', 'pi']) {
    const dir = join(opts.runs, attempt, host);
    const resultPath = join(dir, 'result.json');
    if (!existsSync(resultPath)) { rows.push({ attempt, host, missing: true }); continue; }
    const result = JSON.parse(readFileSync(resultPath, 'utf8'));
    const scenario = corpus.scenarios.find((entry) => entry.id === result.scenarioId);
    const turns = result.turns.map((turn) => ({ ...turn, parsed: parseTurn(host, existsSync(join(dir, `turn-${turn.turn}.stdout`)) ? readFileSync(join(dir, `turn-${turn.turn}.stdout`), 'utf8') : '') }));
    const ctx = { host, result, scenario, turns };
    const score = (list) => list.map((check) => ({ id: check.id, kind: check.kind, ...evaluate(check, ctx) }));
    const mandatory = score(scenario.mandatory);
    const outcome = score(scenario.outcome);
    rows.push({
      attempt, host, scenarioId: scenario.id, evidence: `runs/${attempt}/${host}`,
      valid: mandatory.find((check) => check.kind === 'runValid')?.status === 'PASS',
      mandatoryPass: mandatory.every((check) => check.status === 'PASS'),
      outcomePass: outcome.every((check) => check.status === 'PASS'),
      mandatory, outcome,
      durationsS: result.turns.map((turn) => Math.round((turn.exit?.durationMs ?? 0) / 1000)),
      tools: turns.map((turn) => turn.parsed.tools.map((tool) => tool.name).join(',')),
      tasks: turns.flatMap((turn) => turn.parsed.tools.filter((tool) => tool.name === 'Task').map((tool) => ({ type: subagentType(tool.args), readonly: tool.args.readonly ?? null, model: tool.args.model ?? null }))),
      finalText: turns.at(-1)?.parsed.finalText.slice(0, 400) ?? '',
    });
  }
}
writeFileSync(join(opts.runs, 'score.json'), `${JSON.stringify({ scoredAt: new Date().toISOString(), rows }, null, 2)}\n`);

const out = [];
const pct = (list, key) => `${list.filter((row) => row[key]).length}/${list.length}`;
out.push('| Scenario | Cursor mandatory | Pi mandatory | Cursor outcome | Pi outcome | Cursor valid runs | Pi valid runs |', '| --- | --- | --- | --- | --- | --- | --- |');
for (const scenario of corpus.scenarios) {
  const of = (host) => rows.filter((row) => row.scenarioId === scenario.id && row.host === host);
  out.push(`| ${scenario.id} | ${pct(of('cursor'), 'mandatoryPass')} | ${pct(of('pi'), 'mandatoryPass')} | ${pct(of('cursor'), 'outcomePass')} | ${pct(of('pi'), 'outcomePass')} | ${pct(of('cursor'), 'valid')} | ${pct(of('pi'), 'valid')} |`);
}
out.push('', '| Attempt | Host | Check | Class | Status | Detail |', '| --- | --- | --- | --- | --- | --- |');
for (const row of rows) {
  if (row.missing) { out.push(`| ${row.attempt} | ${row.host} | (attempt missing) | | FAIL | |`); continue; }
  for (const [kind, list] of [['mandatory', row.mandatory], ['outcome', row.outcome]]) {
    for (const check of list) {
      if (check.status === 'PASS') continue;
      out.push(`| ${row.attempt} | ${row.host} | ${check.id} | ${kind} | ${check.status} | ${JSON.stringify(check.detail).replace(/\|/g, '\\|').slice(0, 260)} |`);
    }
  }
}
writeFileSync(join(opts.runs, 'score-tables.md'), `${out.join('\n')}\n`);
console.log(out.slice(0, corpus.scenarios.length + 2).join('\n'));
