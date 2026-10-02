import { expect, test } from 'vitest';
import { childToolPolicy, permissionBody, permissionTitle, type RelayDeps, relayUiRequest, requestedTool } from '../src/subagents/permission-relay.ts';
import type { RpcRecord } from '../src/subagents/rpc-child.ts';

const allowed = ['read', 'grep', 'edit', 'write', 'bash'];

test.for([
  { mode: 'plan', tools: ['read', 'grep'], approve: [] },
  { mode: 'bypassPermissions', tools: allowed, approve: [] },
  { mode: 'dontAsk', tools: allowed, approve: [] },
  { mode: 'auto', tools: allowed, approve: [] },
  { mode: 'acceptEdits', tools: allowed, approve: ['bash'] },
  { mode: 'default', tools: allowed, approve: ['edit', 'write', 'bash'] },
  { mode: undefined, tools: allowed, approve: ['edit', 'write', 'bash'] },
])('tool policy in $mode mode', ({ mode, tools, approve }) => {
  expect(childToolPolicy(allowed, mode)).toEqual({ tools, approve });
});

test('a permission title round-trips to the requested tool', () => {
  expect(permissionTitle('bash')).toBe('pstack-permission:bash');
  expect(requestedTool(permissionTitle('bash'))).toBe('bash');
});

test('a title without the permission prefix requests no tool', () => {
  expect([requestedTool('Pick a file'), requestedTool(undefined), requestedTool(42), requestedTool('pstack-permission:')]).toEqual([undefined, undefined, undefined, '']);
});

test('a permission body shows the tool with its JSON input', () => {
  expect(permissionBody('bash', { command: 'ls' })).toBe('bash {"command":"ls"}');
  expect(permissionBody('bash', undefined)).toBe('bash ');
});

test('a permission body is cut at 2000 characters', () => {
  expect(permissionBody('write', { text: 'x'.repeat(5000) })).toHaveLength(2000);
});

type Reply = Readonly<Record<string, unknown>>;

function relayHarness(answer: () => Promise<boolean>) {
  const replies: { id: string; response: Reply }[] = [];
  const asks: { title: string; body: string }[] = [];
  const child = {
    respond: (id: string, response: Reply) => {
      replies.push({ id, response });
    },
  };
  const deps: RelayDeps = {
    label: 'teammate scout',
    allowedToolNames: new Set(['bash']),
    ask: async (title, body) => {
      asks.push({ title, body });
      return answer();
    },
  };
  return { child, deps, replies, asks };
}

const ask = (fields: Reply): RpcRecord => ({ type: 'extension_ui_request', id: 'ui-1', method: 'confirm', title: permissionTitle('bash'), message: 'ls -la', ...fields });

test.for([{ confirmed: true }, { confirmed: false }])('an allowed tool ask relays the parent answer $confirmed', async ({ confirmed }) => {
  const { child, deps, replies, asks } = relayHarness(async () => confirmed);

  await relayUiRequest(child, ask({}), deps);

  expect(asks).toEqual([{ title: 'teammate scout wants to use bash', body: 'ls -la' }]);
  expect(replies).toEqual([{ id: 'ui-1', response: { confirmed } }]);
});

test('a parent that fails to answer denies the tool', async () => {
  const { child, deps, replies } = relayHarness(() => Promise.reject(new Error('parent closed')));

  await relayUiRequest(child, ask({ message: undefined }), deps);

  expect(replies).toEqual([{ id: 'ui-1', response: { confirmed: false } }]);
});

test.for([
  { name: 'a tool outside the allowed set', fields: { title: permissionTitle('curl') } },
  { name: 'an ordinary dialog title', fields: { title: 'Choose a branch' } },
  { name: 'no title', fields: { title: undefined } },
])('$name is cancelled without asking the parent', async ({ fields }) => {
  const { child, deps, replies, asks } = relayHarness(async () => true);

  await relayUiRequest(child, ask(fields), deps);

  expect(asks).toEqual([]);
  expect(replies).toEqual([{ id: 'ui-1', response: { cancelled: true } }]);
});

test.for([
  { name: 'a notification method', fields: { method: 'notify' } },
  { name: 'a missing id', fields: { id: undefined } },
  { name: 'a missing method', fields: { method: undefined } },
])('$name gets no reply', async ({ fields }) => {
  const { child, deps, replies, asks } = relayHarness(async () => true);

  await relayUiRequest(child, ask(fields), deps);

  expect([replies, asks]).toEqual([[], []]);
});
