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
  test('names the skills, rule, transcript, and subagent locations', async () => {
    const host = section(await systemPrompt(), 'pstack_host');
    const skills = join(PACKAGE_ROOT, 'skills');
    expect(host).toContain(`<SKILLS> = ${skills}`);
    expect(host).toContain('"the X skill", "/X", and "principle-X" mean <SKILLS>/X/SKILL.md');
    expect(host).toContain(`\`~/.cursor/rules/pstack-models.mdc\` means ${join(sandbox.agentDir, 'pstack/pstack-models.mdc')}`);
    const workspace = join(sandbox.agentDir, 'pstack/workspaces', `--${sandbox.workDir.replace(/^\//, '').replaceAll('/', '-')}--`);
    expect(host).toContain(`Subagent transcripts for this workspace: ${join(workspace, 'subagents')}/*_<agent id>.jsonl. A subagent is still running while ${join(workspace, 'subagents')}/<agent id>.lock exists and names a live pid.`);
    expect(host).toMatch(new RegExp(`"The current agent's store" \\(orchestrate's store layout\\) is ${join(workspace, 'store')}/[0-9a-f-]+\\. Create it when a playbook needs it, and pass it to orch as --store\\.`));
    expect(host).toContain(
      "- Image generation (the image tool teach reaches for, ketchup's generated image): Pi generates images through codemode's models.generateImages() when codemode is on and an image model is configured. Otherwise say no image tool is available and use a mermaid diagram or a table. Cursor's `/visualize` charts have no Pi counterpart, so draw a chart as a mermaid diagram (xychart-beta for numbers).",
    );
    expect(host).toContain('Installed skills (60): architect, arena, automate-me,');
    expect(host).toContain(
      `\`agent-transcripts/\` and \`~/.cursor/projects/<slug>/agent-transcripts/\` mean ${join(sandbox.agentDir, 'sessions')}/--${sandbox.workDir.replace(/^\//, '').replaceAll('/', '-')}--, Pi session JSONL files for this workspace. Each line is an entry: the first is a session header, and conversation turns have type "message" (the opening prompt is the first user message).`,
    );
    expect(host).toContain('MCP tools are named mcp__<server>__<tool>; `pi mcp list` shows the servers.');
    expect(host).toContain("Cursor's built-in create-skill skill is <SKILLS>/create-skill/SKILL.md. `.cursor/skills/` means `.pi/skills/`;");
    expect(host).toContain(
      '- Cloud subagents (environment "cloud") do not exist in Pi: run that worker locally instead, and when workers write in parallel, have each create its own git worktree and work only there. Say so in your report and keep going. Grok Bot routines (update_state, SendToUser) and Cursor Automations are unavailable; say so.',
    );
  });

  test('maps the Cursor tool names and transcript shapes that pstack text relies on (HOST-008)', async () => {
    const host = section(await systemPrompt(['--no-session']), 'pstack_host');
    expect(host).toContain(
      '- Cursor tool names in pstack text: Read is read, Grep is grep, Glob is find, Shell is bash. A skill under `~/.cursor/plugins/` is one under <SKILLS>, and this package is the only pstack copy, so a search of `~/.cursor/plugins/` for `skills/<name>/SKILL.md` ends at <SKILLS>/<name>/SKILL.md. In a Pi transcript a tool call is a toolCall part of an assistant message (tool name plus arguments), and an attached skill is a <skill name="..." location="..."> block in a user message.',
    );
  });

  test("maps the non-Cursor conventions from upstream's harness adapter (HOST-009)", async () => {
    const host = section(await systemPrompt(['--no-session']), 'pstack_host');
    expect([
      host.includes(`- A link to \`https://github.com/cursor/plugins/blob/main/pstack/<path>\` means ${PACKAGE_ROOT}/<path> when that file exists (skills/, agents/, docs/).`),
      host.includes('- Bugbot comments on a GitHub PR are ordinary review threads, so triage them with the forge command the step gives.'),
      host.includes('- A step that needs a Cursor-only feature with no Pi counterpart gets one line in your reply, `Skipped in Pi: <step>. <reason>.`, and you go on to the next step without stopping, asking, or retrying.'),
    ]).toEqual([true, true, true]);
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

  test('frames an attached skill as the workflow to follow, as Cursor does for /name', async () => {
    const host = section(await systemPrompt(), 'pstack_host');
    expect(host).toContain(
      '- A <skill> block in a user message means the user attached that skill to this request (Cursor: a manually attached skill). Follow its workflow from its first step, including the steps it says to take before answering, instead of answering directly.',
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
    expect(catalog).toContain('Available models: scripted/echo (thinking: off, minimal, low, medium, high), scripted/plain');
    expect(catalog).toContain('- A Cursor-style slug <model-id>-<effort>[-fast], effort one of the thinking levels the model lists below; the effort becomes the thinking level and -fast is ignored.');
  });
});

describe('model rule (RULE-001)', () => {
  test('reports the default when no rule exists', async () => {
    const models = section(await systemPrompt(['--no-session']), 'pstack_models');
    expect(models).toBe(`No pstack model rule exists at ${join(sandbox.agentDir, 'pstack/pstack-models.mdc')}. Every role uses its skill default until /setup-pstack writes one.`);
  });

  test('applies the rule on every request when it exists', async () => {
    mkdirSync(join(sandbox.agentDir, 'pstack'), { recursive: true });
    writeFileSync(join(sandbox.agentDir, 'pstack/pstack-models.mdc'), '---\nalwaysApply: true\n---\n# budget: small (medium)\nswarm workers: scripted/plain\n');
    const run = await runJson(sandbox, ['first\n@@sys', 'second\n@@sys'], ['--no-session']);
    const prompts = assistantTexts(run.events);
    expect(prompts).toHaveLength(2);
    for (const prompt of prompts) expect(section(prompt, 'pstack_models')).toBe(`Path: ${join(sandbox.agentDir, 'pstack/pstack-models.mdc')}\n# budget: small (medium)\nswarm workers: scripted/plain`);
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
  test('the path the host map names generates an image when an image model is configured', async () => {
    const images = makeSandbox({ extensions: [join(PACKAGE_ROOT, 'test/fixtures/scripted-model.ts'), join(PACKAGE_ROOT, 'test/fixtures/image-model.ts')] });
    try {
      // The script follows the host map line: codemode's models.generateImages(), shown with image().
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
