/**
 * A fake Pi host for the subagent extension: it records what the extension registers, then lets a test do what Pi does
 * with it, which is call the tool, fire lifecycle events, and render the tool's calls and results to text.
 */
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { Theme } from '@earendil-works/pi-coding-agent';
import type { Component } from '@earendil-works/pi-tui';
import { afterEach, beforeEach, vi } from 'vitest';
import subagentExtension from '../src/subagent/index.ts';
import { SUBAGENT_TEST_TIMEOUT_MS, says } from './subagent-child-output.ts';
import { fakePi } from './subagent-fake-pi.ts';

vi.setConfig({ testTimeout: SUBAGENT_TEST_TIMEOUT_MS });

const WIDTH = 400;
const ESCAPE_CODE = 27;
const ANSI = new RegExp(`${String.fromCharCode(ESCAPE_CODE)}\\[[0-9;]*m`, 'g');

type Handler = (event: never, ctx: never) => unknown;
type Content = { type: string; text?: string };
export type ToolResult = { content: Content[]; details?: { mode: string; results: { status: string; step?: number; agent: string; messages: unknown[] }[]; isError: boolean } };
export type Update = (partial: ToolResult) => void;
type Tool = {
  name: string;
  description: string;
  parameters: unknown;
  execute: (id: string, params: unknown, signal: AbortSignal | undefined, onUpdate: Update | undefined, ctx: unknown) => Promise<ToolResult>;
  renderCall: (args: unknown, theme: Theme) => Component;
  renderResult: (result: unknown, options: { expanded: boolean }, theme: Theme) => Component;
};
export type Sent = { message: { customType: string; content: string; display: boolean }; options: unknown };
export type Settled = { entries: { type: string; customType: string; content: string }[]; continue: boolean } | undefined;

/** Draws text as plain words, which is what a person reads whatever the colors. */
const plainTheme = { fg: (_color: string, value: string) => value, bold: (value: string) => value } as unknown as Theme;

/** Shows each colored word as `<role:text>`, so a test can see which roles Pi would color with. */
const roleTheme = { fg: (color: string, value: string) => `<${color}:${value}>`, bold: (value: string) => value } as unknown as Theme;

export interface Workspace {
  readonly root: string;
  readonly project: string;
  readonly userAgents: string;
}

/** A temp project and a temp Pi agent dir, which `PI_CODING_AGENT_DIR` points the extension at. */
function createWorkspace(): Workspace {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'subagent-')));
  const project = path.join(root, 'project');
  fs.mkdirSync(project, { recursive: true });
  vi.stubEnv('PI_CODING_AGENT_DIR', path.join(root, 'agent'));
  return { root, project, userAgents: path.join(root, 'agent', 'agents') };
}

/** Gives every test its own workspace and a fake Pi whose children answer "done" until the test scripts them. */
export function useWorkspace(): () => Workspace {
  let current: Workspace | undefined;
  beforeEach(async () => {
    current = createWorkspace();
    await fakePi.start(current.root);
    fakePi.onChild(says('done'));
  });
  afterEach(async () => {
    await fakePi.stop();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    fs.rmSync((current as Workspace).root, { recursive: true, force: true });
  });
  return () => current as Workspace;
}

/** Writes `<dir>/<name>.md` as an agent definition and returns its path. `frontmatter` adds lines after name and description. */
export function writeAgent(dir: string, name: string, frontmatter = '', body = 'Be helpful.'): string {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${name}.md`);
  fs.writeFileSync(file, `---\nname: ${name}\ndescription: ${name} agent\n${frontmatter}---\n${body}\n`);
  return file;
}

export interface CtxOptions {
  readonly mode?: string;
  readonly hasUI?: boolean;
  readonly trusted?: boolean;
  readonly model?: { provider: string; id: string };
  readonly thinkingLevel?: string;
  readonly confirm?: (title: string, message: string) => Promise<boolean>;
}

/** The context Pi passes a tool: where it runs, the session model, and whether a person can be asked. */
export const makeCtx = (cwd: string, options: CtxOptions = {}): unknown => ({
  cwd,
  mode: options.mode ?? 'print',
  hasUI: options.hasUI ?? false,
  model: options.model,
  thinkingLevel: options.thinkingLevel,
  isProjectTrusted: () => options.trusted ?? true,
  ui: { confirm: options.confirm ?? (async () => true) },
});

export const textOf = (result: ToolResult): string => result.content.map((part) => part.text ?? '').join('\n');

/** The lines a component draws, without color codes, right-trimmed. */
export const draw = (component: Component): string =>
  component
    .render(WIDTH)
    .map((line) => line.trimEnd())
    .join('\n')
    .replace(ANSI, '');

export function loadSubagent() {
  let tool: Tool | undefined;
  let handlers: Readonly<Record<string, Handler>> = {};
  let sent: readonly Sent[] = [];
  const api = {
    on: (event: string, handler: Handler) => {
      handlers = { ...handlers, [event]: handler };
    },
    registerTool: (registered: Tool) => {
      tool = registered;
    },
    sendMessage: (message: Sent['message'], options: unknown) => {
      sent = [...sent, { message, options }];
    },
  };
  subagentExtension(api as never);
  const registered = tool as Tool;
  return {
    tool: registered,
    call: (params: unknown, ctx: unknown, signal?: AbortSignal, onUpdate?: Update) => registered.execute('call', params, signal, onUpdate, ctx),
    renderCall: (args: unknown) => draw(registered.renderCall(args, plainTheme)),
    renderResult: (result: unknown, expanded = false) => draw(registered.renderResult(result, { expanded }, plainTheme)),
    renderResultWithRoles: (result: unknown) => draw(registered.renderResult(result, { expanded: false }, roleTheme)),
    fire: (event: string, payload: unknown, ctx: unknown): unknown => (handlers[event] as unknown as (e: unknown, c: unknown) => unknown)(payload, ctx),
    sent: (): readonly Sent[] => sent,
  };
}
