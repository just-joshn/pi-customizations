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

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "pstack-integration-"));
  const cwd = join(root, "workspace");
  const agentDir = join(root, "agent");
  await Promise.all([mkdir(cwd), mkdir(agentDir)]);
  const requests: Context[] = [];
  const calls: ToolCall[] = [];
  const sessions: AgentSession[] = [];
  const errors: string[] = [];
  const provider: ExtensionFactory = (pi) => {
    pi.registerProvider(model.provider, {
      api: model.api, baseUrl: model.baseUrl, apiKey: "integration-only-not-a-credential",
      models: [model],
      streamSimple: (_model, context) => {
        requests.push(structuredClone(context));
        const call = calls.shift();
        const message: AssistantMessage = {
          role: "assistant", api: model.api, provider: model.provider, model: model.id,
          content: call ? [call] : [{ type: "text", text: "Scripted reply." }],
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
  const settingsManager = SettingsManager.inMemory({
    packages: [packageRoot], compaction: { enabled: false }, retry: { enabled: false },
  });
  async function load() {
    const loader = new DefaultResourceLoader({
      cwd, agentDir, settingsManager, extensionFactories: [provider],
      additionalExtensionPaths: [packageRoot], noExtensions: true, noSkills: true,
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
      modelRuntime, model, thinkingLevel: "off", noTools: "builtin",
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

test("official resource loader exposes all 65 public skills and commands without Benny discovery", async () => {
  const f = await fixture();
  try {
    const { session, loader } = await f.open();
    const { skills, diagnostics } = loader.getSkills();
    assert.equal(skills.length, 65);
    assert.deepEqual(diagnostics, []);
    const expected = (await readdir(join(packageRoot, "skills"))).sort();
    assert.deepEqual(skills.map((skill) => skill.name).sort(), expected);
    for (const skill of skills) assert.match(skill.name, /^[a-z0-9]+(?:-[a-z0-9]+)*$/);
    const commands = new Set(session.extensionRunner.getRegisteredCommands().map((command) => command.name));
    for (const name of expected) assert.ok(commands.has(name), `missing /${name}`);
    assert.ok(commands.has("pstack"));
    for (const name of ["setup-benny", "triage-issue-reports", "reproduce-and-fix-issues"]) {
      assert.ok(!commands.has(name), `${name} must remain a direct instruction file`);
      assert.ok(!skills.some((skill) => skill.name === name));
    }
    const tools = new Set(session.getActiveToolNames());
    for (const name of ["Task", "TodoWrite", "pstack_mode", "pstack_context"]) assert.ok(tools.has(name), name);
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
    assert.match(JSON.stringify(status), /65 skill aliases/);
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

test("team-kit dependencies load through aliases and native skills with full instructions", async () => {
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
      await prompt(session, `/${name} Inspect this workspace.`);
      assert.ok(JSON.stringify(lastRequest(f.requests).messages).includes(evidence));
      await prompt(session, `/skill:${name} Preserve this request.`);
      const text = JSON.stringify(lastRequest(f.requests).messages);
      assert.ok(text.includes(evidence));
      assert.match(text, /Preserve this request/);
    }
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});

test("team-kit always-on rules apply without Poteto mode and survive mode being turned off", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, "Work on this module.");
    const rules = section(f.requests, "pstack_team_kit_rules") ?? "";
    assert.match(rules, /Always place imports at the top of the module/);
    assert.match(rules, /use a `never` check in the default case/);
    assert.equal(section(f.requests, "pstack_mode"), null);
    await prompt(session, "/poteto-mode Enter the mode.");
    await prompt(session, "/poteto-mode off");
    await prompt(session, "Continue this module.");
    assert.equal(section(f.requests, "pstack_team_kit_rules"), rules);
    assert.equal(section(f.requests, "pstack_mode"), null);
    const host = section(f.requests, "pstack_host") ?? "";
    assert.ok(!host.includes("team-kit deslop/control-cli/control-ui, MCP connectors"));
    assert.deepEqual(f.errors, []);
  } finally { await f.close(); }
});
