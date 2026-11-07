import assert from 'node:assert/strict';
import { test } from 'node:test';
import { declareAttempts, evaluateAutomatic, parseHostEvents, sha256 } from './run-corpus.mjs';

function corpus() {
  return {
    schemaVersion: 1,
    protocol: { repeats: 3 },
    scenarios: Array.from({ length: 5 }, (_, index) => ({ id: `CASE-${index}`, messages: ['hello'], automatic: {}, assertions: ['Review meaning independently'] })),
  };
}

function piTurn(text = 'line', sessionId = 'session-one') {
  const raw = [
    { type: 'session', id: sessionId },
    { type: 'message_end', message: { role: 'assistant', provider: 'openai', model: 'gpt-5.6-sol', api: 'openai-responses', thinkingLevel: 'medium', stopReason: 'stop', content: [{ type: 'text', text }] } },
    { type: 'agent_settled', aborted: false },
  ].map((event) => JSON.stringify(event)).join('\n');
  return { exit: { code: 0 }, parsed: parseHostEvents('pi', raw) };
}

const snapshot = { files: [{ path: 'README.md', sha256: 'fixture' }], head: 'initial-commit', tree: 'initial-tree', status: '', diff: '' };

test('hashes the exact UTF-8 bytes without adding a newline', () => {
  assert.equal(sha256('hello'), '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  assert.notEqual(sha256('hello'), sha256('hello\n'));
  assert.equal(sha256('café'), sha256(Buffer.from([99, 97, 102, 195, 169])));
});

test('declares every repeat before execution and alternates the first host', () => {
  const attempts = declareAttempts(corpus());
  assert.equal(attempts.length, 15);
  assert.deepEqual(attempts.map((attempt) => attempt.order[0]), ['cursor', 'pi', 'cursor', 'pi', 'cursor', 'pi', 'cursor', 'pi', 'cursor', 'pi', 'cursor', 'pi', 'cursor', 'pi', 'cursor']);
  assert.deepEqual(attempts.filter((attempt) => attempt.scenarioId === 'CASE-4').map((attempt) => attempt.repeat), [1, 2, 3]);
  assert.deepEqual(attempts[0].messages, [{ turn: 1, utf8Bytes: 5, sha256: '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824' }]);
});

test('rejects a corpus with fewer repeats or unsupported automatic predicates', () => {
  const fewer = corpus();
  fewer.protocol.repeats = 1;
  assert.throws(() => declareAttempts(fewer), /five scenarios and three repeats/);
  const unsupported = corpus();
  unsupported.scenarios[0].automatic = { semanticPass: true };
  assert.throws(() => declareAttempts(unsupported), /Unknown automatic predicate/);
});

test('does not split JSON records on Unicode line separators inside text', () => {
  const turn = piTurn('first\u2028second\u2029third');
  assert.equal(turn.parsed.finalText, 'first\u2028second\u2029third');
  assert.deepEqual(turn.parsed.malformed, []);
  assert.equal(turn.parsed.completed, true);
});

test('detects a model error embedded in Pi events despite process exit zero', () => {
  const parsed = parseHostEvents('pi', [
    { type: 'message_end', message: { role: 'assistant', model: 'gpt-5.6-sol', provider: 'openai', thinkingLevel: 'medium', stopReason: 'error', errorMessage: 'model_not_found', content: [] } },
    { type: 'agent_settled', aborted: false },
  ].map((event) => JSON.stringify(event)).join('\n'));
  const result = evaluateAutomatic({}, [{ exit: { code: 0 }, parsed }], snapshot, snapshot);
  assert.deepEqual(parsed.errors, ['model_not_found']);
  assert.equal(result.checks.find((check) => check.id === 'turn-1-errors').status, 'FAIL');
  assert.equal(result.status, 'FAIL');
});

test('dispatches model validation by the parser host instead of a display-name branch', () => {
  const parsed = parseHostEvents('pi', [
    { type: 'session', id: 'fixture' },
    { type: 'message_end', message: { role: 'assistant', provider: 'not-openai', model: 'GPT-5.6 Sol 272K Medium', thinkingLevel: 'high', content: 'line' } },
    { type: 'agent_settled', aborted: false },
  ].map((event) => JSON.stringify(event)).join('\n'));
  const positive = evaluateAutomatic({}, [piTurn()], snapshot, snapshot);
  const negative = evaluateAutomatic({}, [{ exit: { code: 0 }, parsed }], snapshot, snapshot);
  assert.equal(positive.checks.find((check) => check.id === 'turn-1-model-reported').status, 'PASS');
  assert.equal(parsed.host, 'pi');
  assert.equal(negative.checks.find((check) => check.id === 'turn-1-model-reported').status, 'FAIL');
});

test('does not assign current meaning to untagged historical parsed records', () => {
  const turn = piTurn();
  delete turn.parsed.host;
  const result = evaluateAutomatic({}, [turn], snapshot, snapshot);
  assert.equal(result.checks.find((check) => check.id === 'turn-1-model-reported').status, 'FAIL');
  assert.throws(() => parseHostEvents('unknown', ''), /Unknown host/);
});

test('retains malformed output as a protocol failure', () => {
  const turn = piTurn();
  turn.parsed = parseHostEvents('pi', '{"type":"session","id":"one"}\nnot-json\n');
  const result = evaluateAutomatic({}, [turn], snapshot, snapshot);
  assert.deepEqual(turn.parsed.malformed, [{ line: 2, text: 'not-json' }]);
  assert.equal(result.status, 'FAIL');
});

test('records Cursor model identity, session and the authoritative result', () => {
  const parsed = parseHostEvents('cursor', [
    { type: 'system', subtype: 'init', session_id: 'cursor-one', model: 'GPT-5.6 Sol 272K Medium', permissionMode: 'default' },
    { type: 'assistant', message: { content: [{ type: 'text', text: 'partial' }] } },
    { type: 'result', subtype: 'success', is_error: false, result: 'full result' },
  ].map((event) => JSON.stringify(event)).join('\n'));
  assert.equal(parsed.host, 'cursor');
  assert.equal(parsed.sessionId, 'cursor-one');
  assert.equal(parsed.finalText, 'full result');
  assert.deepEqual(parsed.identities, [{ model: 'GPT-5.6 Sol 272K Medium', contextReported: '272K', permissionMode: 'default' }]);
  assert.equal(parsed.completed, true);
});

test('recognizes forbidden Cursor native and dynamic tool calls', () => {
  const parsed = parseHostEvents('cursor', [
    { type: 'tool_call', subtype: 'started', call_id: 'one', tool_call: { strReplaceToolCall: { args: { path: 'README.md' } } } },
    { type: 'tool_call', subtype: 'started', call_id: 'two', tool_call: { callMcpToolToolCall: { args: { toolName: 'cursor.Task' } } } },
  ].map((event) => JSON.stringify(event)).join('\n'));
  assert.deepEqual(parsed.tools.map((tool) => tool.name), ['edit', 'Task']);
  const direct = parseHostEvents('cursor', JSON.stringify({ type: 'tool_call', subtype: 'started', call_id: 'three', tool_call: { taskToolCall: { args: { prompt: 'Do work' } } } }));
  const turn = piTurn();
  turn.parsed.tools = [...parsed.tools, ...direct.tools];
  const result = evaluateAutomatic({ forbiddenTools: ['Task', 'edit'] }, [turn], snapshot, snapshot);
  assert.equal(result.checks.find((check) => check.id === 'forbidden-tools').status, 'FAIL');
});

test('keeps an unknown tool policy unverified rather than silently passing it', () => {
  const turn = piTurn();
  turn.parsed.tools.push({ name: 'newUnmappedTool', rawName: 'newUnmappedToolCall' });
  const result = evaluateAutomatic({ forbiddenTools: ['Task'] }, [turn], snapshot, snapshot);
  assert.equal(result.status, 'UNVERIFIED');
  assert.equal(result.checks.find((check) => check.id === 'tool-policy-observable').status, 'UNVERIFIED');
});

test('never turns text presence into a semantic verdict', () => {
  const result = evaluateAutomatic({ requiredText: ['line'], unchangedTree: true }, [piTurn()], snapshot, snapshot);
  assert.equal(result.status, 'PASS');
  assert.equal(result.scope, 'DETERMINISTIC_PRECHECKS_ONLY');
  assert.equal(result.semanticStatus, 'PENDING_INDEPENDENT_REVIEW');
  assert.equal(result.checks.find((check) => check.id === 'text-presence-only:line').detail, 'String presence is not a semantic verdict');
});

test('requires the second turn to continue the original session', () => {
  const result = evaluateAutomatic({}, [piTurn('original', 'one'), piTurn('simpler', 'two')], snapshot, snapshot);
  assert.equal(result.checks.find((check) => check.id === 'same-session-continuation').status, 'FAIL');
  assert.equal(result.status, 'FAIL');
});

test('detects edits, commits and exact-text differences', () => {
  const changed = { ...snapshot, files: [{ path: 'README.md', sha256: 'changed' }], head: 'other-commit' };
  const result = evaluateAutomatic({ unchangedTree: true, exactFinalText: 'line' }, [piTurn('line\n')], snapshot, changed);
  assert.equal(result.checks.find((check) => check.id === 'unchanged-tree').status, 'FAIL');
  assert.equal(result.checks.find((check) => check.id === 'exact-final-text').status, 'FAIL');
});
