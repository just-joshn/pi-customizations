import type { WorkingTree } from '../edit/working-tree.ts';
import type { GitPolicy } from '../feature.ts';
import type { Snapshot } from './branch.ts';
import type { Host } from './host.ts';

/** Runtime capabilities a SAR slash command may use. Wired by `installMaintainer`. */
export interface CommandEnv {
  readonly host: Host;
  readonly snapshot: Snapshot;
  readonly save: (snapshot: Snapshot) => void;
  readonly tree: WorkingTree;
  readonly git: GitPolicy;
  /** Aider's `auto_commits` default True until the Git SAR owns the setting. */
  readonly autoCommits: boolean;
  readonly supportsImages: boolean;
  readonly sendUserMessage: (text: string) => Promise<void>;
  readonly setPhysicalModel: (model: { provider: string; id: string }) => Promise<boolean>;
  readonly findPhysicalModel: (name: string) => { provider: string; id: string } | null;
}

/** One documented slash command. The core registers it with `pi.registerCommand`. */
export interface CommandSpec {
  readonly name: string;
  readonly description: string;
  readonly run: (args: string, env: CommandEnv) => Promise<void>;
  readonly complete?: (prefix: string, env: CommandEnv) => Promise<readonly string[]>;
}
