import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { PACKAGE_ROOT } from '../../src/paths.ts';
import { assistantTexts, contentText, makeSandbox, runJson, type Sandbox, script, startRpc, toolEnds } from './harness.ts';

let sandbox: Sandbox;
beforeEach(() => {
  sandbox = makeSandbox();
});
afterEach(() => sandbox.dispose());

const section = (prompt: string, name: string) => {
  const match = new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`).exec(prompt);
  if (!match) throw new Error(`system prompt has no <${name}> section`);
  return match[1] ?? '';
};

async function systemPrompt(args: string[] = []): Promise<string> {
  const run = await runJson(sandbox, 'show me\n@@sys', args);
  const [text] = assistantTexts(run.events);
  if (text === undefined) throw new Error(`no reply\n${run.stderr}`);
  return text;
}

/** The system prompt of a long-lived RPC session, where loops can run. */
async function rpcSystemPrompt(): Promise<string> {
  const rpc = startRpc(sandbox, ['--no-session']);
  try {
    rpc.send({ type: 'prompt', message: 'show me\n@@sys' });
    const reply = await rpc.waitFor((event) => event.type === 'message_end' && (event['message'] as { role: string }).role === 'assistant');
    return contentText((reply['message'] as { content: { type: string; text?: string }[] }).content);
  } finally {
    await rpc.close();
  }
}

describe('host map (HOST-001)', () => {
  test('names the skills, rule, transcript, store, project, and subagent locations in Pi terms', async () => {
    const host = section(await systemPrompt(), 'pstack_host');
    const skills = join(PACKAGE_ROOT, 'skills');
    const workspace = join(sandbox.agentDir, 'pstack/workspaces', `--${sandbox.workDir.replace(/^\//, '').replaceAll('/', '-')}--`);
    expect(host).toContain(`pstack runs here through the pi-pstack package at ${PACKAGE_ROOT}.`);
    expect(host).toContain(`<SKILLS> = ${skills}`);
    expect(host).toContain('"the X skill", "/X", and "principle-X" mean <SKILLS>/X/SKILL.md');
    expect(host).toContain('a delegate that needs poteto-mode reads <SKILLS>/poteto-mode/SKILL.md');
    expect(host).toContain(`- The model rule is ${join(sandbox.agentDir, 'pstack/pstack-models.md')}. Its current content is in <pstack_models>.`);
    expect(host).toContain(`- Skill folders: project \`.pi/skills/\`, personal \`${join(sandbox.agentDir, 'skills')}/\`.`);
    expect(host).toContain(`Subagent transcripts for this workspace: ${join(workspace, 'subagents')}/*_<agent id>.jsonl. A subagent is still running while ${join(workspace, 'subagents')}/<agent id>.lock exists and names a live pid.`);
    expect(host).toMatch(new RegExp(`"The current agent's store" is ${join(workspace, 'store')}/[0-9a-f-]+\\. Create it when a playbook needs it\\.`));
    expect(host).toContain(`- Projects: a program's Project is ${join(workspace, 'projects')}/<project-slug>/, with notes.md as its Project tracker and store/ as its Project store.`);
    expect(host).toMatch(new RegExp(`- Files a tool makes for the user, such as visualize charts, go in ${join(workspace, 'artifacts')}/[0-9a-f-]+\\.`));
    expect(host).toContain(`- Transcripts: this workspace's Pi session files are in ${join(sandbox.agentDir, 'sessions')}/--${sandbox.workDir.replace(/^\//, '').replaceAll('/', '-')}--.`);
    expect(host).toContain('Installed skills (62): architect, arena, automate-me,');
    expect(host).toContain("agent_status reads a subagent's state without waking it.");
    expect(host).toContain('- The user keeps a skill on every turn with `/mode <skill>` (exit `/mode off`) and plans without edits with `/plan` (exit `/plan off`).');
    expect(host).toContain('- MCP tools are named mcp__<server>__<tool>; `pi mcp list` shows the servers.');
    expect(host).toContain('- Isolated workers (Task environment "cloud") run on this machine in their own git worktree on branch pstack/<agent id>');
  });

  test('names no Cursor host feature (HOST-008)', async () => {
    const prompt = await systemPrompt(['--no-session']);
    const names = ['pstack_host', 'pstack_subagents', 'pstack_models', 'pstack_mode', 'pstack_plan', 'pstack_loop'];
    const pstack = names.map((name) => new RegExp(`<${name}>\\n([\\s\\S]*?)\\n</${name}>`).exec(prompt)?.[1] ?? '').join('\n');
    expect(pstack).not.toMatch(/cursor/i);
  });

  test('tells a one-shot run it cannot subscribe, and a long-lived session how subscriptions wake it (HOST-010)', async () => {
    const [rpc, oneShot] = [section(await rpcSystemPrompt(), 'pstack_host'), section(await systemPrompt(['--no-session']), 'pstack_host')];
    expect([rpc.includes('- Subscriptions (subscribe_github_pr, subscribe_timer, subscribe_webhook) wake this chat'), oneShot.includes('- Subscriptions: this run ends when it settles, so nothing can wake it')]).toEqual([true, true]);
  });

  test("names the main chat's own store as the root agent's store", async () => {
    const host = section(await systemPrompt(['--no-session']), 'pstack_host');
    const current = /"The current agent's store" is (\S+)\. /.exec(host)?.[1];
    expect(host).toContain(`"The root agent's store" is ${current}, the store of the main chat that started this subagent tree; in the main chat it is the current agent's store.`);
  });

  test('names AskQuestion only where a user can answer (HOST-005; review r2: parity 4)', async () => {
    const [rpc, oneShot] = [section(await rpcSystemPrompt(), 'pstack_host'), section(await systemPrompt(['--no-session']), 'pstack_host')];
    expect([
      rpc.includes('- Todo lists: the TodoWrite tool. Structured questions: the AskQuestion tool.'),
      oneShot.includes('- Todo lists: the TodoWrite tool. Structured questions: the AskQuestion tool, but nobody can answer in this run, so every question comes back skipped; decide yourself and say what you chose.'),
    ]).toEqual([true, true]);
  });

  test('tells a long-lived session how to arm /loop (HOST-004)', async () => {
    const host = section(await rpcSystemPrompt(), 'pstack_host');
    expect(host).toContain(
      '- /loop: the user starts `/loop [interval] <prompt>`. When a playbook says to arm /loop, call the Loop tool with prompt plus interval (fixed cadence) or wake_in (agent-paced). Inside a loop, Loop with wake_in schedules the next run and stop: true ends it.',
    );
  });

  test('tells a one-shot run, such as a subagent, that it cannot arm /loop (HOST-004, recheck 2)', async () => {
    const host = section(await systemPrompt(['--no-session']), 'pstack_host');
    expect(host).toContain(
      '- /loop: this run ends when it settles (a subagent, or a print or JSON run), so it has no Loop tool and cannot arm a loop. Keep working until the goal is met, and name in the final reply anything the parent chat should loop on.',
    );
  });

  test('frames an attached skill as the workflow to follow', async () => {
    const host = section(await systemPrompt(), 'pstack_host');
    expect(host).toContain(
      '- A <skill> block in a user message means the user attached that skill to this request. Follow its workflow from its first step, including the steps it says to take before answering, instead of answering directly.',
    );
  });

  test('names the persisted transcript of this chat', async () => {
    const host = section(await systemPrompt(['--session-dir', join(sandbox.root, 'sessions')]), 'pstack_host');
    expect(host).toMatch(new RegExp(`This chat's transcript is ${join(sandbox.root, 'sessions')}/[^ ]+\\.jsonl\\.`));
  });

  test('says when the chat is not persisted', async () => {
    const host = section(await systemPrompt(['--no-session']), 'pstack_host');
    expect(host).toContain('This chat is not persisted (--no-session), so it has no transcript file.');
  });
});

describe('subagent catalog (HOST-002)', () => {
  test('lists the subagent types and the models Task accepts', async () => {
    const catalog = section(await systemPrompt(['--no-session']), 'pstack_subagents');
    expect(catalog).toContain('- generalPurpose (default): ');
    expect(catalog).toContain('- poteto-agent (runs in the background unless run_in_background is false): Delegate subagent for code-writing and helper tasks spawned during a `/poteto-mode` run.');
    expect(catalog).toContain('- comment-sicko: A deranged comment-hater that savors deletion and condemns workaround code.');
    expect(catalog).toContain('- inherit (default): the parent model and thinking level. auto and inherit-parent mean the same.');
    expect(catalog).toMatch(/^- This chat runs scripted\/echo(:\w+)?\. pstack's model families \(claude-\*, grok-\*\) go by the model id after its provider\.$/m);
    expect(catalog).toContain('Available models: scripted/echo (thinking: off, minimal, low, medium, high), scripted/plain');
    expect(catalog).toContain('- A Pi model <provider>/<model-id> or <model-id>, optionally with :<level> from the thinking levels the model lists below. A level the model does not list is rejected.');
  });
});

describe('capability-aware sections (C-M4)', () => {
  test('a readonly subagent gets no subagent catalog and no Task or stop_agent lines; its parent gets both', async () => {
    const run = await runJson(sandbox, script([{ tool: 'Task', args: { description: 'probe', prompt: 'go\n@@sys', readonly: true } }]), ['--no-session']);
    const child = toolEnds(run.events, 'Task')[0]?.text ?? '';
    const parentHost = section(await systemPrompt(['--no-session']), 'pstack_host');
    expect([child.includes('<pstack_host>'), child.includes('<pstack_subagents>'), section(child, 'pstack_host').includes('Task'), section(child, 'pstack_host').includes('stop_agent')]).toEqual([true, false, false, false]);
    expect([parentHost.includes('- Subagents: call the Task tool'), parentHost.includes('stop_agent stops a running agent.')]).toEqual([true, true]);
  });
});

describe('model rule (RULE-001)', () => {
  test('reports the default when no rule exists', async () => {
    const models = section(await systemPrompt(['--no-session']), 'pstack_models');
    expect(models).toBe(`No pstack model rule exists at ${join(sandbox.agentDir, 'pstack/pstack-models.md')}. Every role uses its skill default until /setup-pstack writes one.`);
  });

  test('applies the rule on every request when it exists', async () => {
    mkdirSync(join(sandbox.agentDir, 'pstack'), { recursive: true });
    writeFileSync(join(sandbox.agentDir, 'pstack/pstack-models.md'), '# budget: small (medium)\nswarm workers: scripted/plain\n');
    const run = await runJson(sandbox, ['first\n@@sys', 'second\n@@sys'], ['--no-session']);
    const prompts = assistantTexts(run.events);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) expect(section(prompt, 'pstack_models')).toBe(`Path: ${join(sandbox.agentDir, 'pstack/pstack-models.md')}\n# budget: small (medium)\nswarm workers: scripted/plain`);
  });
});

describe('tool listing', () => {
  test('lists the pstack tools a one-shot run can use, and the todolist guideline (HOST-001, TODO-001, recheck 2)', async () => {
    const prompt = await systemPrompt(['--no-session']);
    const tools = /<tools>\n([\s\S]*?)\n<\/tools>/.exec(prompt)?.[1] ?? '';
    expect(
      tools
        .split('\n')
        .filter((line) => /^- (Task|TodoWrite|AskQuestion|Loop):/.test(line))
        .toSorted(),
    ).toEqual([
      '- AskQuestion: Structured multiple-choice questions for the user',
      '- Task: Launch subagents (foreground, background with completion notifications, resume by agent ID)',
      '- TodoWrite: Create and update the todo list for this session',
    ]);
    expect(prompt).toContain('- When a skill or playbook says to open a todolist or todo list, call TodoWrite before other work, with the steps it names as the first items.');
  });
});

describe('image generation (HOST-006)', () => {
  test('the path the host section names generates an image when an image model is configured', async () => {
    const images = makeSandbox({ extensions: [join(PACKAGE_ROOT, 'test/fixtures/scripted-model.ts'), join(PACKAGE_ROOT, 'test/fixtures/image-model.ts')] });
    try {
      // The script follows the host section line: codemode's models.generateImages(), shown with image().
      const code =
        'const [painter] = await models.getAvailableOfType("image");\nconst result = await models.generateImages(painter, { input: [{ type: "text", text: "a fox" }] });\nfor (const block of result.output) if (block.type === "image") image(block);\nreturn painter.provider + "/" + painter.id + " " + result.stopReason;';
      const run = await runJson(images, script([{ tool: 'codemode', args: { code } }]), ['--no-session', '--tools', '+codemode']);
      const [end] = toolEnds(run.events, 'codemode');
      expect(end?.isError).toBe(false);
      expect(end?.text).toContain('testimg/painter stop');
      expect(JSON.stringify(run.events.find((event) => event.type === 'tool_execution_end' && event['toolName'] === 'codemode'))).toContain('"type":"image"');
    } finally {
      images.dispose();
    }
  });
});
