import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import {
  fixture,
  lastRequest,
  packageRoot,
  prompt,
  section,
} from "./session-fixture.ts";

type ToolResult = {
  role: "toolResult";
  toolCallId: string;
  toolName: string;
  content: Array<{ type: string; text?: string }>;
  details?: unknown;
  isError: boolean;
};

type CustomMsg = {
  role: "custom";
  customType: string;
  content: string;
  display: boolean;
  details?: unknown;
};

function toolResultsOf(session: { messages: unknown[] }, name: string): ToolResult[] {
  return (session.messages as ToolResult[]).filter((m) => m.role === "toolResult" && m.toolName === name);
}

function customMessagesOf(session: { messages: unknown[] }, customType: string): CustomMsg[] {
  return (session.messages as CustomMsg[]).filter((m) => m.role === "custom" && m.customType === customType);
}

test("user-perspective: package settings, skills, and prompt templates", async () => {
  const settingsPath = join(process.env.HOME!, ".pi/agent/settings.json");
  const settings = JSON.parse(await readFile(settingsPath, "utf8"));
  assert.ok(settings.packages?.some((p: string) => p.includes("pi-pstack")), "package in settings");

  const f = await fixture();
  try {
    const { session, loader } = await f.open();
    const skills = loader.getSkills().skills;
    const prompts = loader.getPrompts().prompts;
    assert.equal(skills.length, 65, "65 skills");
    assert.equal(prompts.length, 64, "64 prompts");

    for (const skill of skills) {
      assert.ok(skill.description && skill.description.trim().length > 0, skill.name);
      const skillFile = await readFile(skill.filePath, "utf8");
      const { frontmatter } = parseFrontmatter<Record<string, unknown>>(skillFile);
      assert.ok(frontmatter.description, frontmatter.name ? String(frontmatter.name) : skill.name);
    }
    const commands = new Set(session.extensionRunner.getRegisteredCommands().map((c) => c.name));
    for (const name of ["pstack", "poteto-mode", "setup-pstack"]) {
      assert.ok(commands.has(name), `Command /${name} registered`);
    }
  } finally {
    await f.close();
  }
});

test("user-perspective: executable scripts in skills", async () => {
  const scriptsDir = join(packageRoot, "skills/poteto-mode/scripts");
  const scriptFiles = await readdir(scriptsDir);
  for (const file of scriptFiles) {
    if (file.endsWith(".sh")) {
      const s = await stat(join(scriptsDir, file));
      assert.ok((s.mode & 0o111) !== 0, `Script ${file} executable`);
    }
  }
});

test("user-perspective: /pstack default, status, and invalid arguments", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await session.prompt("/pstack");
    let msgs = customMessagesOf(session, "pstack-status");
    assert.equal(msgs.length, 1);
    assert.match(String(msgs[0]?.content), /pstack 0\.15\.5 with cursor-team-kit 1\.2\.0/);
    assert.match(String(msgs[0]?.content), /65 skills, 64 prompt templates/);
    assert.match(String(msgs[0]?.content), /Poteto mode off/);

    await session.prompt("/pstack status");
    msgs = customMessagesOf(session, "pstack-status");
    assert.equal(msgs.length, 2);

    await session.prompt("/pstack invalid_arg");
    msgs = customMessagesOf(session, "pstack-status");
    assert.equal(msgs.length, 2);
  } finally {
    await f.close();
  }
});

test("user-perspective: /pstack todos with empty and filled list", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await session.prompt("/pstack todos");
    let msgs = customMessagesOf(session, "pstack-status");
    assert.equal(msgs.length, 1);
    assert.match(String(msgs[0]?.content), /Todos: none\./);

    f.calls.push({
      type: "toolCall", id: "t1", name: "TodoWrite",
      arguments: {
        todos: [
          { id: "step-1", content: "First task", status: "completed" },
          { id: "step-2", content: "Second task", status: "in_progress" },
          { id: "step-3", content: "Third task", status: "pending" },
          { id: "step-4", content: "Fourth task", status: "cancelled" },
        ],
      },
    });
    await prompt(session, "Add todos");
    await session.prompt("/pstack todos");
    msgs = customMessagesOf(session, "pstack-status");
    assert.equal(msgs.length, 2);
    const content = String(msgs[1]?.content);
    assert.match(content, /Todos: 1\/4 completed\./);
    assert.match(content, /\[x\] First task \(completed\)/);
    assert.match(content, /\[>\] Second task \(in_progress\)/);
    assert.match(content, /\[ \] Third task \(pending\)/);
    assert.match(content, /\[-\] Fourth task \(cancelled\)/);
  } finally {
    await f.close();
  }
});

test("user-perspective: /poteto-mode on/off case-insensitivity and prompt injection", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, "Initial check");
    assert.equal(section(f.requests, "pstack_mode"), null);
    assert.ok(section(f.requests, "pstack_host")?.includes("pstack pi host contract"));

    await prompt(session, "/poteto-mode Work on user feature");
    assert.match(section(f.requests, "pstack_mode") ?? "", /# Poteto mode/);

    await session.prompt("/poteto-mode off");
    await prompt(session, "Check mode state");
    assert.equal(section(f.requests, "pstack_mode"), null);

    await prompt(session, "/skill:poteto-mode Investigate architecture");
    assert.match(section(f.requests, "pstack_mode") ?? "", /# Poteto mode/);

    await session.prompt("/poteto-mode OFF");
    await prompt(session, "Check uppercase off");
    assert.equal(section(f.requests, "pstack_mode"), null);
  } finally {
    await f.close();
  }
});

test("user-perspective: prompt templates expansion (/bro, /how, /loop, /deslop)", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await prompt(session, "/bro Explain this simply.");
    let text = JSON.stringify(lastRequest(f.requests).messages);
    assert.match(text, /Stop using jargon and speak coherently/);
    assert.match(text, /Explain this simply\./);

    await prompt(session, "/how explore session persistence");
    text = JSON.stringify(lastRequest(f.requests).messages);
    assert.match(text, /Read how\/SKILL\.md in full/);
    assert.match(text, /explore session persistence/);

    await prompt(session, "/loop 5s check ci");
    text = JSON.stringify(lastRequest(f.requests).messages);
    assert.match(text, /Read loop\/SKILL\.md in full under the pstack host skills directory/);
    assert.match(text, /5s check ci/);

    await prompt(session, "/deslop clean up styles");
    text = JSON.stringify(lastRequest(f.requests).messages);
    assert.match(text, /Read deslop\/SKILL\.md in full/);
    assert.match(text, /clean up styles/);
  } finally {
    await f.close();
  }
});

test("user-perspective: TodoWrite tool replace, merge, and error handling", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: "toolCall", id: "call-1", name: "TodoWrite",
      arguments: {
        todos: [
          { id: "task-a", content: "Task A", status: "pending" },
          { id: "task-b", content: "Task B", status: "in_progress" },
        ],
      },
    });
    await prompt(session, "Set initial todos");
    let results = toolResultsOf(session, "TodoWrite");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.isError, false);

    await prompt(session, "Check injected todos");
    const todosSection = section(f.requests, "pstack_todos");
    assert.ok(todosSection);
    const parsedTodos = JSON.parse(todosSection.replace(/^<pstack_todos>\n|\n<\/pstack_todos>$/g, ""));
    assert.equal(parsedTodos.length, 2);

    f.calls.push({
      type: "toolCall", id: "call-2", name: "TodoWrite",
      arguments: {
        merge: true,
        todos: [
          { id: "task-a", content: "Task A (updated)", status: "completed" },
          { id: "task-c", content: "Task C", status: "pending" },
        ],
      },
    });
    await prompt(session, "Merge todos");
    results = toolResultsOf(session, "TodoWrite");
    assert.equal(results.length, 2);
    const merged = results[1]?.details as Array<{ id: string; status: string }>;
    assert.equal(merged.length, 3);
    assert.equal(merged[0]?.id, "task-a");
    assert.equal(merged[0]?.status, "completed");
    assert.equal(merged[1]?.id, "task-b");
    assert.equal(merged[2]?.id, "task-c");
  } finally {
    await f.close();
  }
});

test("user-perspective: TodoWrite rejects duplicate IDs", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: "toolCall", id: "call-dup", name: "TodoWrite",
      arguments: {
        todos: [
          { id: "dup", content: "Dup 1", status: "pending" },
          { id: "dup", content: "Dup 2", status: "pending" },
        ],
      },
    });
    await prompt(session, "Send duplicate IDs");
    const results = toolResultsOf(session, "TodoWrite");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.isError, true);
    assert.match(JSON.stringify(results[0]), /Todo IDs must be unique/);
  } finally {
    await f.close();
  }
});

test("user-perspective: pstack_context tool returns valid bounds and metadata", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: "toolCall", id: "ctx-1", name: "pstack_context", arguments: { history: false },
    });
    await prompt(session, "Fetch context");
    const results = toolResultsOf(session, "pstack_context");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.isError, false);
    const details = results[0]?.details as {
      cwd: string; sessionFile: string | null; tools: Array<{ name: string }>;
    };
    assert.ok(details.cwd);
    assert.ok(details.tools.some((t) => t.name === "TodoWrite"));
    assert.ok(details.tools.some((t) => t.name === "pstack_mode"));
    assert.ok(details.tools.some((t) => t.name === "Task"));
  } finally {
    await f.close();
  }
});

test("user-perspective: real Pi CLI execution (e2e without flags)", async () => {
  const run = (args: string[]): Promise<{ stdout: string; stderr: string; code: number | null }> => {
    return new Promise((resolve, reject) => {
      const child = spawn("pi", args, { cwd: packageRoot, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (d) => (stdout += d.toString()));
      child.stderr.on("data", (d) => (stderr += d.toString()));
      const timer = setTimeout(() => {
        child.kill("SIGKILL");
        reject(new Error(`pi ${args.join(" ")} timed out after 3000ms. Stderr: ${stderr}`));
      }, 3000);
      child.on("close", (code) => {
        clearTimeout(timer);
        resolve({ stdout, stderr, code });
      });
    });
  };

  const pstackRes = await run(["--mode", "json", "-p", "--no-session", "/pstack"]);
  assert.equal(pstackRes.code, 0, `pi /pstack failed: ${pstackRes.stderr}`);
  const lines = pstackRes.stdout.trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
  const statusMsg = lines.find((l) => l.message?.customType === "pstack-status");
  assert.ok(statusMsg, "pi /pstack must emit pstack-status");
  assert.match(statusMsg.message.content, /pstack 0\.15\.5 with cursor-team-kit 1\.2\.0/);

  const modeOffRes = await run(["--mode", "json", "-p", "--no-session", "/poteto-mode off"]);
  assert.equal(modeOffRes.code, 0, `pi /poteto-mode off failed: ${modeOffRes.stderr}`);
});

test("user-perspective: AskQuestion tool headless error", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: "toolCall", id: "q-headless", name: "AskQuestion",
      arguments: { questions: [{ id: "q1", prompt: "Choose an option" }] },
    });
    await prompt(session, "Ask question headless");
    const results = toolResultsOf(session, "AskQuestion");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.isError, true);
    assert.match(JSON.stringify(results[0]), /AskQuestion requires Pi TUI or an RPC client/);
  } finally {
    await f.close();
  }
});

test("user-perspective: AskQuestion rejects invalid identifiers", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: "toolCall", id: "q-invalid", name: "AskQuestion",
      arguments: {
        questions: [
          { id: "dup", prompt: "First prompt" },
          { id: "dup", prompt: "Second prompt" },
        ],
      },
    });
    await prompt(session, "Send duplicate question IDs");
    const results = toolResultsOf(session, "AskQuestion");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.isError, true);
    assert.match(JSON.stringify(results[0]), /Question IDs must be unique/);
  } finally {
    await f.close();
  }
});

test("user-perspective: Task tool rejects cloud execution and unsupported personas", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: "toolCall", id: "t-cloud", name: "Task",
      arguments: { prompt: "Run task", environment: "cloud" },
    });
    await prompt(session, "Request cloud task");
    let results = toolResultsOf(session, "Task");
    assert.equal(results.length, 1);
    assert.equal(results[0]?.isError, true);
    assert.match(JSON.stringify(results[0]), /Cursor cloud execution is unavailable in Pi/);

    f.calls.push({
      type: "toolCall", id: "t-persona", name: "Task",
      arguments: { prompt: "Run task", subagent_type: "shell" },
    });
    await prompt(session, "Request unsupported persona");
    results = toolResultsOf(session, "Task");
    assert.equal(results.length, 2);
    assert.equal(results[1]?.isError, true);
    assert.match(JSON.stringify(results[1]), /Unsupported agent shell/);
  } finally {
    await f.close();
  }
});

test("user-perspective: BackgroundShell start, list, and stop", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    f.calls.push({
      type: "toolCall", id: "bs-start", name: "BackgroundShell",
      arguments: { command: "sleep 10", title: "sleep-test" },
    });
    await prompt(session, "Start background shell");
    const startRes = toolResultsOf(session, "BackgroundShell");
    assert.equal(startRes.length, 1);
    assert.equal(startRes[0]?.isError, false);
    const shellRecord = startRes[0]?.details as { id: string; pid: number };
    assert.ok(shellRecord.id);

    f.calls.push({ type: "toolCall", id: "bs-list", name: "BackgroundShellList", arguments: {} });
    await prompt(session, "List background shells");
    const listRes = toolResultsOf(session, "BackgroundShellList");
    assert.equal(listRes.length, 1);
    const list = listRes[0]?.details as Array<{ id: string }>;
    assert.ok(list.some((s) => s.id === shellRecord.id));

    f.calls.push({
      type: "toolCall", id: "bs-stop", name: "BackgroundShellStop",
      arguments: { id: shellRecord.id },
    });
    await prompt(session, "Stop background shell");
    const stopRes = toolResultsOf(session, "BackgroundShellStop");
    assert.equal(stopRes.length, 1);
    assert.equal(stopRes[0]?.isError, false);
  } finally {
    await f.close();
  }
});

test("user-perspective: /setup-pstack headless fails closed", async () => {
  const f = await fixture();
  try {
    const { session } = await f.open();
    await session.prompt("/setup-pstack");
    const errors = customMessagesOf(session, "pstack-setup-error");
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]?.content), /\/setup-pstack requires Pi interactive or RPC dialog UI/);
  } finally {
    await f.close();
  }
});
