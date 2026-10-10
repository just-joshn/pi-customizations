import type { PhysicalModelRef } from '../edit/model-switch.ts';
import type { WorkingTree } from '../edit/working-tree.ts';
import type { EditFormatName, GitPolicy, RepositoryContext } from '../feature.ts';
import type { Snapshot } from './branch.ts';
import type { Host } from './host.ts';

/** Runtime capabilities a SAR slash command may use. Wired by `installMaintainer`. */
export interface CommandEnv {
  readonly host: Host;
  readonly snapshot: Snapshot;
  readonly save: (snapshot: Snapshot) => void;
  readonly tree: WorkingTree;
  readonly git: GitPolicy;
  readonly map: RepositoryContext;
  /** Resolved `--auto-commits` from the git SAR. */
  readonly autoCommits: boolean;
  readonly supportsImages: boolean;
  readonly sendUserMessage: (text: string) => Promise<void>;
  readonly setPhysicalModel: (model: PhysicalModelRef) => Promise<boolean>;
  readonly findPhysicalModel: (name: string) => PhysicalModelRef | null;
  /** Packaged default edit format for a physical model (not unrecognized-name heuristics). */
  readonly defaultEditFormat: (model: PhysicalModelRef | null) => EditFormatName;
}

/** One documented slash command. The core registers it with `pi.registerCommand`. */
export interface CommandSpec {
  readonly name: string;
  readonly description: string;
  readonly run: (args: string, env: CommandEnv) => Promise<void>;
  readonly complete?: (prefix: string, env: CommandEnv) => Promise<readonly string[]>;
}
