import {
  type AgentToolResult,
  type AgentToolUpdateCallback,
  createBashTool,
  createEditTool,
  createFindTool,
  createGrepTool,
  createLsTool,
  createReadTool,
  createWriteTool,
  type ExtensionAPI,
  type ToolDefinition,
} from '@earendil-works/pi-coding-agent';
import type { Static, TSchema } from 'typebox';
import { createGondolinBashOps } from './bash.ts';
import { createGondolinEditOps, createGondolinLsOps, createGondolinReadOps, createGondolinWriteOps } from './fs-operations.ts';
import { executeGondolinGrep } from './grep.ts';
import { GUEST_WORKSPACE } from './paths.ts';
import { createGondolinFindOps } from './search.ts';
import type { GondolinVm, Started } from './vm.ts';

type GuestRun<TParams extends TSchema, TDetails> = (started: Started, id: string, params: Static<TParams>, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback<TDetails> | undefined) => Promise<AgentToolResult<TDetails>>;

/** Keeps the local tool's name, schema, and prompt text, and runs each call in the session VM instead. */
const routeToGuest = <TParams extends TSchema, TDetails>(local: Omit<ToolDefinition<TParams, TDetails>, 'execute'>, guest: GondolinVm, run: GuestRun<TParams, TDetails>): ToolDefinition<TParams, TDetails> => ({
  ...local,
  execute: async (id, params, signal, onUpdate, ctx) => run(await guest.ensure(ctx), id, params, signal, onUpdate),
});

/** A built-in tool as its factory builds it: a definition's metadata plus an execute that needs no context. */
type BuiltinTool<TParams extends TSchema, TDetails> = Omit<ToolDefinition<TParams, TDetails>, 'execute'> & { execute: GuestRunTail<TParams, TDetails> };
type GuestRunTail<TParams extends TSchema, TDetails> = (id: string, params: Static<TParams>, signal?: AbortSignal, onUpdate?: AgentToolUpdateCallback<TDetails>) => Promise<AgentToolResult<TDetails>>;

/** Registers a built-in tool that keeps its host definition, and runs its guest copy, built over the VM's operations, on each call. */
function registerGuestTool<TParams extends TSchema, TDetails, TOperations>(
  pi: ExtensionAPI,
  guest: GondolinVm,
  create: (cwd: string, options?: { operations: TOperations }) => BuiltinTool<TParams, TDetails>,
  operationsFor: (started: Started) => TOperations,
  localCwd: string,
): void {
  pi.registerTool(routeToGuest(create(localCwd), guest, (started, ...call) => create(GUEST_WORKSPACE, { operations: operationsFor(started) }).execute(...call)));
}

/** Overrides the seven built-in file and shell tools so each call reaches the guest through the workspace mount. */
export function registerGuestTools(pi: ExtensionAPI, guest: GondolinVm, localCwd: string): void {
  registerGuestTool(pi, guest, createReadTool, ({ vm }) => createGondolinReadOps(vm, localCwd), localCwd);
  registerGuestTool(pi, guest, createWriteTool, ({ vm }) => createGondolinWriteOps(vm, localCwd), localCwd);
  registerGuestTool(pi, guest, createEditTool, ({ vm }) => createGondolinEditOps(vm, localCwd), localCwd);
  registerGuestTool(pi, guest, createBashTool, ({ vm, shellPath }) => createGondolinBashOps(vm, localCwd, shellPath), localCwd);
  registerGuestTool(pi, guest, createLsTool, ({ vm }) => createGondolinLsOps(vm, localCwd), localCwd);
  registerGuestTool(pi, guest, createFindTool, ({ vm }) => createGondolinFindOps(vm, localCwd), localCwd);
  pi.registerTool(routeToGuest(createGrepTool(localCwd), guest, ({ vm }, _id, params, signal) => executeGondolinGrep(vm, localCwd, params, signal)));
}
