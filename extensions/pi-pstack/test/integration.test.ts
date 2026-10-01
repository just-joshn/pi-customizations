import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

import { SessionManager } from '@earendil-works/pi-coding-agent';
import { expect, test, vi } from 'vitest';
import { DIALOG_TEST_QUESTIONS, fixture, INVALID_QUESTION_CASES, KIT_SKILL_NAMES, lastRequest, packageRoot, prompt, section, toolResults } from './session-fixture.ts';

test('integration fixture setup failure removes its directory', async () => {
  let directory = '';
  const failing = async (path: string) => {
    directory = dirname(path);
    throw new Error('mkdir failed');
  };
  await expect(fixture({ createDirectory: failing })).rejects.toThrow(/mkdir failed/);
  expect(directory).not.toBe('');
  await expect(access(directory)).rejects.toThrow(/ENOENT/);
});

test('integration fixture disposes every session and removes files after abort failure', async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    const second = await f.open();
    const disposed: string[] = [];
    const disposeSpies: { mockRestore: () => void }[] = [];
    for (const [name, session] of [
      ['first', first.session],
      ['second', second.session],
    ] as const) {
      const dispose = session.dispose.bind(session);
      disposeSpies.push(
        vi.spyOn(session, 'dispose').mockImplementation(() => {
          dispose();
          disposed.push(name);
        }),
      );
    }
    const abortSpy = vi.spyOn(first.session, 'abort').mockRejectedValue(new Error('abort failure'));
    await expect(f.close()).rejects.toThrow(/Fixture cleanup failed/);
    expect(disposed.toSorted()).toEqual(['first', 'second']);
    await expect(access(f.root)).rejects.toThrow(/ENOENT/);
    abortSpy.mockRestore();
    for (const s of disposeSpies) s.mockRestore();
  } finally {
    await f.close();
  }
});

test('official resource loader separates skills, prompt aliases, and runtime commands without Benny discovery', async () => {
  const f = await fixture();
  try {
    const { session, loader } = await f.open();
    const { skills, diagnostics } = loader.getSkills();
    expect(skills.length).toBe(68);
    expect(diagnostics).toEqual([]);
    const directories = async (path: string) => (await readdir(path, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name);
    const expected = [...(await directories(join(packageRoot, 'skills'))), ...(await directories(join(packageRoot, 'host/skills')))].sort();
    expect(skills.map((skill) => skill.name).sort()).toEqual(expected);
    for (const skill of skills) expect(skill.name).toMatch(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const commands = new Set(session.extensionRunner.getRegisteredCommands().map((command) => command.name));
    expect([...commands].sort()).toEqual(['goal', 'poteto-mode', 'pstack', 'setup-pstack']);
    const templates = loader.getPrompts().prompts;
    expect(templates.length).toBe(66);
    const aliases = new Set(templates.map((template) => template.name));
    for (const name of [...expected, 'bro']) expect(commands.has(name) || aliases.has(name)).toBe(true);
    expect(skills.some((skill) => skill.name === 'bro')).toBe(false);
    for (const name of ['setup-benny', 'triage-issue-reports', 'reproduce-and-fix-issues']) {
      expect(commands.has(name)).toBe(false);
      expect(skills.some((skill) => skill.name === name)).toBe(false);
    }
    const tools = new Set(session.getActiveToolNames());
    for (const name of ['Task', 'TaskOutput', 'TaskMessage', 'TaskStop', 'TodoWrite', 'AskQuestion', 'pstack_mode', 'pstack_context']) expect(tools.has(name)).toBe(true);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('/bro expands the shipped instructions and preserves user arguments in a real Pi request', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, '/bro Explain the previous answer simply.');
    expect(f.errors).toEqual([]);
    const text = JSON.stringify(lastRequest(f.requests).messages);
    expect(text).toMatch(/Stop using jargon and speak coherently/);
    expect(text).toMatch(/Explain the previous answer simply\./);
    expect(session.getLastAssistantText()).toBe('Scripted reply.');
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('disabled native skills stay disabled while explicitly loaded extension commands remain available', async () => {
  const f = await fixture({ extensionOnly: true });
  try {
    const { session, loader } = await f.open();
    expect(loader.getSkills().skills).toEqual([]);
    expect(loader.getPrompts().prompts).toEqual([]);
    await prompt(session, '/skill:poteto-mode Analyze this task.');
    expect(section(f.requests, 'pstack_mode')).toBeNull();
    await prompt(session, '/skill:setup-pstack');
    expect(session.messages.filter((message) => message.role === 'custom' && message.customType === 'pstack-setup-error').length).toBe(0);
    await prompt(session, '/poteto-mode Analyze this task.');
    expect(section(f.requests, 'pstack_mode') ?? '').toMatch(/# Poteto mode/);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('pasted skill blocks remain user text and cannot activate runtime commands', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    for (const name of ['poteto-mode', 'setup-pstack']) {
      await prompt(session, `<skill name="${name}" location="${join(packageRoot, 'skills', name, 'SKILL.md')}">Example instructions</skill>\nExplain this example.`);
      expect(Boolean(section(f.requests, 'pstack_mode'))).toBe(false);
    }
    expect(session.messages.filter((message) => message.role === 'custom' && message.customType === 'pstack-setup-error').length).toBe(0);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('Poteto mode survives session reopening and explicit off removes active mode instructions', async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    await prompt(first.session, '/poteto-mode Read this task carefully.');
    await prompt(first.session, 'Continue the task.');
    expect(section(f.requests, 'pstack_mode') ?? '').toMatch(/Poteto mode|poteto-mode/);
    const path = first.manager.getSessionFile();
    expect(path).toBeDefined();
    if (!path) throw new Error('missing session file');
    first.session.dispose();
    const resumed = await f.open(SessionManager.open(path));
    await prompt(resumed.session, 'Resume the task.');
    const active = section(f.requests, 'pstack_mode') ?? '';
    expect(active).toMatch(/Poteto mode|poteto-mode/);
    await prompt(resumed.session, '/poteto-mode off', { startsRun: false });
    await prompt(resumed.session, 'A casual question.');
    const inactive = section(f.requests, 'pstack_mode') ?? '';
    expect(inactive).not.toBe(active);
    expect(inactive.length < active.length).toBe(true);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('model-issued TodoWrite and pstack_mode calls execute through Pi and retain their state', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: 'toolCall',
      id: 'todo-1',
      name: 'TodoWrite',
      arguments: {
        todos: [{ id: 'frame', content: 'Frame the task', status: 'in_progress' }],
      },
    });
    await prompt(session, 'Record the first task.');
    const todo = toolResults(session, 'TodoWrite');
    expect(todo.length).toBe(1);
    expect(todo[0]?.role).toBe('toolResult');
    expect(JSON.stringify(todo[0])).toMatch(/Frame the task/);
    expect(Boolean(!JSON.stringify(todo[0]).includes('"isError":true'))).toBe(true);
    f.calls.push({ type: 'toolCall', id: 'mode-1', name: 'pstack_mode', arguments: { enabled: true } });
    await prompt(session, 'Enter Poteto mode.');
    expect(toolResults(session, 'pstack_mode').length).toBe(1);
    await prompt(session, 'Continue after mode activation.');
    expect(section(f.requests, 'pstack_mode') ?? '').toMatch(/Poteto mode|poteto-mode/);
    f.calls.push({ type: 'toolCall', id: 'context-1', name: 'pstack_context', arguments: {} });
    await prompt(session, 'Locate this session context.');
    const contexts = toolResults(session, 'pstack_context');
    expect(contexts.length).toBe(1);
    expect(Boolean(!JSON.stringify(contexts[0]).includes('"isError":true'))).toBe(true);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('native /skill:poteto-mode enters the same mode and /pstack reports status without inference', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, '/skill:poteto-mode Analyze this task.');
    expect(section(f.requests, 'pstack_mode') ?? '').toMatch(/# Poteto mode/);
    const callsBeforeStatus = f.requests.length;
    await session.prompt('/pstack status');
    expect(f.requests.length).toBe(callsBeforeStatus);
    const status = session.messages.findLast((message) => message.role === 'custom' && message.customType === 'pstack-status');
    expect(Boolean(status)).toBe(true);
    expect(JSON.stringify(status)).toMatch(/68 skills, 66 prompt templates/);
    expect(JSON.stringify(status)).toMatch(/cursor-team-kit 1.2.0/);
    expect(JSON.stringify(status)).toMatch(/Poteto mode on/);
    await prompt(session, '/poteto-mode off', { startsRun: false });
    await prompt(session, 'Proceed casually.');
    expect(section(f.requests, 'pstack_mode')).toBeNull();
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('TodoWrite merge preserves order and persisted progress after reopening', async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    f.calls.push({
      type: 'toolCall',
      id: 'todo-seed',
      name: 'TodoWrite',
      arguments: {
        todos: [
          { id: 'frame', content: 'Frame', status: 'in_progress' },
          { id: 'verify', content: 'Verify', status: 'pending' },
        ],
      },
    });
    await prompt(first.session, 'Record the exact phases.');
    f.calls.push({
      type: 'toolCall',
      id: 'todo-merge',
      name: 'TodoWrite',
      arguments: {
        merge: true,
        todos: [{ id: 'frame', content: 'Frame', status: 'completed' }],
      },
    });
    await prompt(first.session, 'Mark the first phase complete.');
    const path = first.manager.getSessionFile();
    expect(Boolean(path)).toBe(true);
    if (!path) throw new Error('missing session file');
    first.session.dispose();
    const resumed = await f.open(SessionManager.open(path));
    await prompt(resumed.session, 'What remains?');
    const todosSection = section(f.requests, 'pstack_todos');
    expect(Boolean(todosSection)).toBe(true);
    expect(JSON.parse(todosSection?.replace(/^<pstack_todos>\n|\n<\/pstack_todos>$/g, '') ?? '[]')).toEqual([
      { id: 'frame', content: 'Frame', status: 'completed' },
      { id: 'verify', content: 'Verify', status: 'pending' },
    ]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('branching before mode activation does not inherit state from the abandoned branch', async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    await prompt(first.session, 'Start an ordinary conversation.');
    const anchor = first.manager.getLeafId();
    expect(Boolean(anchor)).toBe(true);
    if (!anchor) throw new Error('missing anchor');
    await prompt(first.session, '/poteto-mode Analyze this branch.');
    expect(Boolean(section(f.requests, 'pstack_mode'))).toBe(true);
    first.session.dispose();
    first.manager.branch(anchor);
    const alternate = await f.open(first.manager);
    await prompt(alternate.session, 'Continue from before mode activation.');
    expect(section(f.requests, 'pstack_mode')).toBeNull();
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('native and alias setup fail closed without UI and never fall through to inference', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await session.prompt('/setup-pstack');
    await session.prompt('/skill:setup-pstack');
    expect(f.requests.length).toBe(0);
    const errors = session.messages.filter((message) => message.role === 'custom' && message.customType === 'pstack-setup-error');
    expect(errors.length).toBe(2);
    for (const message of errors) {
      if (message.role === 'custom') expect(String(message.content)).toMatch(/requires Pi interactive or RPC dialog UI/);
    }
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('setup command saves confirmed role choices and offers project verification only once', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    session.extensionRunner.setUIContext(
      {
        ...session.extensionRunner.createContext().ui,
        select: async (title) => (title.startsWith('pstack reasoning budget') ? 'small — medium reasoning' : title.startsWith('Accept model table') ? 'Accept as-is' : 'inherit-parent'),
        input: async () => 'inherit-parent, auto',
        confirm: async () => true,
      },
      'rpc',
    );
    await prompt(session, '/setup-pstack');
    const configuration = await readFile(join(f.root, 'agent/pstack/models.mdc'), 'utf8');
    expect(configuration).toMatch(/feature, refactoring: inherit-parent/);
    expect(configuration).toMatch(/arena runners: inherit-parent, auto/);
    const request = JSON.stringify(lastRequest(f.requests).messages);
    expect(request).toMatch(/want a project-local verification skill/);
    expect(Boolean(request.includes(join(packageRoot, 'skills/create-verification-skill/SKILL.md')))).toBe(true);
    const calls = f.requests.length;
    await session.prompt('/setup-pstack');
    expect(f.requests.length).toBe(calls);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('team-kit templates request skill reading and native skills expand complete instructions', async () => {
  const f = await fixture();
  try {
    const { session, loader } = await f.open();
    expect(loader.getSkills().skills.length).toBe(68);
    const names = new Set(loader.getSkills().skills.map((skill) => skill.name));
    for (const name of KIT_SKILL_NAMES) expect(names.has(name)).toBe(true);
    for (const name of ['pr-review-canvas', 'thermo-nuclear-code-quality-review']) {
      expect(loader.getSkills().skills.find((skill) => skill.name === name)?.disableModelInvocation).toBe(true);
    }
    for (const name of ['template.html', 'styles.css', 'renderer.js']) {
      expect(await readFile(join(packageRoot, 'skills/pr-review-canvas', name))).toEqual(await readFile(join(packageRoot, 'upstream-team-kit/skills/pr-review-canvas', name)));
    }
    for (const [name, evidence] of [
      ['deslop', 'Keep behavior unchanged unless fixing a clear bug.'],
      ['control-cli', 'Capture the current screen before interacting.'],
      ['control-ui', 'Do not rely on stale element references'],
    ]) {
      const skill = loader.getSkills().skills.find((skill) => skill.name === name);
      expect(Boolean(skill)).toBe(true);
      f.calls.push({ type: 'toolCall', id: `read-${name}`, name: 'read', arguments: { path: skill?.filePath ?? '' } });
      await prompt(session, `/${name} Inspect this workspace.`);
      const request = JSON.stringify(lastRequest(f.requests).messages);
      expect(request.includes(evidence)).toBe(true);
      expect(request).toMatch(/Inspect this workspace/);
      expect((section(f.requests, 'pstack_host') ?? '').includes(join(packageRoot, 'skills'))).toBe(true);
      await prompt(session, `/skill:${name} Preserve this request.`);
      const text = JSON.stringify(lastRequest(f.requests).messages);
      expect(text.includes(evidence)).toBe(true);
      expect(text).toMatch(/Preserve this request/);
    }
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('pstack tool snippets and guidance follow the active tool set', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, 'Work on this module.');
    const tools = section(f.requests, 'tools') ?? '';
    const bgList = 'Background' + 'ShellList';
    const bgStop = 'Background' + 'ShellStop';
    for (const name of ['Task', 'TaskOutput', 'TaskMessage', 'TaskStop', 'TodoWrite', 'AskQuestion', 'pstack_mode', 'pstack_context', 'BackgroundShell', bgList, bgStop]) {
      expect(tools).toMatch(new RegExp(`^- ${name}: `, 'm'));
    }
    expect(section(f.requests, 'rules') ?? '').toMatch(/environment cloud starts a detached Pi root in a configured separate VM/);
    expect(section(f.requests, 'rules') ?? '').toMatch(/AskQuestion works in interactive and RPC sessions/);
    expect(section(f.requests, 'pstack_host') ?? '').not.toMatch(/environment cloud starts a detached Pi root in a configured separate VM|TodoWrite keeps/);
    session.setActiveToolsByName(['read', 'bash']);
    await prompt(session, 'Continue with read and bash only.');
    expect(section(f.requests, 'tools') ?? '').not.toMatch(/^- (Task|TodoWrite|BackgroundShell): /m);
    expect(section(f.requests, 'rules') ?? '').not.toMatch(/environment cloud starts a detached Pi root in a configured separate VM|TodoWrite keeps|BackgroundShell/);
    expect(section(f.requests, 'pstack_host') ?? '').not.toMatch(/environment cloud starts a detached Pi root in a configured separate VM|TodoWrite keeps|BackgroundShell with notify_on_output/);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('team-kit rules stay archival to match observed Cursor plugin behavior', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, 'Work on this module.');
    const rules = section(f.requests, 'pstack_team_kit_rules') ?? '';
    expect(rules).toBe('');
    expect(section(f.requests, 'pstack_host') ?? '').toMatch(/pstack pi host contract/);
    expect(section(f.requests, 'pstack_host') ?? '').not.toMatch(/In switch statements/);
    expect(section(f.requests, 'pstack_mode')).toBeNull();
    await prompt(session, '/poteto-mode Enter the mode.');
    await prompt(session, '/poteto-mode off', { startsRun: false });
    await prompt(session, 'Continue this module.');
    expect(section(f.requests, 'pstack_team_kit_rules') ?? '').toBe(rules);
    expect(section(f.requests, 'pstack_mode')).toBeNull();
    const host = section(f.requests, 'pstack_host') ?? '';
    expect(Boolean(!host.includes('cursor-team-kit deslop/control-cli/control-ui, MCP connectors'))).toBe(true);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('AskQuestion preserves selected IDs, free text, and cancellation through Pi dialog APIs', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    const selections = ['First [one]', 'Enter a text answer', 'Done selecting', 'First [one]'];
    const inputs = ['Custom selection', 'Free answer', undefined];
    session.extensionRunner.setUIContext(
      {
        ...session.extensionRunner.createContext().ui,
        select: async (_title, options) => {
          const selected = selections.shift();
          if (selected !== undefined) expect(Boolean(options.includes(selected))).toBe(true);
          return selected;
        },
        input: async () => inputs.shift(),
      },
      'rpc',
    );
    f.calls.push({
      type: 'toolCall',
      id: 'questions',
      name: 'AskQuestion',
      arguments: { questions: DIALOG_TEST_QUESTIONS as never },
    });
    await prompt(session, 'Ask for these preferences.');
    const answer = toolResults(session, 'AskQuestion').at(-1);
    expect(Boolean(answer?.role === 'toolResult' && !answer.isError)).toBe(true);
    expect(answer?.details).toEqual([
      { id: 'multi', answers: ['one', 'Custom selection'], cancelled: false },
      { id: 'single', answers: ['one'], cancelled: false },
      { id: 'text', answers: ['Free answer'], cancelled: false },
      { id: 'cancel', answers: [], cancelled: true },
    ]);
    f.calls.push({ type: 'toolCall', id: 'cancel-choice', name: 'AskQuestion', arguments: { questions: [{ id: 'approval', prompt: 'Approve?', options: [{ id: 'yes', label: 'Yes' }] }] } });
    await prompt(session, 'Ask for approval.');
    const cancelled = toolResults(session, 'AskQuestion').at(-1);
    expect(Boolean(cancelled?.role === 'toolResult' && !cancelled.isError)).toBe(true);
    expect(cancelled?.details).toEqual([{ id: 'approval', answers: [], cancelled: true }]);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('AskQuestion without UI returns an error and never fabricates consent', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({ type: 'toolCall', id: 'no-ui', name: 'AskQuestion', arguments: { questions: [{ id: 'approval', prompt: 'Approve?' }] } });
    await prompt(session, 'Request approval.');
    const answer = toolResults(session, 'AskQuestion').at(-1);
    expect(Boolean(answer?.role === 'toolResult' && answer.isError)).toBe(true);
    expect(JSON.stringify(answer?.content)).toMatch(/requires Pi TUI or an RPC client/);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('invalid todo replacement leaves progress intact and mode tool can opt out', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: 'toolCall',
      id: 'valid-todo',
      name: 'TodoWrite',
      arguments: {
        todos: [{ id: 'first', content: 'Keep this progress', status: 'completed' }],
      },
    });
    await prompt(session, 'Save progress.');
    f.calls.push({
      type: 'toolCall',
      id: 'invalid-todo',
      name: 'TodoWrite',
      arguments: {
        todos: [
          { id: 'duplicate', content: 'Invalid', status: 'pending' },
          { id: 'duplicate', content: 'Invalid again', status: 'pending' },
        ],
      },
    });
    await prompt(session, 'Reject duplicate identifiers.');
    const failure = toolResults(session, 'TodoWrite').at(-1);
    expect(Boolean(failure?.role === 'toolResult' && failure.isError)).toBe(true);
    expect(JSON.stringify(failure?.content)).toMatch(/Todo IDs must be unique/);
    f.calls.push({ type: 'toolCall', id: 'opt-out', name: 'pstack_mode', arguments: { enabled: false } });
    await prompt(session, 'Leave the mode.');
    expect(section(f.requests, 'pstack_todos') ?? '').toMatch(/Keep this progress/);
    expect(section(f.requests, 'pstack_mode')).toBeNull();
    const mode = toolResults(session, 'pstack_mode').at(-1);
    expect(Boolean(mode?.role === 'toolResult' && !mode.isError)).toBe(true);
    expect(JSON.stringify(mode?.content)).toMatch(/Poteto mode is off/);
  } finally {
    await f.close();
  }
});

test('repeated context calls persist bounded nonrecursive evidence with transcript pointers', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    const evidence = 'Transcript evidence '.repeat(3000);
    await prompt(session, evidence);
    for (let index = 0; index < 100; index++) session.sessionManager.appendCustomEntry('context-fixture', { index });
    for (let index = 0; index < 12; index++) {
      f.calls.push({ type: 'toolCall', id: `context-${index}`, name: 'pstack_context', arguments: { history: true } });
      await prompt(session, 'Locate the evidence and workspace history.');
      const result = toolResults(session, 'pstack_context').at(-1);
      expect(Boolean(result?.role === 'toolResult' && !result.isError)).toBe(true);
      expect(Boolean(Buffer.byteLength(JSON.stringify(result)) < 128 * 1024)).toBe(true);
      const details = result?.details as { sessionFile: string; entries: object[] };
      expect(details.sessionFile).toBe(session.sessionFile);
      expect(Boolean(details.entries.every((entry) => !('message' in entry) && !('details' in entry)))).toBe(true);
      expect(Boolean(!JSON.stringify(result?.details).includes(evidence))).toBe(true);
    }
    const sessFile = session.sessionFile;
    if (!sessFile) throw new Error('missing sessionFile');
    const persisted = (await readFile(sessFile, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    const contexts = persisted.filter((entry) => entry.message?.toolName === 'pstack_context');
    expect(contexts.length).toBe(12);
    const sizes = contexts.map((entry) => Buffer.byteLength(JSON.stringify(entry)));
    expect(Boolean(sizes.every((size) => size < 128 * 1024))).toBe(true);
    expect(Boolean(contexts.at(-1).message.details.omitted.entries > 0)).toBe(true);
    expect(Boolean(persisted.some((entry) => entry.message?.role === 'user' && JSON.stringify(entry.message.content).includes(evidence)))).toBe(true);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('AskQuestion rejects ambiguous and blank identifiers before opening dialogs', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    let dialogs = 0;
    session.extensionRunner.setUIContext(
      {
        ...session.extensionRunner.createContext().ui,
        select: async () => {
          dialogs++;
          return undefined;
        },
        input: async () => {
          dialogs++;
          return undefined;
        },
      },
      'rpc',
    );
    for (const [index, questions] of INVALID_QUESTION_CASES.entries()) {
      f.calls.push({ type: 'toolCall', id: `invalid-question-${index}`, name: 'AskQuestion', arguments: questions === undefined ? {} : { questions } });
      await prompt(session, 'Validate the question before asking it.');
      const answer = toolResults(session, 'AskQuestion').at(-1);
      expect(Boolean(answer?.role === 'toolResult' && answer.isError)).toBe(true);
    }
    expect(dialogs).toBe(0);
  } finally {
    await f.close();
  }
});

test('context history explicitly labels best-effort discovery as incomplete', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({ type: 'toolCall', id: 'history-discovery', name: 'pstack_context', arguments: { history: true } });
    await prompt(session, 'Read workspace history');
    const result = toolResults(session, 'pstack_context').at(-1);
    expect(result?.role).toBe('toolResult');
    expect(result?.details).toMatchObject({ historyDiscovery: { mode: 'best-effort', completeness: 'unknown' } });
  } finally {
    await f.close();
  }
});

test('restoration ignores invalid todo snapshots and keeps the latest valid branch state', async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    const valid = { enabled: true, todos: [{ id: 'keep', content: 'Keep this task', status: 'completed' }] };
    first.manager.appendCustomEntry('pstack-state', valid);
    for (const invalid of [null, {}, { enabled: true, todos: [{ id: 'bad', content: 'Bad', status: 'unknown' }] }, { ...valid, todos: [valid.todos[0], valid.todos[0]] }]) {
      first.manager.appendCustomEntry('pstack-state', invalid);
    }
    const restored = await f.open(first.manager);
    await prompt(restored.session, 'Restore this branch.');
    const saved = section(f.requests, 'pstack_todos') ?? '';
    expect(JSON.parse(saved.replace(/^<pstack_todos>\n|\n<\/pstack_todos>$/g, ''))).toEqual(valid.todos);
    expect(section(f.requests, 'pstack_mode') ?? '').toMatch(/# Poteto mode/);
  } finally {
    await f.close();
  }
});

test('a Pi tool batch serializes question dialogs and retains both answers', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    let active = 0;
    let maximum = 0;
    const asked: string[] = [];
    let release = () => {};
    const answered = new Promise<void>((resolve) => {
      release = resolve;
    });
    session.extensionRunner.setUIContext(
      {
        ...session.extensionRunner.createContext().ui,
        input: async (title) => {
          active++;
          maximum = Math.max(maximum, active);
          asked.push(title);
          if (title === 'first') await answered;
          active--;
          return `Answer ${title}`;
        },
      },
      'rpc',
    );
    f.calls.push(['first', 'second'].map((id) => ({ type: 'toolCall', id, name: 'AskQuestion', arguments: { questions: [{ id, prompt: id }] } })));
    const batch = prompt(session, 'Ask both questions.');
    await vi.waitFor(() => expect(asked).toEqual(['first']));
    expect(maximum).toBe(1);
    release();
    await batch;
    expect(asked).toEqual(['first', 'second']);
    expect(maximum).toBe(1);
    expect(toolResults(session, 'AskQuestion').map((message) => (message.role === 'toolResult' ? message.details : undefined))).toEqual([
      [{ id: 'first', answers: ['Answer first'], cancelled: false }],
      [{ id: 'second', answers: ['Answer second'], cancelled: false }],
    ]);
  } finally {
    await f.close();
  }
});

test('large todo results retain full structured state and point to the durable transcript', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    const todos = [{ id: 'large', content: 'Task detail '.repeat(5000), status: 'pending' }];
    f.calls.push({ type: 'toolCall', id: 'large-todos', name: 'TodoWrite', arguments: { todos } });
    await prompt(session, 'Record the complete playbook.');
    const result = toolResults(session, 'TodoWrite').at(-1);
    expect(Boolean(result?.role === 'toolResult' && !result.isError)).toBe(true);
    const text = result?.content.find((block: { type: string; text?: string }) => block.type === 'text')?.text ?? '';
    expect(Boolean(text.length < 49000)).toBe(true);
    expect(text).toMatch(/Truncated\. Full current transcript:/);
    expect(Boolean(text.includes(session.sessionManager.getSessionFile() ?? 'missing transcript'))).toBe(true);
    expect(result?.details).toEqual(todos);
  } finally {
    await f.close();
  }
});

test('large question answers retain complete details when the session has no transcript file', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open(SessionManager.inMemory(f.cwd));
    const answer = 'Detailed answer '.repeat(4000);
    session.extensionRunner.setUIContext(
      {
        ...session.extensionRunner.createContext().ui,
        input: async () => answer,
      },
      'rpc',
    );
    f.calls.push({ type: 'toolCall', id: 'large-answer', name: 'AskQuestion', arguments: { questions: [{ id: 'scope', prompt: 'Describe the scope' }] } });
    await prompt(session, 'Ask for the complete scope.');
    const result = toolResults(session, 'AskQuestion').at(-1);
    expect(Boolean(result?.role === 'toolResult' && !result.isError)).toBe(true);
    const text = result?.content.find((block: { type: string; text?: string }) => block.type === 'text')?.text ?? '';
    expect(Boolean(text.length < 49000)).toBe(true);
    expect(text).toMatch(/Truncated\. Full current transcript: available in tool details/);
    expect(result?.details).toEqual([{ id: 'scope', answers: [answer], cancelled: false }]);
  } finally {
    await f.close();
  }
});

test('off is case-insensitive for /poteto-mode and /skill:poteto-mode and spends no inference', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    for (const off of ['/poteto-mode OFF', '/skill:poteto-mode Off']) {
      await prompt(session, '/poteto-mode Analyze this task.');
      const before = f.requests.length;
      await session.prompt(off);
      expect(f.requests.length).toBe(before);
      await prompt(session, 'Proceed casually.');
      expect(section(f.requests, 'pstack_mode')).toBeNull();
    }
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('AskQuestion multi-select titles show the choices made so far', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    const selections = ['Red [red]', 'Enter a text answer', 'Done selecting'];
    const titles: string[] = [];
    session.extensionRunner.setUIContext(
      {
        ...session.extensionRunner.createContext().ui,
        select: async (title) => {
          titles.push(title);
          return selections.shift();
        },
        input: async () => 'Teal',
      },
      'rpc',
    );
    f.calls.push({
      type: 'toolCall',
      id: 'colors',
      name: 'AskQuestion',
      arguments: {
        questions: [
          {
            id: 'colors',
            prompt: 'Choose colors',
            allow_multiple: true,
            options: [
              { id: 'red', label: 'Red' },
              { id: 'blue', label: 'Blue' },
            ],
          },
        ],
      },
    });
    await prompt(session, 'Ask for colors.');
    const answer = toolResults(session, 'AskQuestion').at(-1);
    expect(Boolean(answer?.role === 'toolResult' && !answer.isError)).toBe(true);
    expect(answer?.details).toEqual([{ id: 'colors', answers: ['red', 'Teal'], cancelled: false }]);
    expect(titles).toEqual(['Choose colors', 'Choose colors (selected: Red)', 'Choose colors (selected: Red, Teal)']);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});

test('/pstack status is shown in the transcript but never sent to the model', async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await session.prompt('/pstack status');
    await prompt(session, 'Restate your last message.');
    expect(Boolean(session.messages.some((message) => message.role === 'custom' && message.customType === 'pstack-status'))).toBe(true);
    expect(JSON.stringify(lastRequest(f.requests).messages)).not.toMatch(/Compatibility report/);
    expect(f.errors).toEqual([]);
  } finally {
    await f.close();
  }
});
