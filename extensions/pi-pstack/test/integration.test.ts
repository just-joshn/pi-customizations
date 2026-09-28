import assert from "node:assert/strict";
import fs, { readFile, readdir } from "node:fs/promises";
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from "node:path";
import test from "node:test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { fixture, lastRequest, packageRoot, prompt, section, toolResults } from "./session-fixture.ts";

test('integration fixture setup failure removes its directory', async t => {
  let directory = '';
  t.mock.method(fs, 'mkdir', async (path: unknown) => {
    directory = dirname(String(path));
    throw new Error('mkdir failed');
  });
  syncBuiltinESMExports();
  try {
    await assert.rejects(fixture(), /mkdir failed/);
    assert.ok(directory);
    await assert.rejects(fs.access(directory), /ENOENT/);
  } finally { t.mock.restoreAll(); syncBuiltinESMExports(); }
});

test('integration fixture disposes every session and removes files after abort failure', async t => {
  const f = await fixture();
  try {
    const first = await f.open();
    const second = await f.open();
    const disposed: string[] = [];
    for (const [name, session] of [['first', first.session], ['second', second.session]] as const) {
      const dispose = session.dispose.bind(session);
      t.mock.method(session, 'dispose', () => { dispose(); disposed.push(name); });
    }
    t.mock.method(first.session, 'abort', async () => { throw new Error('abort failure'); });
    await assert.rejects(f.close(), /Fixture cleanup failed/);
    assert.deepEqual(disposed.toSorted(), ['first', 'second']);
    await assert.rejects(fs.access(f.root), /ENOENT/);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test("official resource loader separates skills, prompt aliases, and runtime commands without Benny discovery", async () => {
  const f = await fixture();
  try {
    const { session, loader } = await f.open();
    const { skills, diagnostics } = loader.getSkills();
    assert.equal(skills.length, 65);
    assert.deepEqual(diagnostics, []);
    const expected = [...await readdir(join(packageRoot, "skills")), ...await readdir(join(packageRoot, "host/skills"))].sort();
    assert.deepEqual(skills.map((skill) => skill.name).sort(), expected);
    for (const skill of skills) assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const commands = new Set(session.extensionRunner.getRegisteredCommands().map((command) => command.name));
    assert.deepEqual([...commands].sort(), ["poteto-mode", "pstack", "setup-pstack"]);
    const templates = loader.getPrompts().prompts;
    assert.equal(templates.length, 64);
    const aliases = new Set(templates.map((template) => template.name));
    for (const name of [...expected, "bro"]) assert.ok(commands.has(name) || aliases.has(name), `missing /${name}`);
    assert.ok(!skills.some((skill) => skill.name === "bro"));
    for (const name of ["setup-benny", "triage-issue-reports", "reproduce-and-fix-issues"]) {
      assert.ok(!commands.has(name), `${name} must remain a direct instruction file`);
      assert.ok(!skills.some((skill) => skill.name === name));
    }
    const tools = new Set(session.getActiveToolNames());
    for (const name of ["Task", "TaskOutput", "TaskMessage", "TaskStop", "TodoWrite", "AskQuestion", "pstack_mode", "pstack_context"]) assert.ok(tools.has(name), name);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("/bro expands the shipped instructions and preserves user arguments in a real Pi request", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, "/bro Explain the previous answer simply.");
    assert.deepEqual(f.errors, []);
    const text = JSON.stringify(lastRequest(f.requests).messages);
    assert.match(text, /Stop using jargon and speak coherently/);
    assert.match(text, /Explain the previous answer simply\./);
    assert.equal(session.getLastAssistantText(), "Scripted reply.");
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("disabled native skills stay disabled while explicitly loaded extension commands remain available", async () => {
  const f = await fixture({ extensionOnly: true });
  try {
    const { session, loader } = await f.open();
    assert.deepEqual(loader.getSkills().skills, []);
    assert.deepEqual(loader.getPrompts().prompts, []);
    await prompt(session, "/skill:poteto-mode Analyze this task.");
    assert.equal(section(f.requests, "pstack_mode"), null);
    await prompt(session, "/skill:setup-pstack");
    assert.equal(session.messages.filter((message) => message.role === "custom" && message.customType === "pstack-setup-error").length, 0);
    await prompt(session, "/poteto-mode Analyze this task.");
    assert.match(section(f.requests, "pstack_mode") ?? "", /# Poteto mode/);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("pasted skill blocks remain user text and cannot activate runtime commands", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    for (const name of ["poteto-mode", "setup-pstack"]) {
      await prompt(session, `<skill name="${name}" location="${join(packageRoot, "skills", name, "SKILL.md")}">Example instructions</skill>\nExplain this example.`);
      assert.equal(Boolean(section(f.requests, "pstack_mode")), false);
    }
    assert.equal(session.messages.filter((message) => message.role === "custom" && message.customType === "pstack-setup-error").length, 0);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("Poteto mode survives session reopening and explicit off removes active mode instructions", async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    await prompt(first.session, "/poteto-mode Read this task carefully.");
    await prompt(first.session, "Continue the task.");
    assert.match(section(f.requests, "pstack_mode") ?? "", /Poteto mode|poteto-mode/);
    const path = first.manager.getSessionFile();
    assert.ok(path, "mode state must have a persisted session");
    first.session.dispose();
    const resumed = await f.open(SessionManager.open(path));
    await prompt(resumed.session, "Resume the task.");
    const active = section(f.requests, "pstack_mode") ?? "";
    assert.match(active, /Poteto mode|poteto-mode/);
    await prompt(resumed.session, "/poteto-mode off");
    await prompt(resumed.session, "A casual question.");
    const inactive = section(f.requests, "pstack_mode") ?? "";
    assert.notEqual(inactive, active, "off must change the effective system instructions");
    assert.ok(inactive.length < active.length, "off must remove the active mode instruction block");
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("model-issued TodoWrite and pstack_mode calls execute through Pi and retain their state", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({ type: "toolCall", id: "todo-1", name: "TodoWrite", arguments: {
      todos: [{ id: "frame", content: "Frame the task", status: "in_progress" }],
    } });
    await prompt(session, "Record the first task.");
    const todo = toolResults(session, "TodoWrite");
    assert.equal(todo.length, 1);
    assert.equal(todo[0]?.role, "toolResult");
    assert.match(JSON.stringify(todo[0]), /Frame the task/);
    assert.ok(!JSON.stringify(todo[0]).includes('"isError":true'));
    f.calls.push({ type: "toolCall", id: "mode-1", name: "pstack_mode", arguments: { enabled: true } });
    await prompt(session, "Enter Poteto mode.");
    assert.equal(toolResults(session, "pstack_mode").length, 1);
    await prompt(session, "Continue after mode activation.");
    assert.match(section(f.requests, "pstack_mode") ?? "", /Poteto mode|poteto-mode/);
    f.calls.push({ type: "toolCall", id: "context-1", name: "pstack_context", arguments: {} });
    await prompt(session, "Locate this session context.");
    const contexts = toolResults(session, "pstack_context");
    assert.equal(contexts.length, 1);
    assert.ok(!JSON.stringify(contexts[0]).includes('"isError":true'));
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("native /skill:poteto-mode enters the same mode and /pstack reports status without inference", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, "/skill:poteto-mode Analyze this task.");
    assert.match(section(f.requests, "pstack_mode") ?? "", /# Poteto mode/);
    const callsBeforeStatus = f.requests.length;
    await session.prompt("/pstack status");
    assert.equal(f.requests.length, callsBeforeStatus, "status must not spend an inference request");
    const status = session.messages.findLast((message) => message.role === "custom" && message.customType === "pstack-status");
    assert.ok(status);
    assert.match(JSON.stringify(status), /65 skills, 64 prompt templates/);
    assert.match(JSON.stringify(status), /team-kit 1.2.0/);
    assert.match(JSON.stringify(status), /Poteto mode on/);
    await prompt(session, "/poteto-mode off");
    await prompt(session, "Proceed casually.");
    assert.equal(section(f.requests, "pstack_mode"), null);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("TodoWrite merge preserves order and persisted progress after reopening", async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    f.calls.push({ type: "toolCall", id: "todo-seed", name: "TodoWrite", arguments: {
      todos: [
        { id: "frame", content: "Frame", status: "in_progress" },
        { id: "verify", content: "Verify", status: "pending" },
      ],
    } });
    await prompt(first.session, "Record the exact phases.");
    f.calls.push({ type: "toolCall", id: "todo-merge", name: "TodoWrite", arguments: {
      merge: true, todos: [{ id: "frame", content: "Frame", status: "completed" }],
    } });
    await prompt(first.session, "Mark the first phase complete.");
    const path = first.manager.getSessionFile();
    assert.ok(path);
    first.session.dispose();
    const resumed = await f.open(SessionManager.open(path));
    await prompt(resumed.session, "What remains?");
    const todosSection = section(f.requests, "pstack_todos");
    assert.ok(todosSection);
    assert.deepEqual(JSON.parse(todosSection.replace(/^<pstack_todos>\n|\n<\/pstack_todos>$/g, "")), [
      { id: "frame", content: "Frame", status: "completed" },
      { id: "verify", content: "Verify", status: "pending" },
    ]);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("branching before mode activation does not inherit state from the abandoned branch", async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    await prompt(first.session, "Start an ordinary conversation.");
    const anchor = first.manager.getLeafId();
    assert.ok(anchor);
    await prompt(first.session, "/poteto-mode Analyze this branch.");
    assert.ok(section(f.requests, "pstack_mode"));
    first.session.dispose();
    first.manager.branch(anchor);
    const alternate = await f.open(first.manager);
    await prompt(alternate.session, "Continue from before mode activation.");
    assert.equal(section(f.requests, "pstack_mode"), null);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("native and alias setup fail closed without UI and never fall through to inference", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await session.prompt("/setup-pstack");
    await session.prompt("/skill:setup-pstack");
    assert.equal(f.requests.length, 0);
    const errors = session.messages.filter((message) => message.role === "custom" && message.customType === "pstack-setup-error");
    assert.equal(errors.length, 2);
    for (const message of errors) {
      if (message.role === "custom") assert.match(String(message.content), /requires Pi interactive or RPC dialog UI/);
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("setup command saves confirmed role choices and offers project verification only once", async () => {
  const f = await fixture();
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(f.root, "agent");
  try {
    const { session } = await f.open();
    session.extensionRunner.setUIContext({
      ...session.extensionRunner.createContext().ui,
      select: async (title) => title.startsWith("pstack reasoning budget") ? "small — medium reasoning"
        : title.startsWith("Accept model table") ? "Accept as-is" : "inherit-parent",
      input: async () => "inherit-parent, auto",
      confirm: async () => true,
    }, "rpc");
    await prompt(session, "/setup-pstack");
    const configuration = await readFile(join(f.root, "agent/pstack/models.mdc"), "utf8");
    assert.match(configuration, /feature, refactoring: inherit-parent/);
    assert.match(configuration, /arena runners: inherit-parent, auto/);
    const request = JSON.stringify(lastRequest(f.requests).messages);
    assert.match(request, /want a project-local verification skill/);
    assert.ok(request.includes(join(packageRoot, "skills/create-verification-skill/SKILL.md")));
    const calls = f.requests.length;
    await session.prompt("/setup-pstack");
    assert.equal(f.requests.length, calls, "setup must not repeat its optional verification offer");
    assert.deepEqual(f.errors, []);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await f.close();
  }
});

test("team-kit templates request skill reading and native skills expand complete instructions", async () => {
  const f = await fixture();
  try {
    const { session, loader } = await f.open();
    assert.equal(loader.getSkills().skills.length, 65);
    const names = new Set(loader.getSkills().skills.map((skill) => skill.name));
    for (const name of [
      "check-compiler-errors", "control-cli", "control-ui", "deslop", "fix-ci",
      "fix-merge-conflicts", "get-pr-comments", "loop-on-ci", "make-pr-easy-to-review",
      "new-branch-and-pr", "pr-review-canvas", "review-and-ship", "run-smoke-tests",
      "thermo-nuclear-code-quality-review", "verify-this", "weekly-review",
      "what-did-i-get-done", "workflow-from-chats",
    ]) assert.ok(names.has(name), `missing kit skill ${name}`);
    for (const name of ["pr-review-canvas", "thermo-nuclear-code-quality-review"]) {
      assert.equal(loader.getSkills().skills.find((skill) => skill.name === name)?.disableModelInvocation, true);
    }
    for (const name of ["template.html", "styles.css", "renderer.js"]) {
      assert.deepEqual(
        await readFile(join(packageRoot, "skills/pr-review-canvas", name)),
        await readFile(join(packageRoot, "upstream-team-kit/skills/pr-review-canvas", name)),
      );
    }
    for (const [name, evidence] of [
      ["deslop", "Keep behavior unchanged unless fixing a clear bug."],
      ["control-cli", "Capture the current screen before interacting."],
      ["control-ui", "Do not rely on stale element references"],
    ]) {
      const skill = loader.getSkills().skills.find((skill) => skill.name === name);
      assert.ok(skill);
      f.calls.push({ type: "toolCall", id: `read-${name}`, name: "read", arguments: { path: skill.filePath } });
      await prompt(session, `/${name} Inspect this workspace.`);
      const request = JSON.stringify(lastRequest(f.requests).messages);
      assert.ok(request.includes(evidence), "the actual read tool must deliver the full skill instructions");
      assert.match(request, /Inspect this workspace/);
      assert.ok((section(f.requests, "pstack_host") ?? "").includes(join(packageRoot, "skills")));
      await prompt(session, `/skill:${name} Preserve this request.`);
      const text = JSON.stringify(lastRequest(f.requests).messages);
      assert.ok(text.includes(evidence));
      assert.match(text, /Preserve this request/);
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("pstack tool snippets and guidance follow the active tool set", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, "Work on this module.");
    const tools = section(f.requests, "tools") ?? "";
    for (const name of ["Task", "TaskOutput", "TaskMessage", "TaskStop", "TodoWrite", "AskQuestion", "pstack_mode", "pstack_context", "BackgroundShell", "BackgroundShellList", "BackgroundShellStop"]) {
      assert.match(tools, new RegExp(`^- ${name}: `, "m"), `${name} is listed with the available tools`);
    }
    assert.match(section(f.requests, "rules") ?? "", /Cloud Task execution is unavailable/);
    assert.match(section(f.requests, "rules") ?? "", /AskQuestion is available only with interactive or RPC dialogs/);
    assert.doesNotMatch(section(f.requests, "pstack_host") ?? "", /Cloud Task execution is unavailable|TodoWrite keeps/);
    session.setActiveToolsByName(["read", "bash"]);
    await prompt(session, "Continue with read and bash only.");
    assert.doesNotMatch(section(f.requests, "tools") ?? "", /^- (Task|TodoWrite|BackgroundShell): /m);
    assert.doesNotMatch(section(f.requests, "rules") ?? "", /Cloud Task execution is unavailable|TodoWrite keeps|BackgroundShell/);
    assert.doesNotMatch(section(f.requests, "pstack_host") ?? "", /Cloud Task execution is unavailable|TodoWrite keeps|BackgroundShell with notify_on_output/);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("team-kit rules stay archival to match observed Reference plugin behavior", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, "Work on this module.");
    const rules = section(f.requests, "pstack_team_kit_rules") ?? "";
    assert.equal(rules, "");
    assert.match(section(f.requests, "pstack_host") ?? "", /rules remain archived/);
    assert.equal(section(f.requests, "pstack_mode"), null);
    await prompt(session, "/poteto-mode Enter the mode.");
    await prompt(session, "/poteto-mode off");
    await prompt(session, "Continue this module.");
    assert.equal(section(f.requests, "pstack_team_kit_rules") ?? "", rules);
    assert.equal(section(f.requests, "pstack_mode"), null);
    const host = section(f.requests, "pstack_host") ?? "";
    assert.ok(!host.includes("team-kit deslop/control-cli/control-ui, MCP connectors"));
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("AskQuestion preserves selected IDs, free text, and cancellation through Pi dialog APIs", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    const selections = ["First [one]", "Enter a text answer", "Done selecting", "First [one]"];
    const inputs = ["Custom selection", "Free answer", undefined];
    session.extensionRunner.setUIContext({
      ...session.extensionRunner.createContext().ui,
      select: async (_title, options) => {
        const selected = selections.shift();
        if (selected !== undefined) assert.ok(options.includes(selected));
        return selected;
      },
      input: async () => inputs.shift(),
    }, "rpc");
    f.calls.push({ type: "toolCall", id: "questions", name: "AskQuestion", arguments: { questions: [
      { id: "multi", prompt: "Choose several", allow_multiple: true, options: [{ id: "one", label: "First" }] },
      { id: "single", prompt: "Choose one", options: [{ id: "one", label: "First" }] },
      { id: "text", prompt: "Describe your preference" },
      { id: "cancel", prompt: "Confirm the next action" },
    ] } });
    await prompt(session, "Ask for these preferences.");
    const answer = toolResults(session, "AskQuestion").at(-1);
    assert.ok(answer?.role === "toolResult" && !answer.isError);
    assert.deepEqual(answer.details, [
      { id: "multi", answers: ["one", "Custom selection"], cancelled: false },
      { id: "single", answers: ["one"], cancelled: false },
      { id: "text", answers: ["Free answer"], cancelled: false },
      { id: "cancel", answers: [], cancelled: true },
    ]);
    f.calls.push({ type: "toolCall", id: "cancel-choice", name: "AskQuestion", arguments: { questions: [
      { id: "approval", prompt: "Approve?", options: [{ id: "yes", label: "Yes" }] },
    ] } });
    await prompt(session, "Ask for approval.");
    const cancelled = toolResults(session, "AskQuestion").at(-1);
    assert.ok(cancelled?.role === "toolResult" && !cancelled.isError);
    assert.deepEqual(cancelled.details, [{ id: "approval", answers: [], cancelled: true }]);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("AskQuestion without UI returns an error and never fabricates consent", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({ type: "toolCall", id: "no-ui", name: "AskQuestion", arguments: { questions: [{ id: "approval", prompt: "Approve?" }] } });
    await prompt(session, "Request approval.");
    const answer = toolResults(session, "AskQuestion").at(-1);
    assert.ok(answer?.role === "toolResult" && answer.isError);
    assert.match(JSON.stringify(answer.content), /requires Pi TUI or an RPC client/);
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("invalid todo replacement leaves progress intact and mode tool can opt out", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({ type: "toolCall", id: "valid-todo", name: "TodoWrite", arguments: {
      todos: [{ id: "first", content: "Keep this progress", status: "completed" }],
    } });
    await prompt(session, "Save progress.");
    f.calls.push({ type: "toolCall", id: "invalid-todo", name: "TodoWrite", arguments: {
      todos: [
        { id: "duplicate", content: "Invalid", status: "pending" },
        { id: "duplicate", content: "Invalid again", status: "pending" },
      ],
    } });
    await prompt(session, "Reject duplicate identifiers.");
    const failure = toolResults(session, "TodoWrite").at(-1);
    assert.ok(failure?.role === "toolResult" && failure.isError);
    assert.match(JSON.stringify(failure.content), /Todo IDs must be unique/);
    f.calls.push({ type: "toolCall", id: "opt-out", name: "pstack_mode", arguments: { enabled: false } });
    await prompt(session, "Leave the mode.");
    assert.match(section(f.requests, "pstack_todos") ?? "", /Keep this progress/);
    assert.equal(section(f.requests, "pstack_mode"), null);
    const mode = toolResults(session, "pstack_mode").at(-1);
    assert.ok(mode?.role === "toolResult" && !mode.isError);
    assert.match(JSON.stringify(mode.content), /Poteto mode is off/);
  } finally { await f.close(); }
});

test("repeated context calls persist bounded nonrecursive evidence with transcript pointers", async t => {
  const f = await fixture();
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(f.root, "agent");
  try {
    const { session } = await f.open();
    const evidence = "Transcript evidence ".repeat(3000);
    await prompt(session, evidence);
    for (let index = 0; index < 100; index++) session.sessionManager.appendCustomEntry('context-fixture', { index });
    for (let index = 0; index < 12; index++) {
      f.calls.push({ type: "toolCall", id: `context-${index}`, name: "pstack_context", arguments: { history: true } });
      await prompt(session, "Locate the evidence and workspace history.");
      const result = toolResults(session, "pstack_context").at(-1);
      assert.ok(result?.role === "toolResult" && !result.isError);
      assert.ok(Buffer.byteLength(JSON.stringify(result)) < 128 * 1024);
      const details = result.details as { sessionFile: string; entries: object[] };
      assert.equal(details.sessionFile, session.sessionFile);
      assert.ok(details.entries.every(entry => !('message' in entry) && !('details' in entry)));
      assert.ok(!JSON.stringify(result.details).includes(evidence));
    }
    const persisted = (await readFile(session.sessionFile!, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    const contexts = persisted.filter(entry => entry.message?.toolName === 'pstack_context');
    assert.equal(contexts.length, 12);
    const sizes = contexts.map(entry => Buffer.byteLength(JSON.stringify(entry)));
    assert.ok(sizes.every(size => size < 128 * 1024));
    assert.ok(contexts.at(-1).message.details.omitted.entries > 0);
    t.diagnostic(`Persisted context results ${sizes.length}; maximum serialized entry bytes ${Math.max(...sizes)}; final omitted entries ${contexts.at(-1).message.details.omitted.entries}.`);
    assert.ok(persisted.some(entry => entry.message?.role === 'user' && JSON.stringify(entry.message.content).includes(evidence)));
    assert.deepEqual(f.errors, []);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await f.close();
  }
});


test("AskQuestion rejects ambiguous and blank identifiers before opening dialogs", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    let dialogs = 0;
    session.extensionRunner.setUIContext({
      ...session.extensionRunner.createContext().ui,
      select: async () => { dialogs++; return undefined; },
      input: async () => { dialogs++; return undefined; },
    }, "rpc");
    const invalid = [
      null, undefined, 'wrong type', [], Array.from({ length: 5 }, (_, index) => ({ id: `q-${index}`, prompt: 'Question' })),
      [{ id: "same", prompt: "First" }, { id: "same", prompt: "Second" }],
      [{ id: "", prompt: "Question" }],
      [{ id: "blank", prompt: " " }],
      [{ id: "pick", prompt: "Choose", options: [{ id: "same", label: "A" }, { id: "same", label: "B" }] }],
      [{ id: "pick", prompt: "Choose", options: [{ id: "", label: "A" }] }],
      [{ id: "pick", prompt: "Choose", options: [{ id: "b] [c", label: "a" }, { id: "c", label: "a [b]" }] }],
    ];
    for (const [index, questions] of invalid.entries()) {
      f.calls.push({ type: "toolCall", id: `invalid-question-${index}`, name: "AskQuestion", arguments: questions === undefined ? {} : { questions } });
      await prompt(session, "Validate the question before asking it.");
      const answer = toolResults(session, "AskQuestion").at(-1);
      assert.ok(answer?.role === "toolResult" && answer.isError, JSON.stringify(answer));
    }
    assert.equal(dialogs, 0);
  } finally { await f.close(); }
});


test('context history errors become failed Pi tool results rather than empty evidence', async t => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    t.mock.method(SessionManager, 'list', async () => { throw new Error('history unavailable'); });
    f.calls.push({ type: 'toolCall', id: 'failed-history', name: 'pstack_context', arguments: { history: true } });
    await prompt(session, 'Read workspace history');
    const result = toolResults(session, 'pstack_context').at(-1);
    assert.ok(result?.role === 'toolResult' && result.isError);
    assert.match(JSON.stringify(result.content), /history unavailable/);
  } finally { t.mock.restoreAll(); await f.close(); }
});

test("restoration ignores invalid todo snapshots and keeps the latest valid branch state", async () => {
  const f = await fixture();
  try {
    const first = await f.open();
    const valid = { enabled: true, todos: [{ id: "keep", content: "Keep this task", status: "completed" }] };
    first.manager.appendCustomEntry("pstack-state", valid);
    for (const invalid of [null, {}, { enabled: true, todos: [{ id: "bad", content: "Bad", status: "unknown" }] },
      { ...valid, todos: [valid.todos[0], valid.todos[0]] }]) {
      first.manager.appendCustomEntry("pstack-state", invalid);
    }
    const restored = await f.open(first.manager);
    await prompt(restored.session, "Restore this branch.");
    const saved = section(f.requests, "pstack_todos") ?? "";
    assert.deepEqual(JSON.parse(saved.replace(/^<pstack_todos>\n|\n<\/pstack_todos>$/g, "")), valid.todos);
    assert.match(section(f.requests, "pstack_mode") ?? "", /# Poteto mode/);
  } finally { await f.close(); }
});

test("a Pi tool batch serializes question dialogs and retains both answers", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    let active = 0;
    let maximum = 0;
    session.extensionRunner.setUIContext({
      ...session.extensionRunner.createContext().ui,
      input: async (title) => {
        active++;
        maximum = Math.max(maximum, active);
        await new Promise(resolve => setTimeout(resolve, 10));
        active--;
        return `Answer ${title}`;
      },
    }, "rpc");
    f.calls.push(["first", "second"].map(id => ({ type: "toolCall", id, name: "AskQuestion",
      arguments: { questions: [{ id, prompt: id }] } })));
    await prompt(session, "Ask both questions.");
    assert.equal(maximum, 1);
    assert.deepEqual(toolResults(session, "AskQuestion").map(message => message.role === "toolResult" ? message.details : undefined), [
      [{ id: "first", answers: ["Answer first"], cancelled: false }],
      [{ id: "second", answers: ["Answer second"], cancelled: false }],
    ]);
  } finally { await f.close(); }
});

test("large todo results retain full structured state and point to the durable transcript", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    const todos = [{ id: "large", content: "Task detail ".repeat(5000), status: "pending" }];
    f.calls.push({ type: "toolCall", id: "large-todos", name: "TodoWrite", arguments: { todos } });
    await prompt(session, "Record the complete playbook.");
    const result = toolResults(session, "TodoWrite").at(-1);
    assert.ok(result?.role === "toolResult" && !result.isError);
    const text = result.content.find(block => block.type === "text")?.text ?? "";
    assert.ok(text.length < 49000);
    assert.match(text, /Truncated\. Full current transcript:/);
    assert.ok(text.includes(session.sessionManager.getSessionFile() ?? "missing transcript"));
    assert.deepEqual(result.details, todos);
  } finally { await f.close(); }
});

test("large question answers retain complete details when the session has no transcript file", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open(SessionManager.inMemory(f.cwd));
    const answer = "Detailed answer ".repeat(4000);
    session.extensionRunner.setUIContext({
      ...session.extensionRunner.createContext().ui,
      input: async () => answer,
    }, "rpc");
    f.calls.push({ type: "toolCall", id: "large-answer", name: "AskQuestion",
      arguments: { questions: [{ id: "scope", prompt: "Describe the scope" }] } });
    await prompt(session, "Ask for the complete scope.");
    const result = toolResults(session, "AskQuestion").at(-1);
    assert.ok(result?.role === "toolResult" && !result.isError);
    const text = result.content.find(block => block.type === "text")?.text ?? "";
    assert.ok(text.length < 49000);
    assert.match(text, /Truncated\. Full current transcript: available in tool details/);
    assert.deepEqual(result.details, [{ id: "scope", answers: [answer], cancelled: false }]);
  } finally { await f.close(); }
});
