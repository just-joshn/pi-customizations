import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import {
  createAssistantMessageEventStream,
  type AssistantMessage,
  type Context,
  type Model,
  type ToolCall,
} from "@earendil-works/pi-ai";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type ExtensionFactory,
} from "@earendil-works/pi-coding-agent";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const model: Model<"openai-completions"> = {
  id: "scripted", name: "Scripted integration provider", provider: "pstack-integration",
  api: "openai-completions", baseUrl: "https://integration.invalid", reasoning: false,
  input: ["text"], contextWindow: 128000, maxTokens: 4096,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
};

function providerFixture(requests: Context[], calls: (ToolCall | ToolCall[])[]): ExtensionFactory {
  return (pi) => {
    pi.registerProvider(model.provider, {
      api: model.api, baseUrl: model.baseUrl, apiKey: "integration-only-not-a-credential",
      models: [model],
      streamSimple: (_model, context) => {
        requests.push(structuredClone(context));
        const call = calls.shift();
        const message: AssistantMessage = {
          role: "assistant", api: model.api, provider: model.provider, model: model.id,
          content: call ? (Array.isArray(call) ? call : [call]) : [{ type: "text", text: "Scripted reply." }],
          stopReason: call ? "toolUse" : "stop", timestamp: Date.now(),
          usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
        };
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason: call ? "toolUse" : "stop", message });
        stream.end(message);
        return stream;
      },
    });
  };
}

async function fixture({ extensionOnly = false }: { extensionOnly?: boolean } = {}) {
  const root = await mkdtemp(join(tmpdir(), "pstack-integration-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
  const requests: Context[] = [];
  const calls: (ToolCall | ToolCall[])[] = [];
  const sessions: AgentSession[] = [];
  const errors: string[] = [];
  const provider = providerFixture(requests, calls);
  const settingsManager = SettingsManager.inMemory({
    packages: extensionOnly ? [] : [packageRoot], compaction: { enabled: false }, retry: { enabled: false },
  });
  async function load() {
    const loader = new DefaultResourceLoader({
      cwd, agentDir, settingsManager, extensionFactories: [provider],
      additionalExtensionPaths: [extensionOnly ? join(packageRoot, "src/index.ts") : packageRoot], noExtensions: true, noSkills: true,
      noContextFiles: true, noPromptTemplates: true, noThemes: true,
    });
    await loader.reload();
    assert.deepEqual(loader.getExtensions().errors, [], "package extension must load without errors");
    return loader;
  }
  async function open(manager = SessionManager.create(cwd, join(root, "sessions"))) {
    const loader = await load();
    const modelRuntime = await ModelRuntime.create({
      authPath: join(agentDir, "auth.json"), modelsPath: null,
      allowModelNetwork: false, refreshOnCreate: false,
    });
    const { session } = await createAgentSession({
      cwd, agentDir, settingsManager, sessionManager: manager, resourceLoader: loader,
      modelRuntime, model, thinkingLevel: "off",
    });
    sessions.push(session);
    await session.bindExtensions({ onError: (error) => errors.push(error.error) });
    return { session, manager, loader };
  }
  return {
    root, cwd, requests, calls, errors, load, open,
    async close() {
      for (const session of sessions) {
        await session.abort();
        session.dispose();
      }
      await rm(root, { recursive: true, force: true });
    },
  };
}

async function prompt(session: AgentSession, text: string) {
  if (text === "/poteto-mode off") {
    await session.prompt(text);
    return;
  }
  let unsubscribe = () => {};
  let timer: ReturnType<typeof setTimeout> | undefined;
  const settled = new Promise<void>((resolve, reject) => {
    timer = setTimeout(() => reject(new Error("Pi did not settle the scripted request")), 5000);
    unsubscribe = session.subscribe((event) => {
      if (event.type === "agent_settled") resolve();
    });
  });
  try {
    await session.prompt(text);
    await settled;
  } finally {
    clearTimeout(timer);
    unsubscribe();
  }
}

function section(requests: Context[], name: string) {
  let value: string | null = null;
  for (const message of lastRequest(requests).messages) {
    if (message.role === "system" && message.sections && name in message.sections) {
      value = message.sections[name] ?? null;
    }
  }
  return value;
}

function lastRequest(requests: Context[]) {
  const request = requests.at(-1);
  assert.ok(request, "the scripted provider must receive a real Pi request");
  return request;
}

function toolResults(session: AgentSession, name: string) {
  return session.messages.filter((message) => message.role === "toolResult" && message.toolName === name);
}

test("official resource loader separates skills, prompt aliases, and runtime commands without Benny discovery", async () => {
  const f = await fixture();
  try {
    const { session, loader } = await f.open();
    const { skills, diagnostics } = loader.getSkills();
    assert.equal(skills.length, 64);
    assert.deepEqual(diagnostics, []);
    const expected = (await readdir(join(packageRoot, "skills"))).sort();
    assert.deepEqual(skills.map((skill) => skill.name).sort(), expected);
    for (const skill of skills) assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const commands = new Set(session.extensionRunner.getRegisteredCommands().map((command) => command.name));
    assert.deepEqual([...commands].sort(), ["poteto-mode", "pstack", "setup-pstack"]);
    const templates = loader.getPrompts().prompts;
    assert.equal(templates.length, 63);
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
    assert.match(JSON.stringify(status), /64 skills, 63 prompt templates/);
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
    assert.equal(loader.getSkills().skills.length, 64);
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

test("large context output is bounded while structured transcript evidence remains complete", async () => {
  const f = await fixture();
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = join(f.root, "agent");
  try {
    const { session } = await f.open();
    const evidence = "Transcript evidence ".repeat(3000);
    await prompt(session, evidence);
    f.calls.push({ type: "toolCall", id: "large-context", name: "pstack_context", arguments: { history: true } });
    await prompt(session, "Locate the evidence and workspace history.");
    const result = toolResults(session, "pstack_context").at(-1);
    assert.ok(result?.role === "toolResult" && !result.isError, JSON.stringify(result));
    const text = result.content.find((block) => block.type === "text")?.text ?? "";
    assert.ok(text.length < 49000);
    assert.match(text, /Truncated\. Full current transcript:/);
    assert.ok(JSON.stringify(result.details).includes(evidence));
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
      [{ id: "same", prompt: "First" }, { id: "same", prompt: "Second" }],
      [{ id: "", prompt: "Question" }],
      [{ id: "blank", prompt: " " }],
      [{ id: "pick", prompt: "Choose", options: [{ id: "same", label: "A" }, { id: "same", label: "B" }] }],
      [{ id: "pick", prompt: "Choose", options: [{ id: "", label: "A" }] }],
      [{ id: "pick", prompt: "Choose", options: [{ id: "b] [c", label: "a" }, { id: "c", label: "a [b]" }] }],
    ];
    for (const [index, questions] of invalid.entries()) {
      f.calls.push({ type: "toolCall", id: `invalid-question-${index}`, name: "AskQuestion", arguments: { questions } });
      await prompt(session, "Validate the question before asking it.");
      const answer = toolResults(session, "AskQuestion").at(-1);
      assert.ok(answer?.role === "toolResult" && answer.isError, JSON.stringify(answer));
    }
    assert.equal(dialogs, 0);
  } finally { await f.close(); }
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
