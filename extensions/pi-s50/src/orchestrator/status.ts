import type { RunState } from '../domain/run.ts';
import type { Gate } from '../domain/state.ts';
import { latestByClaim } from '../evidence/invalidation.ts';
import { prReadyBlockers } from '../policy/completion.ts';
import { readyFrontier } from '../scheduler/frontier.ts';
import { type NextAction, nextAction } from './coordinator.ts';

export function describeGate(gate: Gate): string {
  switch (gate.kind) {
    case 'user_workflow':
      return `user must run ${gate.action}`;
    case 'missing_skill':
      return `install ${gate.skill}: ${gate.install}`;
    case 'decisions':
      return `answer decisions: ${gate.questions.map((question) => question.id).join(', ')}`;
    case 'shared_understanding':
      return 'confirm shared understanding';
    case 'seam_confirmation':
      return `confirm test seams: ${gate.seams.join(', ')}`;
    case 'authorization':
      return `authorize ${gate.action} for ${gate.scope}`;
    default: {
      const _exhaustive: never = gate;
      return _exhaustive;
    }
  }
}

export function describeAction(action: NextAction): string {
  switch (action.kind) {
    case 'human_gate':
      return `wait: ${describeGate(action.gate)}`;
    case 'advance':
      return `advance to ${action.to}`;
    case 'invoke_skill':
      return `invoke skill ${action.skill}`;
    case 'start_nodes':
      return `start nodes ${action.ids.join(', ')}`;
    case 'verify':
      return `verify via ${action.route.kind}${action.route.kind === 'inconclusive' ? ` (${action.route.missing})` : ''}: ${action.criteria.join('; ')}`;
    case 'freeze_revision':
      return 'freeze revision';
    case 'work':
      return `${action.phase}: ${action.task}`;
    case 'done':
      return `PR ready at ${action.revision}`;
    default: {
      const _exhaustive: never = action;
      return _exhaustive;
    }
  }
}

export function renderStatus(state: RunState): string {
  const { run, graph, findings } = state;
  const action = nextAction(state);
  const blockers = run.phase === 'PR_READY' ? [] : prReadyBlockers(state);
  const open = findings.filter((finding) => finding.status === 'open');
  const stale = latestByClaim(state.evidence).filter((record) => record.state === 'STALE').length;
  const lines = [
    `objective: ${run.objective}`,
    `phase: ${run.phase} (${run.status.kind})`,
    `revision: ${run.currentRevision}${run.frozenRevision === null ? '' : ` frozen ${run.frozenRevision}`}`,
    `blockers: ${blockers.length === 0 ? 'none' : blockers.join('; ')}`,
    `open findings: ${open.length === 0 ? 'none' : open.map((finding) => `${finding.id} ${finding.severity}`).join(', ')}`,
    `ready nodes: ${
      readyFrontier(graph)
        .map((node) => node.id)
        .join(', ') || 'none'
    }`,
    `running nodes: ${
      graph.nodes
        .filter((node) => node.status === 'running')
        .map((node) => node.id)
        .join(', ') || 'none'
    }`,
    `stale evidence: ${stale}`,
    `next automatic action: ${action.kind === 'human_gate' ? 'none' : describeAction(action)}`,
    `next human gate: ${action.kind === 'human_gate' ? describeGate(action.gate) : 'none'}`,
  ];
  return `${lines.join('\n')}\n`;
}
