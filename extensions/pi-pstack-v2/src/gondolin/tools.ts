import type { VM } from '@earendil-works/gondolin';
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
import type { GondolinVm } from './vm.ts';

type GuestRun<TParams extends TSchema, TDetails> = (vm: VM, id: string, params: Static<TParams>, signal: AbortSignal | undefined, onUpdate: AgentToolUpdateCallback<TDetails> | undefined) => Promise<AgentToolResult<TDetails>>;

/** Keeps the local tool's name, schema, and prompt text, and runs each call in the session VM instead. */
const routeToGuest = <TParams extends TSchema, TDetails>(local: Omit<ToolDefinition<TParams, TDetails>, 'execute'>, guest: GondolinVm, run: GuestRun<TParams, TDetails>): ToolDefinition<TParams, TDetails> => ({
  ...local,
  execute: async (id, params, signal, onUpdate, ctx) => run(await guest.ensure(ctx), id, params, signal, onUpdate),
});

/** Overrides the seven built-in file and shell tools so each call reaches the guest through the workspace mount. */
export function registerGuestTools(pi: ExtensionAPI, guest: GondolinVm, localCwd: string): void {
  pi.registerTool(routeToGuest(createReadTool(localCwd), guest, (vm, ...call) => createReadTool(GUEST_WORKSPACE, { operations: createGondolinReadOps(vm, localCwd) }).execute(...call)));
  pi.registerTool(routeToGuest(createWriteTool(localCwd), guest, (vm, ...call) => createWriteTool(GUEST_WORKSPACE, { operations: createGondolinWriteOps(vm, localCwd) }).execute(...call)));
  pi.registerTool(routeToGuest(createEditTool(localCwd), guest, (vm, ...call) => createEditTool(GUEST_WORKSPACE, { operations: createGondolinEditOps(vm, localCwd) }).execute(...call)));
  pi.registerTool(routeToGuest(createBashTool(localCwd), guest, (vm, ...call) => createBashTool(GUEST_WORKSPACE, { operations: createGondolinBashOps(vm, localCwd, guest.shellPath()) }).execute(...call)));
  pi.registerTool(routeToGuest(createLsTool(localCwd), guest, (vm, ...call) => createLsTool(GUEST_WORKSPACE, { operations: createGondolinLsOps(vm, localCwd) }).execute(...call)));
  pi.registerTool(routeToGuest(createFindTool(localCwd), guest, (vm, ...call) => createFindTool(GUEST_WORKSPACE, { operations: createGondolinFindOps(vm, localCwd) }).execute(...call)));
  pi.registerTool(routeToGuest(createGrepTool(localCwd), guest, (vm, _id, params, signal) => executeGondolinGrep(vm, localCwd, params, signal)));
}
