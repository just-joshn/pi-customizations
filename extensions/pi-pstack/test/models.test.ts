import { mkdtemp, readFile, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, vi } from "vitest";
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
  for (const alias of [undefined, "auto", "inherit-parent"]) expect(resolveModel(alias, ctx)).toEqual({ model, thinkingLevel: "medium" });
  expect(resolveModel(model.id, ctx).model).toBe(model);
  expect(resolveModel(`${model.provider}/${model.id}:high`, ctx).thinkingLevel).toBe("high");
});

test("missing defaults and unsupported reasoning report available choices", () => {
  expect(() => resolveModel("grok-4.7-xhigh-fast", context())).toThrow(/Unavailable.*setup-pstack/);
  expect(() => resolveModel(`${model.id}:garbage`, context())).toThrow(/Unknown thinking level/);
  const limited = { ...model, reasoning: false };
  const ctx = context({ model: limited, modelRegistry: { getAvailable: () => [limited] } as ExtensionContext["modelRegistry"] });
  expect(() => resolveModel(`${model.id}:high`, ctx)).toThrow(/Supported thinking levels: off/);
  expect(resolveModel(model.id, ctx).thinkingLevel).toBe("off");
  expect(() => resolveModel("auto", context({ model: undefined }))).toThrow(/No parent model/);
});

test("ambiguous IDs require a provider; exact IDs containing colons are retained", () => {
  const duplicate = { ...model, provider: "other-provider" };
  const colon = { ...model, id: "custom:model" };
  const ctx = context({ modelRegistry: { getAvailable: () => [model, duplicate, colon] } as ExtensionContext["modelRegistry"] });
  expect(() => resolveModel(model.id, ctx)).toThrow(/Ambiguous/);
  expect(resolveModel(`other-provider/${model.id}`, ctx).model).toBe(duplicate);
  expect(resolveModel("custom:model", ctx).model).toBe(colon);
});

test("headless setup rejects without writes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-models-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  try {
    await expect(setupModels(context())).rejects.toThrow(/interactive or RPC dialog UI/);
    await expect(readFile(modelConfigPath(), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

function confirmedContext(confirmed: () => void) {
  const notices: string[] = [];
  const ctx = context({ hasUI: true, ui: ui({
    notify: (message) => { notices.push(message); },
    select: async (title, options) => {
      if (title.startsWith("pstack reasoning budget")) return "small — medium reasoning";
      if (title.startsWith("Accept model table")) return "Accept as-is";
      expect(options.includes(`${model.provider}/${model.id}`)).toBe(true);
      return `${model.provider}/${model.id}`;
    },
    input: async () => "auto, inherit-parent, auto",
    confirm: async () => {
      expect(await readModelRule()).toMatch(/how critics: retired/);
      confirmed();
      return true;
    },
  }) });
  return { ctx, notices: () => notices.slice() };
}

test("setup confirms before writing all roles, preserves duplicate aliases, and drops retired roles", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-models-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  try {
    expect(await readModelRule()).toBe("");
    await mkdir(dirname(modelConfigPath()), { recursive: true });
    await writeFile(modelConfigPath(), "---\nalwaysApply: true\n---\n# budget: unlimited (max)\narena runners: auto, auto, inherit-parent\nhow critics: retired\n");
    let confirmations = 0;
    const { ctx, notices } = confirmedContext(() => { confirmations++; });
    await setupModels(ctx);
    const result = await readFile(modelConfigPath(), "utf8");
    expect(confirmations).toBe(1);
    expect(result).toMatch(/# budget: small \(medium\)/);
    expect(result).toMatch(/arena runners: auto, auto, inherit-parent/);
    expect(result).not.toMatch(/how critics/);
    const lines = result.split("\n").filter((line) => line && !line.startsWith("#") && !line.startsWith("---") && !line.startsWith("description:") && !line.startsWith("alwaysApply:"));
    expect(lines.length).toBe(17);
    expect(notices().join("\n")).toMatch(/feature, refactoring[\s\S]*interrogate reviewers[\s\S]*Dropped retired roles:\nhow critics: retired/);
    expect(result).toMatch(/:medium/);
    expect(await setupModels(context({ hasUI: true, ui: ui({ select: async () => undefined }) }))).toBe(false);
    expect(await readModelRule()).toBe(result);
    let denied = false;
    await setupModels(context({ hasUI: true, ui: ui({
      select: async (title) => title.startsWith("pstack reasoning budget") ? "large — xhigh reasoning" : "Accept as-is",
      confirm: async () => { denied = true; return false; },
    }) }));
    expect(denied).toBe(true);
    expect(await readModelRule()).toBe(result);
    const floorModel = { ...model, thinkingLevelMap: { xhigh: null, max: null } };
    const floorContext = context({ hasUI: true, model: floorModel,
      modelRegistry: { getAvailable: () => [floorModel] } as ExtensionContext["modelRegistry"],
      ui: ui({
        select: async (title) => title.startsWith("pstack reasoning budget") ? "large — xhigh reasoning" : "Accept as-is",
        confirm: async () => true,
      }),
    });
    expect(await setupModels(floorContext)).toBe(true);
    const floored = await readModelRule();
    expect(floored).toMatch(/# budget: large \(xhigh\)/);
    expect(floored).toMatch(/:high/);
    expect(floored).not.toMatch(/:xhigh/);
    expect(floored).toMatch(/arena runners: auto, auto, inherit-parent/);
  } finally {
    vi.unstubAllEnvs();
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
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
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
    expect(await setupModels(ctx)).toBe(true);
    const result = await readModelRule();
    expect(result).toMatch(/^bug-fix: anthropic\/m17:medium$/m);
    expect(result).toMatch(/^arena runners: anthropic\/m150:medium, anthropic\/m42:medium$/m);
    expect(frames.every((frame) => frame.length <= 20)).toBe(true);
    expect(frames[0]!.join("\n")).toMatch(/Accept model table or change a role/);
    expect(frames[1]!.join("\n")).toMatch(/bug-fix \(current: inherit-parent\)/);
    expect(frames[5]!.join("\n")).toMatch(/arena runners seat 3\. Selected: anthropic\/m150:medium, anthropic\/m42:medium/);
    expect(scripts).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

test("TUI accept list and confirm question fit on a 24-line screen", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-models-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
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
    expect(await setupModels(ctx)).toBe(true);
    const accept = frames[0]!.join("\n");
    expect(accept).toMatch(/Accept model table or change a role/);
    expect(accept).toMatch(/bug-fix: inherit-parent/);
    expect(frames[0]!.length <= 14).toBe(true);
    expect(confirmMessage.split("\n").length <= 4).toBe(true);
    expect(confirmMessage).toMatch(/models\.mdc/);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

test("pick delegates to ui.select outside of TUI mode", async () => {
  const { pick } = await import("../src/picker.ts");
  const ctx = {
    mode: "print",
    ui: {
      select: async (title: string, options: string[]) => `selected:${title}:${options.join(",")}`,
    },
  } as unknown as ExtensionContext;
  const result = await pick(ctx, "Pick model", ["m1", "m2"]);
  expect(result).toBe("selected:Pick model:m1,m2");
});

test("pick in TUI mode handles focus, render, and cancellation", async () => {
  const { pick } = await import("../src/picker.ts");
  let widgetInstance: { focused: boolean; render: (w: number) => string[]; invalidate: () => void; handleInput: (key: string) => void } | undefined;
  const ctx = {
    mode: "tui",
    ui: {
      custom: (factory: Function) => new Promise((resolve) => {
        const theme = { fg: (_c: string, t: string) => t, bold: (t: string) => t };
        widgetInstance = factory({ requestRender() {} }, theme, undefined, resolve);
        widgetInstance!.focused = true;
        expect(widgetInstance!.focused).toBe(true);
        expect(widgetInstance!.render(80)[0]).toBe("Pick model");
        expect(widgetInstance!.render(80).join("\n")).toContain("m1");
        widgetInstance!.invalidate();
        widgetInstance!.handleInput("\x1b");
      }),
    },
  } as unknown as ExtensionContext;
  const result = await pick(ctx, "Pick model", ["m1", "m2"]);
  expect(result).toBeUndefined();
});

test("setupModels with unlimited budget preserves existing model strings without target", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-unlimited-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  try {
    await mkdir(dirname(modelConfigPath()), { recursive: true });
    await writeFile(modelConfigPath(), allRoles.map((role) => `${role}: inherit-parent`).join("\n"));
    const ctx = context({
      hasUI: true,
      ui: ui({
        select: async (title) => {
          if (title.startsWith("pstack reasoning budget")) return "unlimited — keep max";
          return "Accept as-is";
        },
        confirm: async () => true,
      }),
    });
    expect(await setupModels(ctx)).toBe(true);
    const result = await readModelRule();
    expect(result).toMatch(/# budget: unlimited \(max\)/);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

test("setupModels replaces a role line that lists more than one model", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-models-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  try {
    await mkdir(dirname(modelConfigPath()), { recursive: true });
    await writeFile(modelConfigPath(), allRoles.map((role) => role === "bug-fix" ? `${role}: auto, auto` : `${role}: inherit-parent`).join("\n"));
    const notices: string[] = [];
    const ctx = context({ hasUI: true, mode: "rpc", ui: ui({
      select: async (title) => title.startsWith("Accept model table") ? "Accept as-is" : title.startsWith("pstack reasoning budget") ? "small — medium reasoning" : "auto",
      input: async (title) => { throw new Error(`Unexpected input: ${title}`); },
      notify: (message) => { notices.push(message); },
      confirm: async () => true,
    }) });
    expect(await setupModels(ctx)).toBe(true);
    expect(notices[0]).toMatch(/bug-fix: auto, auto \[needs a choice\]/);
    expect(await readModelRule()).toMatch(/^bug-fix: auto$/m);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

test("editRole reports an empty model selection under the unlimited budget", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-models-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  try {
    await mkdir(dirname(modelConfigPath()), { recursive: true });
    await writeFile(modelConfigPath(), allRoles.map((role) => `${role}: inherit-parent`).join("\n"));
    const inputs = ["", "auto, auto"];
    const selects = ["unlimited — keep max", "arena runners", "Accept as-is"];
    const errors: string[] = [];
    const ctx = context({ hasUI: true, mode: "rpc", ui: ui({
      select: async () => selects.shift(),
      input: async () => inputs.shift(),
      notify: (message, level) => { if (level === "error") errors.push(message); },
      confirm: async () => true,
    }) });
    expect(await setupModels(ctx)).toBe(true);
    expect(errors).toEqual(["Error: Empty model selection."]);
    expect(await readModelRule()).toMatch(/^arena runners: auto, auto$/m);
    expect(selects).toEqual([]);
    expect(inputs).toEqual([]);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

test("cancelling the seat picker leaves the model rule unchanged", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-models-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  const frames: string[][] = [];
  try {
    await mkdir(dirname(modelConfigPath()), { recursive: true });
    const original = allRoles.map((role) => role === "arena runners" ? `${role}: invalid_model` : `${role}: inherit-parent`).join("\n");
    await writeFile(modelConfigPath(), original);
    const ctx = context({ hasUI: true, mode: "tui", ui: ui({
      select: async (title) => {
        if (title.startsWith("pstack reasoning budget")) return "small — medium reasoning";
        throw new Error(`Unexpected select: ${title}`);
      },
      confirm: async () => false,
      custom: scriptedCustom([["\x1b"]], frames),
    }) });
    expect(await setupModels(ctx)).toBe(false);
    expect(frames[0]!.join("\n")).toMatch(/arena runners seat 1/);
    expect(await readModelRule()).toBe(original);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

test("a model with no level at or below the target is reported", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-models-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  try {
    const highOnly = { ...model, thinkingLevelMap: { off: null, minimal: null, low: null, medium: null } };
    await mkdir(dirname(modelConfigPath()), { recursive: true });
    await writeFile(modelConfigPath(), allRoles.map((role) => role === "bug-fix" ? `${role}: ${highOnly.provider}/${highOnly.id}` : `${role}: inherit-parent`).join("\n"));
    const selects = ["small — medium reasoning", `${highOnly.provider}/${highOnly.id}`, "inherit-parent", "Accept as-is"];
    const errors: string[] = [];
    const ctx = context({ hasUI: true, mode: "rpc", model: highOnly,
      modelRegistry: { getAvailable: () => [highOnly] } as ExtensionContext["modelRegistry"],
      ui: ui({
        select: async () => selects.shift(),
        notify: (message, level) => { if (level === "error") errors.push(message); },
        confirm: async () => true,
      }) });
    expect(await setupModels(ctx)).toBe(true);
    expect(errors).toEqual([`Error: No supported thinking level at or below medium for ${highOnly.provider}/${highOnly.id}.`]);
    expect(await readModelRule()).toMatch(/^bug-fix: inherit-parent$/m);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});

test("setupModels non-TUI mode edits single and panel roles, handles needsChoice and empty model error", async () => {
  const directory = await mkdtemp(join(tmpdir(), "pstack-nontui-"));
  vi.stubEnv("PI_CODING_AGENT_DIR", directory);
  try {
    await mkdir(dirname(modelConfigPath()), { recursive: true });
    await writeFile(modelConfigPath(), allRoles.map((role) => role === "bug-fix" ? `${role}: invalid_model` : `${role}: inherit-parent`).join("\n"));
    const inputs = ["", "auto, auto"];
    const selects = ["small — medium reasoning", "auto", "arena runners", "Accept as-is"];
    const notifiedErrors: string[] = [];
    const ctx = context({
      hasUI: true,
      mode: "rpc",
      ui: ui({
        select: async () => selects.shift(),
        input: async () => inputs.shift(),
        notify: (msg, level) => { if (level === "error") notifiedErrors.push(msg); },
        confirm: async () => true,
      }),
    });
    expect(await setupModels(ctx)).toBe(true);
    expect(notifiedErrors[0]).toMatch(/Unavailable model ''/);
    expect(await readModelRule()).toMatch(/^arena runners: auto, auto$/m);
  } finally {
    vi.unstubAllEnvs();
    await rm(directory, { recursive: true, force: true });
  }
});
