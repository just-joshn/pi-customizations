import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { parseDuration, parseLoopArgs } from '../src/loop.ts';
import { contentText, makeSandbox, type PiEvent, runJson, type Sandbox, startRpc, toolEnds } from './e2e/harness.ts';

describe('parseDuration', () => {
  test.for([
    { text: '30s', ms: 30_000 },
    { text: '5m', ms: 300_000 },
    { text: '1h', ms: 3_600_000 },
    { text: '1h30m', ms: 5_400_000 },
    { text: '2d', ms: 172_800_000 },
  ])('$text is $ms ms', ({ text, ms }) => {
    expect(parseDuration(text)).toBe(ms);
  });

  test('rejects intervals past the 24-day timer limit instead of firing at once (review: security 2)', () => {
    expect([parseLoopArgs('25d tick'), parseLoopArgs('24d tick')]).toEqual([
      { kind: 'error', message: 'Loop intervals can be at most 24d.' },
      { kind: 'start', prompt: 'tick', intervalMs: 2_073_600_000 },
    ]);
  });

  test.for(['5', 'm5', '0s', '1x', '90'])('treats %j as the start of the prompt, not an interval', (text) => {
    expect(parseLoopArgs(`${text} tick`)).toEqual({ kind: 'start', prompt: `${text} tick` });
  });
});

describe('parseLoopArgs (HOST-004)', () => {
  test.for([
    { args: '', expected: { kind: 'status' } },
    { args: 'stop', expected: { kind: 'stop' } },
    { args: 'off', expected: { kind: 'stop' } },
    { args: '1h run the audit tick', expected: { kind: 'start', intervalMs: 3_600_000, prompt: 'run the audit tick' } },
    { args: 'check CI until green', expected: { kind: 'start', prompt: 'check CI until green' } },
    { args: '10m', expected: { kind: 'error', message: '/loop needs a prompt: /loop [interval] <prompt>' } },
  ])('reads "$args"', ({ args, expected }) => {
    expect(parseLoopArgs(args)).toEqual(expected);
  });
});

describe('/loop through Pi (HOST-004)', () => {
  let sandbox: Sandbox;
  beforeEach(() => {
    sandbox = makeSandbox();
  });
  afterEach(() => sandbox.dispose());

  const users = (events: PiEvent[]) => events.filter((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'user').map((event) => contentText((event['message'] as { content: string }).content));

  const replies = (events: PiEvent[]) =>
    events.filter((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant').map((event) => contentText((event['message'] as { content: { type: string; text?: string }[] }).content));
  const loopSection = (prompt: string | undefined) => /<pstack_loop>\n([\s\S]*?)\n<\/pstack_loop>/.exec(prompt ?? '')?.[1];

  test('a fixed interval repeats the prompt verbatim, with loop state in the system prompt, until /loop stop', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({ type: 'prompt', message: '/loop 1s tick\n@@sys' });
      await rpc.waitFor(() => replies(rpc.events).length >= 2, 15_000);
      expect(users(rpc.events).slice(0, 2)).toEqual(['tick\n@@sys', 'tick\n@@sys']);
      expect(replies(rpc.events).slice(0, 2).map(loopSection)).toEqual([
        'A /loop is running: iteration 1, every 1s. The user ends it with /loop stop; call the Loop tool with stop: true once the goal is met.',
        'A /loop is running: iteration 2, every 1s. The user ends it with /loop stop; call the Loop tool with stop: true once the goal is met.',
      ]);
      rpc.send({ id: 'stop', type: 'prompt', message: '/loop stop' });
      await rpc.waitFor((event) => event['id'] === 'stop');
      const count = users(rpc.events).length;
      const afterStop = rpc.events.length;
      await rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'notify' && String(event['message']).startsWith('Loop stopped'));
      expect(rpc.events.slice(afterStop).filter((event) => event.type === 'agent_start')).toEqual([]);
      expect(users(rpc.events)).toHaveLength(count);
    } finally {
      await rpc.close();
    }
  });

  test('an agent-paced loop tells the model to pick the next wake', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({ type: 'prompt', message: '/loop look\n@@sys' });
      const [prompt] = await rpc.waitFor(() => replies(rpc.events).length >= 1).then(() => replies(rpc.events));
      expect(loopSection(prompt)).toBe('A /loop is running: iteration 1, agent-paced. Call the Loop tool with wake_in (like 10m) to schedule the next run, or stop: true to end it. Without a wake_in call the loop ends after this turn.');
    } finally {
      await rpc.close();
    }
  });

  test('without an interval the agent picks each wake, and the loop ends when it picks none', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({ type: 'prompt', message: '/loop poll\n@@loop-until 2' });
      const notice = await rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'notify' && String(event['message']).startsWith('Loop stopped'), 15_000);
      expect(notice['message']).toBe('Loop stopped: the agent scheduled no next wake.');
      expect(users(rpc.events)).toEqual(['poll\n@@loop-until 2', 'poll\n@@loop-until 2']);
    } finally {
      await rpc.close();
    }
  });

  test('a loop prompt that names a skill attaches the skill on every iteration', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({ type: 'prompt', message: '/loop 1s /ketchup now\n@@say TICK' });
      await rpc.waitFor(() => users(rpc.events).length >= 2, 15_000);
      rpc.send({ id: 'stop', type: 'prompt', message: '/loop stop' });
      await rpc.waitFor((event) => event['id'] === 'stop');
      expect(
        users(rpc.events)
          .slice(0, 2)
          .map((text) => [text.startsWith('<skill name="ketchup"'), text.endsWith('</skill>\n\nnow\n@@say TICK')]),
      ).toEqual([
        [true, true],
        [true, true],
      ]);
    } finally {
      await rpc.close();
    }
  });

  test('the agent can arm a loop itself, as pstack playbooks tell it to (review: parity 1)', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({ type: 'prompt', message: 'arm it\n@@script [{"tool":"Loop","args":{"prompt":"tick\\n@@say TICK","interval":"1s"}}]' });
      await rpc.waitFor(() => users(rpc.events).includes('tick\n@@say TICK'), 15_000);
      rpc.send({ id: 'stop', type: 'prompt', message: '/loop stop' });
      await rpc.waitFor((event) => event['id'] === 'stop');
      const armed = toolEnds(rpc.events, 'Loop').map((end) => end.text);
      expect([armed[0], users(rpc.events).slice(0, 2)]).toEqual([
        'Loop armed: "tick\n@@say TICK" every 1s; the first run starts 1s after this turn ends.',
        ['arm it\n@@script [{"tool":"Loop","args":{"prompt":"tick\\n@@say TICK","interval":"1s"}}]', 'tick\n@@say TICK'],
      ]);
    } finally {
      await rpc.close();
    }
  });

  test('a new wake_in replaces a wake that is already scheduled (review r2: parity 2)', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({ type: 'prompt', message: 'arm\n@@script [{"tool":"Loop","args":{"prompt":"tick\\n@@say TICK","wake_in":"60s"}}]' });
      await rpc.waitFor((event) => event.type === 'agent_settled');
      rpc.send({ type: 'prompt', message: 'sooner\n@@script [{"tool":"Loop","args":{"wake_in":"1s"}}]' });
      await rpc.waitFor(() => users(rpc.events).includes('tick\n@@say TICK'), 10_000);
      expect(toolEnds(rpc.events, 'Loop').map((end) => end.text)).toEqual(['Loop armed: "tick\n@@say TICK", agent-paced; the first run starts 1m after this turn ends.', 'Next loop run in 1s, after this turn ends.']);
    } finally {
      await rpc.close();
    }
  });

  test('the agent ends a loop with Loop {stop: true} (HOST-004)', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({ type: 'prompt', message: '/loop 1s done\n@@script [{"tool":"Loop","args":{"stop":true}}]' });
      const stopped = await rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'notify' && String(event['message']).startsWith('Loop stopped'), 15_000);
      await rpc.waitFor((event) => event.type === 'agent_settled');
      rpc.send({ type: 'prompt', message: '/loop' });
      const status = await rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'notify' && rpc.events.indexOf(event) > rpc.events.indexOf(stopped));
      expect([stopped['message'], status['message'], users(rpc.events)]).toEqual(['Loop stopped: the agent ended it.', 'No loop is running.', ['done\n@@script [{"tool":"Loop","args":{"stop":true}}]']]);
    } finally {
      await rpc.close();
    }
  });

  test('an agent-paced loop waits for background subagents instead of ending (review: parity 1)', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({ type: 'prompt', message: '/loop work\n@@script [{"tool":"Task","args":{"description":"bg","prompt":"go\\n@@sleep 1500 BG","run_in_background":true}}]' });
      const stopped = await rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'notify' && String(event['message']).startsWith('Loop stopped'), 20_000);
      const notification = rpc.events.findIndex((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'custom');
      expect([notification > 0, rpc.events.indexOf(stopped) > notification, stopped['message']]).toEqual([true, true, 'Loop stopped: the agent scheduled no next wake.']);
    } finally {
      await rpc.close();
    }
  });

  test('aborting a loop run stops the loop (review: architecture)', async () => {
    const rpc = startRpc(sandbox, ['--no-session']);
    try {
      rpc.send({ type: 'prompt', message: '/loop 1s slow\n@@sleep 3000 SLOW' });
      await rpc.waitFor((event) => event.type === 'agent_start');
      rpc.send({ type: 'abort' });
      const stopped = await rpc.waitFor((event) => event.type === 'extension_ui_request' && event['method'] === 'notify' && String(event['message']).startsWith('Loop stopped'), 15_000);
      expect(stopped['message']).toBe('Loop stopped: the run was aborted.');
    } finally {
      await rpc.close();
    }
  });

  test('one-shot runs, including subagents, do not offer the Loop tool (recheck 2)', async () => {
    const run = await runJson(sandbox, 'tools\n@@tools-list', ['--no-session']);
    const tools = run.events
      .filter((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant')
      .map((event) => contentText((event['message'] as { content: { type: string; text?: string }[] }).content));
    expect(tools[0]?.split(',').filter((name) => name === 'Loop' || name === 'Task')).toEqual(['Task']);
  });

  test('naming Loop in --tools does not bring it back in a one-shot run (recheck 2)', async () => {
    const run = await runJson(sandbox, 'tools\n@@tools-list', ['--no-session', '--tools', 'read,Loop,TodoWrite']);
    const [tools] = run.events
      .filter((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant')
      .map((event) => contentText((event['message'] as { content: { type: string; text?: string }[] }).content));
    expect(tools?.split(',').toSorted()).toEqual(['TodoWrite', 'read']);
  });

  test('print and JSON runs refuse /loop because the process exits', async () => {
    const run = await runJson(sandbox, '/loop 1m tick', ['--no-session']);
    expect(run.events.filter((event) => event.type === 'agent_start')).toEqual([]);
    expect(run.stderr).toContain('/loop needs an interactive or RPC session; print and JSON runs exit when the agent settles.');
  });
});
