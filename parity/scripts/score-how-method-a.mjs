#!/usr/bin/env node
// Method A scorer for HOW-WORKFLOW-EXPLAINER-STEP.
// Pass when the parent turn starts an explainer Task / "Running subagent"
// before the final answer. See parity/reviews/how-explainer-disposition.md.
//
// Usage: node parity/scripts/score-how-method-a.mjs <attemptDir> [--session <path>]
// Exit: 0 pass, 1 fail, 2 bad input
import { access, readdir, readFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

import { outputBytes, readAttempt } from '../recorder/index.mjs';

const SESSION_CANDIDATES = ['session.jsonl', 'transcript.txt', 'transcript.jsonl', 'session.txt'];
const METHOD_A_SESSION_POINTER = 'method-a-session.json';

const CURSOR_TASK_TOOL =
  /(?:cursor · Task|\bCalled Task\b|\bUsing Task\b|MCP tools[^\n]{0,40}\bTask\b)/;
const PI_TASK_TOOLCALL = /"type"\s*:\s*"toolCall"[\s\S]{0,200}?"name"\s*:\s*"task"/;
const PI_TASK_TOOLNAME = /"toolName"\s*:\s*"task"/;
const PI_SUBAGENT_STARTED = /"type"\s*:\s*"subagent\.started"/;
const TASK_TOOL = new RegExp(
  `(?:${CURSOR_TASK_TOOL.source}|${PI_TASK_TOOLCALL.source}|${PI_TASK_TOOLNAME.source}|${PI_SUBAGENT_STARTED.source})`,
);

const stripAnsi = (text) =>
  text
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b./g, '');

function findSnippet(text, pattern, radius = 80) {
  const match = text.match(pattern);
  if (!match || match.index === undefined) return null;
  const start = Math.max(0, match.index - radius);
  const end = Math.min(text.length, match.index + match[0].length + radius);
  return text.slice(start, end).replace(/\s+/g, ' ').trim();
}

function cwdToSessionSlug(cwd) {
  if (typeof cwd !== 'string' || cwd.length === 0) return null;
  return `--${cwd.replace(/^\//, '').replaceAll('/', '-')}--`;
}

function parseSessionTimestamp(name) {
  const match = basename(name).match(/^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z)_/);
  if (!match) return null;
  const iso = match[1].replace(/T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/, 'T$1:$2:$3.$4Z');
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : null;
}

async function readOptionalText(path) {
  try {
    await access(path);
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

async function attemptEventWindow(attemptDir) {
  const text = await readOptionalText(join(attemptDir, 'events.jsonl'));
  if (!text) return null;
  let first = null;
  let last = null;
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    const ms = Date.parse(event.utc ?? '');
    if (!Number.isFinite(ms)) continue;
    if (first === null || ms < first) first = ms;
    if (last === null || ms > last) last = ms;
  }
  if (first === null || last === null) return null;
  return { first, last };
}

async function resolvePointerSession(attemptDir) {
  const raw = await readOptionalText(join(attemptDir, METHOD_A_SESSION_POINTER));
  if (!raw) return null;
  try {
    const pointer = JSON.parse(raw);
    if (typeof pointer.session === 'string' && pointer.session.length > 0) {
      return pointer.session;
    }
  } catch {
    // ignore malformed pointer
  }
  return null;
}

async function discoverPiSession(attemptDir, agentDir) {
  if (typeof agentDir !== 'string' || agentDir.length === 0) return null;
  let attempt;
  try {
    attempt = await readAttempt(attemptDir);
  } catch {
    return null;
  }
  const cwd = attempt.identity?.launch?.cwd;
  const slug = cwdToSessionSlug(cwd);
  if (!slug) return null;
  const sessionsDir = join(agentDir, 'sessions', slug);
  let names;
  try {
    names = await readdir(sessionsDir);
  } catch {
    return null;
  }
  const window = await attemptEventWindow(attemptDir);
  if (!window) return null;
  const padMs = 5_000;
  const matches = names
    .filter((name) => name.endsWith('.jsonl'))
    .map((name) => ({ name, startMs: parseSessionTimestamp(name) }))
    .filter((entry) => entry.startMs !== null)
    .filter((entry) => entry.startMs >= window.first - padMs && entry.startMs <= window.last + padMs)
    .sort((a, b) => Math.abs(a.startMs - window.first) - Math.abs(b.startMs - window.first));
  if (matches.length === 0) return null;
  return join(sessionsDir, matches[0].name);
}

async function collectSessionText(attemptDir, { sessionPath = null, agentDir = process.env.PI_CODING_AGENT_DIR } = {}) {
  const chunks = [];
  const resolved =
    sessionPath ??
    (await resolvePointerSession(attemptDir)) ??
    (await discoverPiSession(attemptDir, agentDir));
  if (resolved) {
    const text = await readOptionalText(resolved);
    if (text) chunks.push(text);
  }
  for (const name of SESSION_CANDIDATES) {
    const text = await readOptionalText(join(attemptDir, name));
    if (text) chunks.push(text);
  }
  return { text: chunks.join('\n'), sessionPath: resolved };
}

export function scorePlaintext(plain, { attemptDir = null, sessionPath = null } = {}) {
  const runningSubagent = /Running subagent/.test(plain);
  const taskTool = TASK_TOOL.test(plain);
  const readonlyExplainer = /\bREADONLY\b/.test(plain) || /readonly:\s*true/.test(plain);
  const gateMatch = plain.match(
    /(?:Blocked by|block reason|permission denied|rejected by (?:the )?gate)[^\n.]{0,160}/i,
  );
  const gateBlockReason = gateMatch ? gateMatch[0].replace(/\s+/g, ' ').trim() : null;

  const pass = runningSubagent || taskTool;
  return {
    schema: 1,
    scorer: 'how-method-a-v1',
    attemptDir,
    sessionPath,
    pass,
    signals: {
      runningSubagent: {
        found: runningSubagent,
        snippet: findSnippet(plain, /Running subagent/),
      },
      taskTool: {
        found: taskTool,
        snippet: findSnippet(plain, TASK_TOOL),
      },
      readonlyExplainer: {
        found: readonlyExplainer,
        snippet: findSnippet(plain, /\bREADONLY\b|readonly:\s*true/),
      },
      gateBlockReason: {
        found: gateBlockReason !== null,
        reason: gateBlockReason,
      },
    },
  };
}

export async function scoreAttemptDir(attemptDir, { sessionPath = null, agentDir = process.env.PI_CODING_AGENT_DIR } = {}) {
  if (typeof attemptDir !== 'string' || attemptDir.length === 0) {
    const error = new Error(
      'usage: node parity/scripts/score-how-method-a.mjs <attemptDir> [--session <path>]',
    );
    error.code = 'BAD_INPUT';
    throw error;
  }

  let attempt;
  try {
    attempt = await readAttempt(attemptDir);
  } catch (error) {
    const wrapped = new Error(`bad attempt dir: ${attemptDir}: ${error.message}`);
    wrapped.code = 'BAD_INPUT';
    throw wrapped;
  }

  if (!attempt.identity || !Array.isArray(attempt.events)) {
    const error = new Error(`bad attempt dir: ${attemptDir}: missing identity or events`);
    error.code = 'BAD_INPUT';
    throw error;
  }

  const ptyText = stripAnsi(outputBytes(attempt.events).toString('utf8'));
  const { text: sessionText, sessionPath: resolvedSession } = await collectSessionText(attemptDir, {
    sessionPath,
    agentDir,
  });
  const plain = sessionText ? `${ptyText}\n${sessionText}` : ptyText;
  return scorePlaintext(plain, { attemptDir, sessionPath: resolvedSession });
}

function parseCliArgs(args) {
  if (!Array.isArray(args) || args.length === 0) {
    return { error: 'usage: node parity/scripts/score-how-method-a.mjs <attemptDir> [--session <path>]' };
  }
  let attemptDir = null;
  let sessionPath = null;
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === '--session') {
      const value = args[i + 1];
      if (typeof value !== 'string' || value.length === 0 || value.startsWith('-')) {
        return { error: 'usage: node parity/scripts/score-how-method-a.mjs <attemptDir> [--session <path>]' };
      }
      sessionPath = value;
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      return { error: 'usage: node parity/scripts/score-how-method-a.mjs <attemptDir> [--session <path>]' };
    }
    if (attemptDir !== null) {
      return { error: 'usage: node parity/scripts/score-how-method-a.mjs <attemptDir> [--session <path>]' };
    }
    attemptDir = arg;
  }
  if (attemptDir === null) {
    return { error: 'usage: node parity/scripts/score-how-method-a.mjs <attemptDir> [--session <path>]' };
  }
  return { attemptDir, sessionPath };
}

export async function runCli(args) {
  const parsed = parseCliArgs(args);
  if (parsed.error) {
    return {
      exitCode: 2,
      report: {
        schema: 1,
        scorer: 'how-method-a-v1',
        pass: false,
        error: parsed.error,
      },
    };
  }
  try {
    const report = await scoreAttemptDir(parsed.attemptDir, { sessionPath: parsed.sessionPath });
    return { exitCode: report.pass ? 0 : 1, report };
  } catch (error) {
    if (error.code === 'BAD_INPUT') {
      return {
        exitCode: 2,
        report: {
          schema: 1,
          scorer: 'how-method-a-v1',
          pass: false,
          error: error.message,
        },
      };
    }
    throw error;
  }
}

if (import.meta.main) {
  const result = await runCli(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result.report, null, 2)}\n`);
  process.exitCode = result.exitCode;
}
