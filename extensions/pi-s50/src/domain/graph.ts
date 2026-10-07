export type VerificationMethod = 'test' | 'browser' | 'cli' | 'http' | 'library' | 'native' | 'review' | 'prototype' | 'web_guidelines';

export type NodeStatus = 'pending' | 'running' | 'passed' | 'failed' | 'integrated';

export type GraphNode = {
  readonly id: string;
  readonly objective: string;
  readonly dependencies: readonly string[];
  readonly owner: string;
  readonly writeSet: readonly string[];
  readonly schemas: readonly string[];
  readonly migrations: readonly string[];
  readonly definesInterfaces: readonly string[];
  readonly consumesInterfaces: readonly string[];
  readonly runtimeOwnership: readonly string[];
  readonly expectedBehavior: string;
  readonly verification: VerificationMethod;
  readonly status: NodeStatus;
};

export type Graph = { readonly schemaVersion: 1; readonly nodes: readonly GraphNode[] };
