import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { anthropicProvider } from "@earendil-works/pi-ai/providers/anthropic";
import type { ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { modelConfigPath, readModelRule, resolveModel, setupModels } from "../src/models.ts";

const found = anthropicProvider().getModels().find((item) => item.reasoning);
if (!found) throw new Error("Pi Anthropic catalogue has no reasoning model.");
const model = found;
function context(overrides: Partial<ExtensionCommandContext> = {}): ExtensionCommandContext {
  return { hasUI: false, model, thinkingLevel: "medium", modelRegistry: { getAvailable: () => [model] }, ...overrides } as ExtensionCommandContext;
}
function ui(handlers: Partial<ExtensionContext["ui"]>): ExtensionContext["ui"] {
  return { notify: () => {}, select: async () => undefined, input: async () => undefined, confirm: async () => false, ...handlers } as ExtensionContext["ui"];
}

test("parent aliases, qualified models, and supported reasoning resolve", () => {
  const ctx = context();
  for (const alias of [undefined, "auto", "inherit-parent"]) assert.deepEqual(resolveModel(alias, ctx), { model, thinkingLevel: "medium" });
  assert.equal(resolveModel(model.id, ctx).model, model);
  assert.equal(resolveModel(`${model.provider}/${model.id}:high`, ctx).thinkingLevel, "high");
});

test("missing defaults and unsupported reasoning report available choices", () => {
  assert.throws(() => resolveModel("grok-4.7-xhigh-fast", context()), /Unavailable.*setup-pstack/);
  assert.throws(() => resolveModel(`${model.id}:garbage`, context()), /Unknown thinking level/);
  const limited = { ...model, reasoning: false };
  const ctx = context({ model: limited, modelRegistry: { getAvailable: () => [limited] } as ExtensionContext["modelRegistry"] });
  assert.throws(() => resolveModel(`${model.id}:high`, ctx), /Supported thinking levels: off/);
  assert.equal(resolveModel(model.id, ctx).thinkingLevel, "off");
  assert.throws(() => resolveModel("auto", context({ model: undefined })), /No parent model/);
});

test("ambiguous IDs require a provider; exact IDs containing colons are retained", () => {
  const duplicate = { ...model, provider: "other-provider" };
  const colon = { ...model, id: "custom:model" };
  const ctx = context({ modelRegistry: { getAvailable: () => [model, duplicate, colon] } as ExtensionContext["modelRegistry"] });
  assert.throws(() => resolveModel(model.id, ctx), /Ambiguous/);
  assert.equal(resolveModel(`other-provider/${model.id}`, ctx).model, duplicate);
  assert.equal(resolveModel("custom:model", ctx).model, colon);
});

test("headless setup rejects without writes", async () => {
  await assert.rejects(setupModels(context()), /interactive or RPC dialog UI/);
});

function confirmedContext(confirmed: () => void) {
    const notices: string[] = [];
    const ctx = context({ hasUI: true, ui: ui({
      notify: (message) => { notices.push(message); },
      select: async (title, options) => {
        if (title.startsWith("pstack reasoning budget")) return "small — medium reasoning";
        if (title.startsWith("Accept model table")) return "Accept as-is";
        assert.ok(options.includes(`${model.provider}/${model.id}`));
        return `${model.provider}/${model.id}`;
      },
      input: async () => "auto, inherit-parent, auto",
      confirm: async () => {
        assert.match(await readModelRule(), /how critics: retired/);
        confirmed();
        return true;
      },
    }) });
  return { ctx, notices: () => notices.slice() };
}

test("setup confirms before writing all roles, preserves duplicate aliases, and drops retired roles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-models-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  try {
    assert.equal(await readModelRule(), "");
    await mkdir(dirname(modelConfigPath()), { recursive: true });
    await writeFile(modelConfigPath(), "---\nalwaysApply: true\n---\n# budget: unlimited (max)\narena runners: auto, auto, inherit-parent\nhow critics: retired\n");
    let confirmations = 0;
    const { ctx, notices } = confirmedContext(() => { confirmations++; });
    await setupModels(ctx);
    const result = await readFile(modelConfigPath(), "utf8");
    assert.equal(confirmations, 1);
    assert.match(result, /# budget: small \(medium\)/);
    assert.match(result, /arena runners: auto, auto, inherit-parent/);
    assert.doesNotMatch(result, /how critics/);
    const lines = result.split("\n").filter((line) => line && !line.startsWith("#") && !line.startsWith("---") && !line.startsWith("description:") && !line.startsWith("alwaysApply:"));
    assert.equal(lines.length, 17);
    assert.match(notices().join("\n"), /feature, refactoring[\s\S]*interrogate reviewers[\s\S]*Dropped retired roles:\nhow critics: retired/);
    assert.match(result, /:medium/);
    await setupModels(context({ hasUI: true, ui: ui({ select: async () => undefined }) }));
    assert.equal(await readModelRule(), result);
    let denied = false;
    await setupModels(context({ hasUI: true, ui: ui({
      select: async (title) => title.startsWith("pstack reasoning budget") ? "large — xhigh reasoning" : "Accept as-is",
      confirm: async () => { denied = true; return false; },
    }) }));
    assert.ok(denied);
    assert.equal(await readModelRule(), result);
    const floorModel = { ...model, thinkingLevelMap: { xhigh: null, max: null } };
    const floorContext = context({ hasUI: true, model: floorModel,
      modelRegistry: { getAvailable: () => [floorModel] } as ExtensionContext["modelRegistry"],
      ui: ui({
        select: async (title) => title.startsWith("pstack reasoning budget") ? "large — xhigh reasoning" : "Accept as-is",
        confirm: async () => true,
      }),
    });
    assert.equal(await setupModels(floorContext), true);
    const floored = await readModelRule();
    assert.match(floored, /# budget: large \(xhigh\)/);
    assert.match(floored, /:high/);
    assert.doesNotMatch(floored, /:xhigh/);
    assert.match(floored, /arena runners: auto, auto, inherit-parent/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

const allRoles = ["feature, refactoring", "bug-fix", "perf-issue", "hillclimb", "judgment and prose", "hardest tasks", "how explorer", "how explainer", "why investigators", "why synthesizer", "reflect tooling", "reflect judgment, divergent, synthesizer", "arena runners", "arena cross-judge pool", "swarm workers", "architect runners", "interrogate reviewers"];

function scriptedCustom(scripts: string[][], frames: string[][]) {
  return (async (factory: Function) => new Promise((resolve) => {
    const theme = { fg: (_color: string, text: string) => text, bold: (text: string) => text };
    const component = factory({ requestRender() {} }, theme, undefined, resolve);
    frames.push(component.render(80));
    for (const key of scripts.shift() ?? []) component.handleInput(key);
  })) as unknown as ExtensionContext["ui"]["custom"];
}

test("TUI setup pickers stay within a screen, filter by typing, and build ordered panels", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-models-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  const many = Array.from({ length: 200 }, (_, index) => ({ ...model, id: `m${index}` }));
  const scripts = [
    ["b", "u", "g", "-", "f", "i", "x", "\r"],
    ["m", "1", "7", "\r"],
    ["a", "r", "e", "n", "a", " ", "r", "u", "n", "n", "e", "r", "s", ":", "\r"],
    ["m", "1", "5", "0", "\r"],
    ["m", "4", "2", "\r"],
    ["F", "i", "n", "i", "s", "h", "\r"],
    ["\r"],
  ];
  const frames: string[][] = [];
  try {
    await mkdir(dirname(modelConfigPath()), { recursive: true });
    await writeFile(modelConfigPath(), allRoles.map((role) => `${role}: inherit-parent`).join("\n"));
    const ctx = context({ hasUI: true, mode: "tui", modelRegistry: { getAvailable: () => many } as ExtensionContext["modelRegistry"],
      ui: ui({
        select: async (title) => {
          if (title.startsWith("pstack reasoning budget")) return "small — medium reasoning";
          throw new Error(`Unexpected select: ${title.slice(0, 60)}`);
        },
        input: async (title) => { throw new Error(`Unexpected input: ${title.slice(0, 60)}`); },
        confirm: async () => true,
        custom: scriptedCustom(scripts, frames),
      }) });
    assert.equal(await setupModels(ctx), true);
    const result = await readModelRule();
    assert.match(result, /^bug-fix: anthropic\/m17:medium$/m);
    assert.match(result, /^arena runners: anthropic\/m150:medium, anthropic\/m42:medium$/m);
    assert.ok(frames.every((frame) => frame.length <= 20), `picker heights ${frames.map((frame) => frame.length).join(", ")}`);
    assert.match(frames[0]!.join("\n"), /Accept model table or change a role/);
    assert.match(frames[1]!.join("\n"), /bug-fix \(current: inherit-parent\)/);
    assert.match(frames[5]!.join("\n"), /arena runners seat 3\. Selected: anthropic\/m150:medium, anthropic\/m42:medium/);
    assert.deepEqual(scripts, []);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});

test("TUI accept list and confirm question fit on a 24-line screen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-models-"));
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = directory;
  const frames: string[][] = [];
  let confirmMessage = "";
  try {
    await mkdir(dirname(modelConfigPath()), { recursive: true });
    await writeFile(modelConfigPath(), allRoles.map((role) => `${role}: inherit-parent`).join("\n"));
    const ctx = context({ hasUI: true, mode: "tui", ui: ui({
      select: async (title) => {
        if (title.startsWith("pstack reasoning budget")) return "small — medium reasoning";
        throw new Error(`Unexpected select: ${title}`);
      },
      confirm: async (_title, message) => { confirmMessage = message ?? ""; return true; },
      custom: scriptedCustom([["\r"]], frames),
    }) });
    assert.equal(await setupModels(ctx), true);
    const accept = frames[0]!.join("\n");
    assert.match(accept, /Accept model table or change a role/);
    assert.match(accept, /bug-fix: inherit-parent/);
    assert.ok(frames[0]!.length <= 14, `accept picker height ${frames[0]!.length}`);
    assert.ok(confirmMessage.split("\n").length <= 4, confirmMessage);
    assert.match(confirmMessage, /models\.mdc/);
  } finally {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    await rm(directory, { recursive: true, force: true });
  }
});
