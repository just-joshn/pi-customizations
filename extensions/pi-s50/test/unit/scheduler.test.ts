import { describe, expect, test } from 'vitest';
import type { Graph } from '../../src/domain/graph.ts';
import type { RunState } from '../../src/domain/run.ts';
import { apply } from '../../src/orchestrator/coordinator.ts';
import { validateGraph } from '../../src/orchestrator/handlers.ts';
import { conflict, patternsOverlap } from '../../src/scheduler/conflicts.ts';
import { readyFrontier } from '../../src/scheduler/frontier.ts';
import { schedule } from '../../src/scheduler/ownership.ts';
import { fixedClock } from '../support/clock.ts';
import { expectOk, freshRun, graphNode, NO_CAPS, node, PARALLEL_CAPS } from './support.ts';

function implementing(graph: Graph, capabilities = PARALLEL_CAPS): RunState {
  const base = freshRun({ capabilities });
  return { ...base, run: { ...base.run, phase: 'IMPLEMENT' }, graph };
}

describe('graph construction', () => {
  test('vertical slices build a pending graph', () => {
    const base = freshRun();
    const state = { ...base, run: { ...base.run, phase: 'BUILD_GRAPH' as const } };
    const outcome = apply(state, { kind: 'build_graph', nodes: [node('list'), node('export', { dependencies: ['list'] })] }, fixedClock());
    expect(outcome.kind === 'ok' && outcome.state.graph.nodes.map((item) => [item.id, item.status, item.dependencies])).toEqual([
      ['list', 'pending', []],
      ['export', 'pending', ['list']],
    ]);
  });

  test.for(['database', 'Backend', ' tests ', 'API', 'ui', 'schema', 'migration', 'frontend'])('horizontal objective %j is rejected', (objective) => {
    expect(validateGraph([node('a', { objective })])).toBe(`node a objective "${objective}" is a horizontal layer; slice vertically`);
  });

  test.for([
    ['unknown dependency', [node('a', { dependencies: ['ghost'] })], 'node a depends on unknown node ghost'],
    ['cycle', [node('a', { dependencies: ['b'] }), node('b', { dependencies: ['a'] })], 'dependency cycle through a'],
    ['empty write set', [node('a', { writeSet: [] })], 'node a has an empty write set'],
    ['duplicate id', [node('a'), node('a')], 'duplicate node id a'],
    ['empty graph', [], 'graph needs at least one node'],
  ] as const)('%s is rejected', ([, nodes, reason]) => {
    expect(validateGraph(nodes)).toBe(reason);
  });
});

describe('frontier', () => {
  test('ready frontier holds pending nodes with done deps', () => {
    const graph: Graph = {
      schemaVersion: 1,
      nodes: [graphNode('a', 'integrated'), graphNode('b', 'pending', { dependencies: ['a'] }), graphNode('c', 'pending', { dependencies: ['b'] }), graphNode('d', 'running')],
    };
    expect(readyFrontier(graph).map((item) => item.id)).toEqual(['b']);
  });

  test('starting a node with unfinished deps is rejected', () => {
    const graph: Graph = { schemaVersion: 1, nodes: [graphNode('a', 'running'), graphNode('b', 'pending', { dependencies: ['a'] })] };
    expect(apply(implementing(graph), { kind: 'start_nodes', ids: ['b'] }, fixedClock())).toEqual({ kind: 'rejected', reason: 'node b is not ready; blocked by a', gate: null });
  });
});

describe('concurrency', () => {
  const disjoint: Graph = { schemaVersion: 1, nodes: [graphNode('a', 'pending'), graphNode('b', 'pending')] };

  test('disjoint write sets run concurrently in worktrees', () => {
    const outcome = apply(implementing(disjoint), { kind: 'start_nodes', ids: ['a', 'b'] }, fixedClock());
    expect(outcome.kind === 'ok' && outcome.state.graph.nodes.map((item) => item.status)).toEqual(['running', 'running']);
    expect(schedule(disjoint, PARALLEL_CAPS)).toEqual({
      concurrent: true,
      nodes: [
        { id: 'a', workspace: '.s50/worktrees/a' },
        { id: 'b', workspace: '.s50/worktrees/b' },
      ],
      serializedBecause: [],
    });
  });

  test('overlapping write sets serialize', () => {
    const graph: Graph = { schemaVersion: 1, nodes: [graphNode('a', 'pending', { writeSet: ['src/**'] }), graphNode('b', 'pending', { writeSet: ['src/b/x.ts'] })] };
    expect(apply(implementing(graph), { kind: 'start_nodes', ids: ['a', 'b'] }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'serialized: a conflicts with b: overlapping write set src/** / src/b/x.ts',
      gate: null,
    });
    expect(schedule(graph, PARALLEL_CAPS).nodes).toEqual([{ id: 'a', workspace: '.' }]);
  });

  test('shared schema serializes', () => {
    const a = graphNode('a', 'pending', { schemas: ['invoices'] });
    const b = graphNode('b', 'pending', { schemas: ['invoices'] });
    expect(conflict(a, b)).toBe('shared schema invoices');
  });

  test.for([
    [{ migrations: ['001'] }, { migrations: ['001'] }, 'shared migration 001'],
    [{ definesInterfaces: ['Api'] }, { consumesInterfaces: ['Api'] }, 'interface Api defined by a consumed by b'],
    [{ runtimeOwnership: ['port:3000'] }, { runtimeOwnership: ['port:3000'] }, 'shared runtime ownership port:3000'],
  ] as const)('conflict reports %o vs %o', ([left, right, reason]) => {
    expect(conflict(graphNode('a', 'pending', left), graphNode('b', 'pending', right))).toBe(reason);
  });

  test('host without isolated workers serializes', () => {
    expect(apply(implementing(disjoint, NO_CAPS), { kind: 'start_nodes', ids: ['a', 'b'] }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'serialized: concurrent nodes require independent agents with isolated worktrees',
      gate: null,
    });
  });

  test.for([
    ['src/a/**', 'src/a/b.ts', true],
    ['src/a/**', 'src/ab/c.ts', false],
    ['src/*.ts', 'src/x/y.ts', false],
    ['src/a/**', 'src/**', true],
    ['docs/x.md', 'docs/x.md', true],
  ] as const)('%s overlaps %s: %s', ([a, b, expected]) => {
    expect(patternsOverlap(a, b)).toBe(expected);
  });
});

describe('serialization across calls', () => {
  test('a second start cannot join a conflicting running node', () => {
    const graph: Graph = { schemaVersion: 1, nodes: [graphNode('a', 'pending', { writeSet: ['src/**'] }), graphNode('b', 'pending', { writeSet: ['src/b/x.ts'] })] };
    const running = expectOk(apply(implementing(graph), { kind: 'start_nodes', ids: ['a'] }, fixedClock()));
    expect(apply(running, { kind: 'start_nodes', ids: ['b'] }, fixedClock())).toEqual({
      kind: 'rejected',
      reason: 'serialized: a conflicts with b: overlapping write set src/** / src/b/x.ts',
      gate: null,
    });
  });
});
