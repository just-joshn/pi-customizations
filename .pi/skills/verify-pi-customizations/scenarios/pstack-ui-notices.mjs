import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { assertSurface, customMessages, lastToolResult, notifications, prepareHooksAgentDir, startHooks } from './pstack-hooks-lib.js';

function notice(session, pattern) {
  return notifications(session).find((record) => pattern.test(record.message ?? ''));
}

export default async function pstackUiNotices(context) {
  // --- UI-6: a failing /setup-pstack posts the error notice and the setup-error message ---------
  const brokenDir = prepareHooksAgentDir(context, 'setup-broken');
  const broken = await startHooks(context, 'setup-broken', {
    agentDir: brokenDir,
    answers: { select: () => 'Not a budget' },
  });
  try {
    await broken.session.prompt('/setup-pstack');
    const errorNotice = notifications(broken.session).at(-1);
    const setupError = customMessages(broken.session, 'pstack-setup-error').at(-1);
    assert.equal(errorNotice?.notifyType, 'error');
    assert.match(errorNotice?.message ?? '', /Unknown budget 'Not a budget'/);
    assert.equal(setupError?.content, errorNotice?.message);
    assertSurface(context, {
      surfaceId: 'PS-UI-6',
      observed: `notify notifyType=${JSON.stringify(errorNotice?.notifyType)} message=${JSON.stringify(errorNotice?.message)} and custom message ${JSON.stringify(setupError?.customType)} content=${JSON.stringify(setupError?.content)}`,
      evidence: broken.session.capturePath,
      check: () => {
        assert.equal(errorNotice?.notifyType, 'error');
        assert.match(errorNotice?.message ?? '', /Unknown budget 'Not a budget'/);
        assert.equal(setupError?.content, errorNotice?.message);
      },
    });
  } finally {
    await broken.session.close();
  }

  // --- UI-13/UI-17: the full setup writes the rule and shows table, dialogs and warnings --------
  const setupDir = prepareHooksAgentDir(context, 'setup-full');
  const setup = await startHooks(context, 'setup-full', {
    agentDir: setupDir,
    answers: {
      select: (request) => {
        if (request.title.startsWith('pstack reasoning budget')) return 'unlimited — keep max';
        if (request.title === 'Accept model table or change a role') return 'Accept as-is';
        return (request.options ?? []).find((option) => option === 'pstack-hooks/scripted') ?? request.options?.[0];
      },
      input: () => 'pstack-hooks/scripted,pstack-hooks/scripted',
      confirm: () => true,
    },
  });
  try {
    await setup.session.prompt('/setup-pstack');
    const tableNotice = notice(setup.session, /feature, refactoring: pstack-hooks\/scripted/);
    const familyWarning = notifications(setup.session).find((record) => record.notifyType === 'warning' && /lists 2 entries from 1 model family/.test(record.message ?? ''));
    const wroteNotice = notice(setup.session, /Wrote .*models\.mdc/);
    const rulePath = join(setupDir, 'pstack', 'models.mdc');
    const rule = readFileSync(rulePath, 'utf8');
    assert.match(rule, /# budget: unlimited \(max\)/);
    assert.match(rule, /arena runners: pstack-hooks\/scripted, pstack-hooks\/scripted/);
    assertSurface(context, {
      surfaceId: 'PS-UI-13',
      observed: `info table notice=${JSON.stringify(tableNotice?.message?.split('\n')[0])}; warning=${JSON.stringify(familyWarning?.message)}; wrote notice=${JSON.stringify(wroteNotice?.message)}; rule file holds ${JSON.stringify(rule.split('\n').find((line) => line.startsWith('arena runners')))}`,
      evidence: setup.session.capturePath,
      check: () => {
        assert.ok(tableNotice, 'the model table notice was not shown');
        assert.ok(familyWarning, 'the family warning was not shown');
        assert.match(wroteNotice?.message ?? '', /Wrote .*models\.mdc/);
        assert.match(rule, /# budget: unlimited \(max\)/);
      },
    });

    const requests = setup.session.uiRequests;
    const budgetSelect = requests.find((record) => record.method === 'select' && record.title.startsWith('pstack reasoning budget'));
    const roleSelect = requests.find((record) => record.method === 'select' && record.title.startsWith('feature, refactoring (current:'));
    const panelInput = requests.find((record) => record.method === 'input' && record.title.startsWith('arena runners: comma-separated models'));
    const acceptSelect = requests.find((record) => record.method === 'select' && record.title === 'Accept model table or change a role');
    const writeConfirm = requests.find((record) => record.method === 'confirm' && record.title === 'Write pstack model configuration?');
    assert.ok(budgetSelect, 'budget select dialog missing');
    assert.ok(roleSelect, 'role select dialog missing');
    assert.ok(panelInput, 'panel text-input dialog missing');
    assert.ok(acceptSelect, 'accept select dialog missing');
    assert.ok(writeConfirm, 'write confirm dialog missing');
    assertSurface(context, {
      surfaceId: 'PS-UI-17',
      observed: `dialogs: select ${JSON.stringify(budgetSelect?.title)}, select ${JSON.stringify(roleSelect?.title)}, input ${JSON.stringify(panelInput?.title?.slice(0, 60))}, select ${JSON.stringify(acceptSelect?.title)}, confirm ${JSON.stringify(writeConfirm?.title)}`,
      evidence: setup.session.capturePath,
      check: () => {
        assert.ok(budgetSelect, 'budget select dialog missing');
        assert.ok(roleSelect, 'role select dialog missing');
        assert.ok(panelInput, 'panel text-input dialog missing');
        assert.ok(acceptSelect, 'accept select dialog missing');
        assert.ok(writeConfirm, 'write confirm dialog missing');
      },
    });
  } finally {
    await setup.session.close();
  }

  // --- UI-7/UI-14: /pstack errors and the subagent command notices ------------------------------
  const commands = await startHooks(context, 'commands', { agentDir: prepareHooksAgentDir(context, 'commands', { builtInAgents: { rubberDuck: false } }) });
  try {
    await commands.session.prompt('/pstack bogus');
    const unknownArgument = notifications(commands.session).at(-1);
    assert.equal(unknownArgument?.notifyType, 'error');
    assert.equal(unknownArgument?.message, 'Unknown /pstack argument "bogus". Use /pstack, /pstack status, or /pstack todos.');
    assertSurface(context, {
      surfaceId: 'PS-UI-7',
      observed: `notify notifyType=${JSON.stringify(unknownArgument?.notifyType)} message=${JSON.stringify(unknownArgument?.message)}`,
      evidence: commands.session.capturePath,
      check: () => assert.equal(unknownArgument?.message, 'Unknown /pstack argument "bogus". Use /pstack, /pstack status, or /pstack todos.'),
    });

    await commands.session.prompt('/tasks');
    const tasksNotice = notifications(commands.session).at(-1);
    await commands.session.prompt('/subagents rubber-duck off');
    const savedNotice = notifications(commands.session).at(-1);
    await commands.session.prompt('/subagents');
    const subagentsNotice = notifications(commands.session).at(-1);
    await commands.session.prompt('/subagents bogus');
    const invalidNotice = notifications(commands.session).at(-1);
    await commands.session.prompt('/workflows');
    const workflowsNotice = notifications(commands.session).at(-1);
    await commands.session.prompt('/rubber-duck');
    const duckNotice = notifications(commands.session).at(-1);
    await commands.session.prompt('/fleet');
    const fleetNotice = notifications(commands.session).at(-1);
    assert.equal(tasksNotice?.message, 'No agents.');
    assert.equal(savedNotice?.message, 'Saved. The change applies to the next subagent.');
    assert.match(subagentsNotice?.message ?? '', /^Subagent preferences\n/);
    assert.match(subagentsNotice?.message ?? '', /rubber-duck: off/);
    assert.equal(invalidNotice?.notifyType, 'warning');
    assert.match(invalidNotice?.message ?? '', /^Usage:/);
    assert.equal(workflowsNotice?.message, 'No workflow runs.');
    assert.equal(duckNotice?.notifyType, 'warning');
    assert.equal(duckNotice?.message, 'The rubber-duck agent is not available. Turn it on with /subagents rubber-duck on.');
    assert.equal(fleetNotice?.message, 'Usage: /fleet <goal>');
    assertSurface(context, {
      surfaceId: 'PS-UI-14',
      observed: `/tasks=${JSON.stringify(tasksNotice?.message)}; /subagents edit=${JSON.stringify(savedNotice?.message)}; /subagents first line=${JSON.stringify(subagentsNotice?.message?.split('\n')[0])}; /subagents bogus=${JSON.stringify(invalidNotice?.message?.split('\n')[0])}; /workflows=${JSON.stringify(workflowsNotice?.message)}; /rubber-duck=${JSON.stringify(duckNotice?.message)}; /fleet=${JSON.stringify(fleetNotice?.message)}`,
      evidence: commands.session.capturePath,
      check: () => {
        assert.equal(tasksNotice?.message, 'No agents.');
        assert.match(subagentsNotice?.message ?? '', /^Subagent preferences\n/);
        assert.equal(workflowsNotice?.message, 'No workflow runs.');
        assert.equal(duckNotice?.message, 'The rubber-duck agent is not available. Turn it on with /subagents rubber-duck on.');
        assert.equal(fleetNotice?.message, 'Usage: /fleet <goal>');
      },
    });
  } finally {
    await commands.session.close();
  }

  // --- UI-15: a dynamic workflow asks for confirmation before it runs ---------------------------
  const workflow = await startHooks(context, 'workflow', {
    agentDir: prepareHooksAgentDir(context, 'workflow'),
    env: { COPILOT_DYNAMIC_WORKFLOWS: '1', PSTACK_HOOKS_WORKFLOW: '1' },
    answers: { confirm: (request) => request.title !== 'Run workflow hk-workflow?' },
  });
  try {
    await workflow.session.prompt('HK_WORKFLOW_RUN');
    const dialog = workflow.session.uiRequests.find((record) => record.method === 'confirm' && record.title === 'Run workflow hk-workflow?');
    const result = lastToolResult(workflow.session, 'run_dynamic_workflow');
    assert.ok(dialog, 'the workflow confirmation dialog was not shown');
    assert.match(dialog?.message ?? '', /Hook probe workflow/);
    assert.match(dialog?.message ?? '', /Effective limits:/);
    assert.equal(result?.isError, true);
    assertSurface(context, {
      surfaceId: 'PS-UI-15',
      observed: `confirm title=${JSON.stringify(dialog?.title)} message=${JSON.stringify(dialog?.message)}; declining produced tool error ${JSON.stringify(String(result?.content ?? '').slice(0, 80))}`,
      evidence: workflow.session.capturePath,
      check: () => {
        assert.ok(dialog, 'the workflow confirmation dialog was not shown');
        assert.match(dialog?.message ?? '', /Hook probe workflow/);
        assert.match(dialog?.message ?? '', /Effective limits:/);
      },
    });
  } finally {
    await workflow.session.close();
  }

  // --- UI-16: enabling a routine asks for confirmation with the draft revision ------------------
  const routine = await startHooks(context, 'routine', { agentDir: prepareHooksAgentDir(context, 'routine'), answers: { confirm: () => false } });
  try {
    await routine.session.prompt('HK_ROUTINE');
    const dialog = routine.session.uiRequests.find((record) => record.method === 'confirm' && record.title === 'Enable webhook routine?');
    const result = lastToolResult(routine.session, 'RoutineEnable');
    assert.ok(dialog, 'the routine enable confirmation was not shown');
    assert.match(dialog?.message ?? '', /"name": "hk-routine"/);
    assert.equal(result?.details?.enabled, false);
    assertSurface(context, {
      surfaceId: 'PS-UI-16',
      observed: `confirm title=${JSON.stringify(dialog?.title)} message starts ${JSON.stringify(dialog?.message?.slice(0, 80))}; declining returned enabled=${JSON.stringify(result?.details?.enabled)}`,
      evidence: routine.session.capturePath,
      check: () => {
        assert.ok(dialog, 'the routine enable confirmation was not shown');
        assert.match(dialog?.message ?? '', /"name": "hk-routine"/);
        assert.match(dialog?.message ?? '', /"revision": "[a-f0-9]{64}"/);
      },
    });
  } finally {
    await routine.session.close();
  }
}
