// MX-MCP: why with a stdio MCP server configured through Pi's native mcp.json, and without one (why/SKILL.md "It strips MCP access").
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Parent, scenario, Worker } from '../fixtures/dsl.ts';
import { cartHistory } from '../fixtures/repos.ts';
import { type Check, check, fail, src, when } from '../lib/check.ts';
import { allWorkers, assignmentOf, finalReply, repoUntouched, settledAndCollected, workersCheck } from '../lib/checks.ts';
import { PI, PKG, SCRIPTED_ROLES } from '../lib/driver.ts';
import { overwrite, patchAssignment, rewriteFinalReply } from '../lib/mutate.ts';
import type { RunView, WorkerView } from '../lib/view.ts';
import type { Family } from './types.ts';

const QUESTION = 'why does applyCoupon take a percent instead of an amount off?';
const SERVER = join(PKG, 'tests/workflow-parity/fixtures/mcp-server.mjs');
const TOOL = 'mcp__decisions__lookup_decision';
const WHY = src('why/SKILL.md', 'It strips MCP access');
const model = (line: string) => String(SCRIPTED_ROLES[line]);

const serverCalls = (view: RunView): { tool?: string; method?: string; pid: number }[] => {
  const path = join(view.sandbox, 'mcp-calls.jsonl');
  return existsSync(path)
    ? readFileSync(path, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as { tool?: string; method?: string; pid: number })
    : [];
};

const worker = (view: RunView, id: string): WorkerView | undefined => allWorkers(view).find((entry) => entry.id === id);
const codemodeOf = (view: RunView, id: string) => worker(view, id)?.session?.toolCalls.find((call) => call.name === 'codemode');
const FOUND = 'Long-form documents: found DEC-142, percent coupons chosen so one promotion fits every cart size (https://wiki.example/decisions/142).';
const MISSING = 'Long-form documents: skipped, the decisions MCP server is not connected, so no decision record was searched.';

/** The script a worker runs to discover the server, then call it. Without the server it reports the namespace as missing. */
const PROBE = `const ns = await describeNamespace('mcp__decisions');
if (ns === undefined) return 'UNAVAILABLE: no mcp__decisions namespace';
const found = await tools.${TOOL}({ topic: 'coupon' });
return { namespace: ns.name, tools: ns.tools, found: found.content[0].text };`;

function whyMcp(withServer: boolean): Family {
  const id = withServer ? 'why-mcp' : 'why-no-mcp';
  const finding = withServer ? FOUND : MISSING;
  const synthesis = `### The Question\n${QUESTION}\n### What We Found\nCoupons arrived as a percent in #118.\n${withServer ? 'The decision record DEC-142 says percent coupons fit every cart size. Source: https://wiki.example/decisions/142.' : 'No product decision record was available, so the reason is not recorded in the sources searched.'}\n### Sources Consulted\n- Source control: found #118.\n- ${finding}\n- Issue / ticket tracker: skipped, no matching MCP available.\n### Confidence Summary\n${withServer ? 'Medium: one decision record plus history.' : 'Low confidence on the motive.'}`;
  const checks: Check[] = [
    check(`${id}.parent-discovers-mcp`, 'the parent runs pi mcp list before spawning, and it names the server only when one is configured', src('why/SKILL.md', 'Otherwise run `pi mcp list`'), (view) => {
      const listed = view.parent.toolCalls.find((call) => call.name === 'bash' && /\bmcp list\b/.test(String(call.args['command'])));
      if (listed === undefined) return fail('no pi mcp list');
      const names = /decisions/.test(listed.resultText);
      return when(names === withServer, `pi mcp list ${names ? 'shows' : 'does not show'} the decisions server`, `pi mcp list said: ${listed.resultText.slice(0, 160)}`);
    }),
    workersCheck(`${id}.investigators-readonly-with-mcp`, 'the investigators are readonly on the repository root and keep MCP (capabilities.mcp is not none)', [WHY, src('why/SKILL.md', '**Do not set `capabilities.mcp: "none"`.**')], { role: 'investigator', min: 2, mode: 'readonly', rootPath: true, mcpInherit: true, modelLine: 'why investigators' }),
    check(`${id}.worker-launch-keeps-mcp`, 'no worker host launched Pi with --no-mcp, and each readonly one got a --tools allowlist', WHY, (view) => {
      const launches = (view.runs[0]?.events ?? []).filter((entry) => entry['kind'] === 'launch').map((entry) => ({ id: String(entry['workerId']), command: JSON.stringify((entry['data'] as Record<string, unknown>)['command']) }));
      const problems = launches.flatMap(({ id: workerId, command }) => [...(/--no-mcp/.test(command) ? [`${workerId} was launched with --no-mcp`] : []), ...(assignmentOf(worker(view, workerId) as WorkerView).workspace?.mode === 'readonly' && !/--tools/.test(command) ? [`${workerId} is readonly with no --tools allowlist`] : [])]);
      return when(launches.length >= 3 && problems.length === 0, `${launches.length} launch commands, none with --no-mcp`, problems.join('; ') || `only ${launches.length} launches recorded`);
    }),
    check(`${id}.worker-discovers-and-calls`, withServer ? 'a worker with default tools discovered the namespace, called the tool through codemode, and the server logged the call' : 'a worker looking for the server could not even start a codemode script or found no namespace, so nothing was called', WHY, (view) => {
      const call = codemodeOf(view, 'mcp-control');
      if (call === undefined) return fail('the control worker never ran codemode');
      const served = serverCalls(view).filter((entry) => entry.tool === 'lookup_decision');
      if (!withServer) return when((call.isError || /UNAVAILABLE/.test(call.resultText)) && served.length === 0 && !/DEC-\d+/.test(call.resultText), `codemode said ${call.resultText.slice(0, 70)}; the server saw no call`, `codemode result ${call.resultText.slice(0, 100)}; server calls ${served.length}`);
      return when(!call.isError && /Script completed/.test(call.resultText) && /lookup_decision/.test(call.resultText) && /DEC-142/.test(call.resultText) && served.length >= 1, `discovered ${TOOL}; returned DEC-142; the server logged ${served.length} call(s)`, `codemode ${call.resultText.slice(0, 160)}; server calls ${served.length}`);
    }),
    check(`${id}.readonly-holds-beside-mcp`, 'the readonly investigator was refused a write, with the MCP server configured: MCP did not widen its tools', src('why/SKILL.md', 'A readonly worker runs `git` and `gh` through `bash_readonly` and cannot write files'), (view) => {
      const write = worker(view, 'docs-investigator')?.session?.toolCalls.find((call) => call.name === 'write');
      return when(write?.isError === true && !existsSync(join(view.repo, 'NOTES.md')) && view.git.dirty.length === 0, 'write refused, NOTES.md absent, checkout clean', `write ${write === undefined ? 'never tried' : `isError ${write.isError}`}; dirty ${view.git.dirty.join(',')}`);
    }),
    check(`${id}.citations-come-from-tool-output`, withServer ? 'every decision id and URL in the reply appears in the MCP tool output' : 'the reply cites no decision id or URL, and its Sources Consulted line says the documents were not searched', src('why/references/investigator-prompt.md', '**Never invent.**'), (view) => {
      const reply = finalReply(view);
      const cited = [...new Set((reply.match(/DEC-\d+|https?:\/\/[^\s)]+/g) ?? []).map((entry) => entry.replace(/[.,]+$/, '')))];
      if (!withServer) return when(cited.length === 0 && /Long-form documents: skipped, the decisions MCP server is not connected/.test(reply), 'no citation, and the missing coverage is stated', `cited ${cited.join(', ') || 'nothing'}; line ${/Long-form documents.*/.exec(reply)?.[0] ?? 'absent'}`);
      const output = codemodeOf(view, 'mcp-control')?.resultText ?? '';
      const invented = cited.filter((entry) => !output.includes(entry));
      return when(cited.length >= 2 && invented.length === 0, `cited ${cited.join(', ')}, all in the tool output`, `cited ${cited.join(', ') || 'nothing'}; not in the tool output: ${invented.join(', ')}`);
    }),
    settledAndCollected(`${id}.settled-and-collected`, src('why/SKILL.md', '## Step 5. Present')),
    repoUntouched(`${id}.no-writes`, 'the repository is untouched', src('why/SKILL.md', "Investigators still shouldn't write anything")),
  ];
  if (withServer)
    checks.push(
      check(`${id}.readonly-investigator-reaches-mcp`, 'the readonly investigator, which keeps MCP access, called the MCP tool and got the decision record', WHY, (view) => {
        const calls = (worker(view, 'docs-investigator')?.session?.toolCalls ?? []).filter((call) => call.name === TOOL || call.name === 'codemode');
        const reached = calls.some((call) => !call.isError && /DEC-142/.test(call.resultText));
        return when(reached, `reached the MCP tool: ${calls.map((call) => call.name).join(', ')}`, `${calls.map((call) => `${call.name} -> ${call.resultText.slice(0, 50)}`).join('; ') || 'no attempt'}; server calls from workers: ${serverCalls(view).filter((entry) => entry.tool === 'lookup_decision').length}`);
      }),
    );
  return {
    id,
    title: withServer ? 'why with a configured MCP server: discovery, a real call, citations from its output, readonly kept (MX-MCP)' : 'why with no MCP server: nothing is called and the reply reports the missing coverage (MX-MCP)',
    spec: {
      family: id,
      runId: id,
      history: cartHistory,
      prompt: () => `/why ${QUESTION}`,
      prepare: (ctx) => {
        if (withServer) {
          mkdirSync(join(ctx.agentDir, 'pstack'), { recursive: true });
          writeFileSync(join(ctx.agentDir, 'pstack', 'readonly-mcp.json'), JSON.stringify({ tools: [TOOL] }, null, 2));
        }
        if (withServer) writeFileSync(join(ctx.agentDir, 'mcp.json'), JSON.stringify({ mcpServers: { decisions: { command: 'node', args: [SERVER], env: { MCP_FIXTURE_LOG: join(ctx.sandbox, 'mcp-calls.jsonl') }, description: 'Product decision records' } } }, null, 2));
      },
      scenario: (ctx) => {
        const parent = new Parent(ctx);
        parent.readSkill('why');
        for (const file of ['epistemics.md', 'investigator-prompt.md', 'synthesizer-prompt.md', 'source-playbook.md']) parent.readReference('why', file);
        parent
          .bash(`node ${join(ctx.pkg, 'scripts', 'start-run.mjs')} --playbook investigation --title "why: coupon percent" --run-id ${ctx.runId}`)
          .bash('git blame -L 1,20 src/cart.js')
          .bash(`${PI} mcp list`);
        const caps = { mcp: 'inherit', env: 'inherit', externalWrite: false };
        const readonly = (workerId: string, brief: string) => parent.stage(workerId, { role: 'investigator', model: model('why investigators'), workspace: parent.readonly(), capabilities: caps }, brief);
        const git = readonly('git-investigator', `Question: ${QUESTION}\nOwn one source: git history.`);
        const docs = readonly('docs-investigator', `Question: ${QUESTION}\nOwn one source: long-form documents through the decisions MCP server. Report only what a tool returns, and say so if it is unreachable.`);
        const control = parent.stage('mcp-control', { role: 'general', model: model('why investigators'), workspace: parent.worktree(), capabilities: caps }, 'Discover the decisions MCP server with codemode and look up the coupon decision. Report only what it returns.');
        parent.fire(git, docs, control).wait('git-investigator').wait('docs-investigator').wait('mcp-control').collect('git-investigator', 'docs-investigator', 'mcp-control');
        parent.spawn('synth', { role: 'general', model: model('why synthesizer'), workspace: parent.readonly(), capabilities: caps }, `Question: ${QUESTION}\n\n## Investigator Findings\n\nSource control: #118.\n${finding}`).wait('synth').collect('synth').text(synthesis);
        const noteWrite = { path: join(ctx.repo, 'NOTES.md'), content: 'leaked' };
        return scenario(parent, {
          'git-investigator': new Worker().call('bash_readonly', { command: 'git log --format=%h\\ %s -5 -- src/cart.js' }).text('Source control: #118 added couponPercent.'),
          'docs-investigator': new Worker().call('codemode', { code: PROBE }).call('write', noteWrite).text(`${MISSING} The MCP tool was not callable from this worker.`),
          'mcp-control': new Worker().call('codemode', { code: PROBE }).text(finding),
          synth: new Worker().read(join(ctx.repo, 'src/cart.js')).text(synthesis),
        });
      },
    },
    checks,
    negatives: [
      { name: 'an investigator was spawned with MCP off', mutate: (sandbox) => patchAssignment(sandbox, id, 'docs-investigator', (assignment) => (assignment['capabilities'] = { mcp: 'none', env: 'inherit', externalWrite: false })), fails: [`${id}.investigators-readonly-with-mcp`] },
      { name: 'a host was launched with --no-mcp', mutate: (sandbox) => overwrite(join(sandbox, 'repo/.pi/pstack/runs', id, 'events.jsonl'), (text) => text.replace('"--tools"', '"--no-mcp","--tools"')), fails: [`${id}.worker-launch-keeps-mcp`] },
      { name: 'the reply cites what no tool returned', mutate: (sandbox) => rewriteFinalReply(sandbox, withServer ? 'DEC-142' : 'No product decision record', withServer ? 'DEC-777' : 'DEC-777 is the decision record'), fails: [`${id}.citations-come-from-tool-output`] },
      ...(withServer ? [] : [{ name: 'the reply drops the missing-coverage line', mutate: (sandbox: string) => rewriteFinalReply(sandbox, MISSING, 'Long-form documents: covered.'), fails: [`${id}.citations-come-from-tool-output`] }]),
    ],
  };
}

export const mcpFamilies: Family[] = [whyMcp(true), whyMcp(false)];
