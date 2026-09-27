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
      confirm: async (_title, message) => {
        assert.match(message, /interrogate reviewers/);
        assert.match(message, /feature, refactoring/);
        assert.match(await readModelRule(), /how critics: retired/);
        confirmed();
        return true;
      },
    }) });
  return { ctx, notices };
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
    assert.ok(notices.some((message) => message.includes("Dropped retired roles:\nhow critics: retired")));
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
