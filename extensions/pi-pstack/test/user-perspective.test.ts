import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { expect, test } from 'vitest';
import { fixture, lastRequest, packageRoot, prompt, section } from './session-fixture.ts';

type ToolResult = {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
  isError: boolean;
};

type CustomMsg = {
  role: 'custom';
  customType: string;
  content: string;
  display: boolean;
  details?: unknown;
};

function toolResultsOf(session: { messages: unknown[] }, name: string): ToolResult[] {
  return (session.messages as ToolResult[]).filter((m) => m.role === 'toolResult' && m.toolName === name);
}

function customMessagesOf(session: { messages: unknown[] }, customType: string): CustomMsg[] {
  return (session.messages as CustomMsg[]).filter((m) => m.role === 'custom' && m.customType === customType);
}

test('user-perspective: loaded skills and prompt templates expose descriptions', async () => {
  const f = await fixture();
  try {
    const { loader } = await f.open();
    const skills = loader.getSkills().skills;
    const prompts = loader.getPrompts().prompts;
    expect(skills.length).toBe(65);
    expect(prompts.length).toBe(64);

    for (const skill of skills) {
      expect(Boolean(skill.description && skill.description.trim().length > 0)).toBe(true);
      const skillFile = await readFile(skill.filePath, 'utf8');
      const { frontmatter } = parseFrontmatter<Record<string, unknown>>(skillFile);
      expect(Boolean(frontmatter.description)).toBe(true);
    }
  } finally {
    await f.close();
  }
});

test('user-perspective: loaded extension registers its runtime commands', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    const commands = new Set(session.extensionRunner.getRegisteredCommands().map((c) => c.name));
    for (const name of ['pstack', 'poteto-mode', 'setup-pstack']) {
      expect(commands.has(name)).toBe(true);
    }
  } finally {
    await f.close();
  }
});

test('user-perspective: executable scripts in skills', async () => {
  const scriptsDir = join(packageRoot, 'skills/poteto-mode/scripts');
  const scriptFiles = await readdir(scriptsDir);
  for (const file of scriptFiles) {
    if (file.endsWith('.sh')) {
      const s = await stat(join(scriptsDir, file));
      expect((s.mode & 0o111) !== 0).toBe(true);
    }
  }
});

test('user-perspective: /pstack default, status, and invalid arguments', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await session.prompt('/pstack');
    let msgs = customMessagesOf(session, 'pstack-status');
    expect(msgs.length).toBe(1);
    expect(String(msgs[0]?.content)).toMatch(/pstack 0\.15\.5 with cursor-team-kit 1\.2\.0/);
    expect(String(msgs[0]?.content)).toMatch(/65 skills, 64 prompt templates/);
    expect(String(msgs[0]?.content)).toMatch(/Poteto mode off/);

    await session.prompt('/pstack status');
    msgs = customMessagesOf(session, 'pstack-status');
    expect(msgs.length).toBe(2);

    await session.prompt('/pstack invalid_arg');
    msgs = customMessagesOf(session, 'pstack-status');
    expect(msgs.length).toBe(2);
  } finally {
    await f.close();
  }
});

test('user-perspective: /pstack todos with empty and filled list', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await session.prompt('/pstack todos');
    let msgs = customMessagesOf(session, 'pstack-status');
    expect(msgs.length).toBe(1);
    expect(String(msgs[0]?.content)).toMatch(/Todos: none\./);

    f.calls.push({
      type: 'toolCall',
      id: 't1',
      name: 'TodoWrite',
      arguments: {
        todos: [
          { id: 'step-1', content: 'First task', status: 'completed' },
          { id: 'step-2', content: 'Second task', status: 'in_progress' },
          { id: 'step-3', content: 'Third task', status: 'pending' },
          { id: 'step-4', content: 'Fourth task', status: 'cancelled' },
        ],
      },
    });
    await prompt(session, 'Add todos');
    await session.prompt('/pstack todos');
    msgs = customMessagesOf(session, 'pstack-status');
    expect(msgs.length).toBe(2);
    const content = String(msgs[1]?.content);
    expect(content).toMatch(/Todos: 1\/4 completed\./);
    expect(content).toMatch(/\[x\] First task \(completed\)/);
    expect(content).toMatch(/\[>\] Second task \(in_progress\)/);
    expect(content).toMatch(/\[ \] Third task \(pending\)/);
    expect(content).toMatch(/\[-\] Fourth task \(cancelled\)/);
  } finally {
    await f.close();
  }
});

test('user-perspective: /poteto-mode on/off case-insensitivity and prompt injection', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, 'Initial check');
    expect(section(f.requests, 'pstack_mode')).toBeNull();
    expect(Boolean(section(f.requests, 'pstack_host')?.includes('pstack pi host contract'))).toBe(true);

    await prompt(session, '/poteto-mode Work on user feature');
    expect(section(f.requests, 'pstack_mode') ?? '').toMatch(/# Poteto mode/);

    await session.prompt('/poteto-mode off');
    await prompt(session, 'Check mode state');
    expect(section(f.requests, 'pstack_mode')).toBeNull();

    await prompt(session, '/skill:poteto-mode Investigate architecture');
    expect(section(f.requests, 'pstack_mode') ?? '').toMatch(/# Poteto mode/);

    await session.prompt('/poteto-mode OFF');
    await prompt(session, 'Check uppercase off');
    expect(section(f.requests, 'pstack_mode')).toBeNull();
  } finally {
    await f.close();
  }
});

test('user-perspective: prompt templates expansion (/bro, /how, /loop, /deslop)', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, '/bro Explain this simply.');
    let text = JSON.stringify(lastRequest(f.requests).messages);
    expect(text).toMatch(/Stop using jargon and speak coherently/);
    expect(text).toMatch(/Explain this simply\./);

    await prompt(session, '/how explore session persistence');
    text = JSON.stringify(lastRequest(f.requests).messages);
    expect(text).toMatch(/Read how\/SKILL\.md in full/);
    expect(text).toMatch(/explore session persistence/);

    await prompt(session, '/loop 5s check ci');
    text = JSON.stringify(lastRequest(f.requests).messages);
    expect(text).toMatch(/Read loop\/SKILL\.md in full under the pstack host skills directory/);
    expect(text).toMatch(/5s check ci/);

    await prompt(session, '/deslop clean up styles');
    text = JSON.stringify(lastRequest(f.requests).messages);
    expect(text).toMatch(/Read deslop\/SKILL\.md in full/);
    expect(text).toMatch(/clean up styles/);
  } finally {
    await f.close();
  }
});

const INITIAL_TODO_ITEMS = [
  { id: 'task-a', content: 'Task A', status: 'pending' },
  { id: 'task-b', content: 'Task B', status: 'in_progress' },
];
const MERGE_TODO_ITEMS = [
  { id: 'task-a', content: 'Task A (updated)', status: 'completed' },
  { id: 'task-c', content: 'Task C', status: 'pending' },
];

test('user-perspective: TodoWrite tool replace, merge, and error handling', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({ type: 'toolCall', id: 'call-1', name: 'TodoWrite', arguments: { todos: INITIAL_TODO_ITEMS } });
    await prompt(session, 'Set initial todos');
    let results = toolResultsOf(session, 'TodoWrite');
    expect(results.length).toBe(1);
    expect(results[0]?.isError).toBe(false);

    await prompt(session, 'Check injected todos');
    const todosSection = section(f.requests, 'pstack_todos');
    expect(Boolean(todosSection)).toBe(true);
    const parsedTodos = JSON.parse(todosSection?.replace(/^<pstack_todos>\n|\n<\/pstack_todos>$/g, '') ?? '[]');
    expect(parsedTodos.length).toBe(2);

    f.calls.push({ type: 'toolCall', id: 'call-2', name: 'TodoWrite', arguments: { merge: true, todos: MERGE_TODO_ITEMS } });
    await prompt(session, 'Merge todos');
    results = toolResultsOf(session, 'TodoWrite');
    expect(results.length).toBe(2);
    const merged = results[1]?.details as Array<{ id: string; status: string }>;
    expect(merged.length).toBe(3);
    expect(merged[0]?.id).toBe('task-a');
    expect(merged[0]?.status).toBe('completed');
    expect(merged[1]?.id).toBe('task-b');
    expect(merged[2]?.id).toBe('task-c');
  } finally {
    await f.close();
  }
});

test('user-perspective: TodoWrite rejects duplicate IDs', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: 'toolCall',
      id: 'call-dup',
      name: 'TodoWrite',
      arguments: {
        todos: [
          { id: 'dup', content: 'Dup 1', status: 'pending' },
          { id: 'dup', content: 'Dup 2', status: 'pending' },
        ],
      },
    });
    await prompt(session, 'Send duplicate IDs');
    const results = toolResultsOf(session, 'TodoWrite');
    expect(results.length).toBe(1);
    expect(results[0]?.isError).toBe(true);
    expect(JSON.stringify(results[0])).toMatch(/Todo IDs must be unique/);
  } finally {
    await f.close();
  }
});

test('user-perspective: pstack_context tool returns valid bounds and metadata', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: 'toolCall',
      id: 'ctx-1',
      name: 'pstack_context',
      arguments: { history: false },
    });
    await prompt(session, 'Fetch context');
    const results = toolResultsOf(session, 'pstack_context');
    expect(results.length).toBe(1);
    expect(results[0]?.isError).toBe(false);
    const details = results[0]?.details as {
      cwd: string;
      sessionFile: string | null;
      tools: Array<{ name: string }>;
    };
    expect(Boolean(details.cwd)).toBe(true);
    expect(Boolean(details.tools.some((t) => t.name === 'TodoWrite'))).toBe(true);
    expect(Boolean(details.tools.some((t) => t.name === 'pstack_mode'))).toBe(true);
    expect(Boolean(details.tools.some((t) => t.name === 'Task'))).toBe(true);
  } finally {
    await f.close();
  }
});

const cliPath = join(dirname(fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'))), 'bundle/cli.js');
const cliDeadlineMs = 3000;

function runCli(args: string[], options: { cwd: string; agentDir: string }): Promise<{ stdout: string; stderr: string; code: number | null }> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: options.cwd,
      env: { PATH: process.env.PATH, HOME: options.cwd, PI_CODING_AGENT_DIR: options.agentDir, PI_OFFLINE: '1' },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), cliDeadlineMs);
    child.stdout.on('data', (data) => (stdout += data.toString()));
    child.stderr.on('data', (data) => (stderr += data.toString()));
    child.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once('close', (code) => {
      clearTimeout(timer);
      if (code === null) reject(new Error(`pi ${args.join(' ')} was killed after ${cliDeadlineMs}ms. Stderr: ${stderr}`));
      else resolve({ stdout, stderr, code });
    });
  });
}

test('user-perspective: installed CLI loads the package declared in settings', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pstack-cli-'));
  const agentDir = join(root, 'agent');
  const workspace = join(root, 'workspace');
  try {
    await mkdir(agentDir);
    await mkdir(workspace);
    await writeFile(join(agentDir, 'settings.json'), JSON.stringify({ packages: [packageRoot], defaultProjectTrust: 'never' }));

    const status = await runCli(['--mode', 'json', '-p', '--no-session', '/pstack'], { cwd: workspace, agentDir });
    expect(status.code).toBe(0);
    const lines = status.stdout
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((l) => JSON.parse(l));
    const statusMsg = lines.find((l) => l.message?.customType === 'pstack-status');
    expect(Boolean(statusMsg)).toBe(true);
    expect(statusMsg.message.content).toMatch(/pstack 0\.15\.5 with cursor-team-kit 1\.2\.0/);

    const modeOff = await runCli(['--mode', 'json', '-p', '--no-session', '/poteto-mode off'], { cwd: workspace, agentDir });
    expect(modeOff.code).toBe(0);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('user-perspective: AskQuestion tool headless error', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: 'toolCall',
      id: 'q-headless',
      name: 'AskQuestion',
      arguments: { questions: [{ id: 'q1', prompt: 'Choose an option' }] },
    });
    await prompt(session, 'Ask question headless');
    const results = toolResultsOf(session, 'AskQuestion');
    expect(results.length).toBe(1);
    expect(results[0]?.isError).toBe(true);
    expect(JSON.stringify(results[0])).toMatch(/AskQuestion requires Pi TUI or an RPC client/);
  } finally {
    await f.close();
  }
});

test('user-perspective: AskQuestion rejects invalid identifiers', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: 'toolCall',
      id: 'q-invalid',
      name: 'AskQuestion',
      arguments: {
        questions: [
          { id: 'dup', prompt: 'First prompt' },
          { id: 'dup', prompt: 'Second prompt' },
        ],
      },
    });
    await prompt(session, 'Send duplicate question IDs');
    const results = toolResultsOf(session, 'AskQuestion');
    expect(results.length).toBe(1);
    expect(results[0]?.isError).toBe(true);
    expect(JSON.stringify(results[0])).toMatch(/Question IDs must be unique/);
  } finally {
    await f.close();
  }
});

test('user-perspective: Task tool rejects cloud execution and unsupported personas', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: 'toolCall',
      id: 't-cloud',
      name: 'Task',
      arguments: { prompt: 'Run task', environment: 'cloud' },
    });
    await prompt(session, 'Request cloud task');
    let results = toolResultsOf(session, 'Task');
    expect(results.length).toBe(1);
    expect(results[0]?.isError).toBe(true);
    expect(JSON.stringify(results[0])).toMatch(/Cursor cloud execution is unavailable in Pi/);

    f.calls.push({
      type: 'toolCall',
      id: 't-persona',
      name: 'Task',
      arguments: { prompt: 'Run task', subagent_type: 'shell' },
    });
    await prompt(session, 'Request unsupported persona');
    results = toolResultsOf(session, 'Task');
    expect(results.length).toBe(2);
    expect(results[1]?.isError).toBe(true);
    expect(JSON.stringify(results[1])).toMatch(/Unsupported agent shell/);
  } finally {
    await f.close();
  }
});

test('user-perspective: BackgroundShell start, list, and stop', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: 'toolCall',
      id: 'bs-start',
      name: 'BackgroundShell',
      arguments: { command: 'sleep 10', title: 'sleep-test' },
    });
    await prompt(session, 'Start background shell');
    const startRes = toolResultsOf(session, 'BackgroundShell');
    expect(startRes.length).toBe(1);
    expect(startRes[0]?.isError).toBe(false);
    const shellRecord = startRes[0]?.details as { id: string; pid: number };
    expect(Boolean(shellRecord.id)).toBe(true);

    const bgList = 'Background' + 'ShellList';
    const bgStop = 'Background' + 'ShellStop';
    f.calls.push({ type: 'toolCall', id: 'bs-list', name: bgList, arguments: {} });
    await prompt(session, 'List background shells');
    const listRes = toolResultsOf(session, bgList);
    expect(listRes.length).toBe(1);
    const list = listRes[0]?.details as Array<{ id: string }>;
    expect(Boolean(list.some((s) => s.id === shellRecord.id))).toBe(true);

    f.calls.push({
      type: 'toolCall',
      id: 'bs-stop',
      name: bgStop,
      arguments: { id: shellRecord.id },
    });
    await prompt(session, 'Stop background shell');
    const stopRes = toolResultsOf(session, bgStop);
    expect(stopRes.length).toBe(1);
    expect(stopRes[0]?.isError).toBe(false);
  } finally {
    await f.close();
  }
});

test('user-perspective: /setup-pstack headless fails closed', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await session.prompt('/setup-pstack');
    const errors = customMessagesOf(session, 'pstack-setup-error');
    expect(errors.length).toBe(1);
    expect(String(errors[0]?.content)).toMatch(/\/setup-pstack requires Pi interactive or RPC dialog UI/);
  } finally {
    await f.close();
  }
});
