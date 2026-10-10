import type { Host } from './core/host.ts';
import type { Fence } from './edit/fences.ts';
import type { Notices, WorkingTree } from './edit/working-tree.ts';
import type { AnyOptionSpec, ResolvedSettings, SarName } from './settings/spec.ts';

export type { SarName } from './settings/spec.ts';

/** Everything a SAR's port factory receives. */
export interface FeatureEnv {
  readonly settings: ResolvedSettings;
  readonly host: Host;
  readonly cwd: string;
}

export interface CommandEnv {
  readonly host: Host;
}

/** One documented slash command. The core registers it with `pi.registerCommand`. */
export interface CommandSpec {
  readonly name: string;
  readonly description: string;
  readonly run: (args: string, env: CommandEnv) => Promise<void>;
}

export interface Feature<Port> {
  readonly name: SarName;
  /** Every documented option of this SAR, with Aider's CLI default and help text. */
  readonly options: readonly AnyOptionSpec[];
  /** Every documented slash command of this SAR. */
  readonly commands: readonly CommandSpec[];
  /** Builds this SAR's lifecycle port from resolved settings and host capabilities. */
  readonly create: (env: FeatureEnv) => Port;
}

/** Aider's `edit_format` values, which are also its chat modes (`--chat-mode` is an alias). */
export const EDIT_FORMAT_NAMES = ['architect', 'ask', 'context', 'diff', 'diff-fenced', 'editor-diff', 'editor-diff-fenced', 'editor-whole', 'help', 'patch', 'udiff', 'udiff-simple', 'whole'] as const;
export type EditFormatName = (typeof EDIT_FORMAT_NAMES)[number];

export const isEditFormatName = (name: string): name is EditFormatName => EDIT_FORMAT_NAMES.some((format) => format === name);

/** An edit tuple: Aider's coders put the target path (or None) first. */
export type PathEdit = readonly [path: string | null, ...rest: unknown[]];

/** What a format's `get_edits`, `apply_edits_dry_run`, and `apply_edits` read from the coder. */
export interface EditContext {
  readonly fence: Fence;
  readonly root: string;
  /** `get_inchat_relative_files()`: sorted relative paths of the editable files. */
  readonly inchatRelativeFiles: readonly string[];
  readonly absRootPath: (path: string) => string;
  readonly tree: WorkingTree;
  readonly notices: Notices;
  readonly signal?: AbortSignal | undefined;
}

/** One Aider coder's reply-text edit format. Each format keeps its own edit tuple type. */
export interface EditFormat<E extends PathEdit> {
  readonly name: EditFormatName;
  readonly prompts: EditFormatName;
  mutationPaths(edit: E): readonly string[];
  getEdits(content: string, context: EditContext): E[] | Promise<E[]>;
  applyEditsDryRun(edits: readonly E[], context: EditContext): E[] | Promise<E[]>;
  applyEdits(edits: readonly E[], context: EditContext): Promise<void>;
}

/** `prepare_to_edit`: keeps the edits whose paths the user allows, in order. */
export type PrepareToEdit = <E extends PathEdit>(edits: readonly E[], context: EditContext) => Promise<E[]>;

/** The edits that survived permission, and the step that writes them. */
export interface EditPlan {
  readonly targets: readonly (string | null)[];
  apply(): Promise<void>;
}

/** A format with its edit tuple type hidden, so formats of different tuple types share one registry. */
export interface RegisteredEditFormat {
  readonly name: EditFormatName;
  readonly prompts: EditFormatName;
  withPlan<T>(content: string, context: EditContext, prepare: PrepareToEdit, use: (plan: EditPlan) => Promise<T>): Promise<T>;
}

export function registerEditFormat<E extends PathEdit>(format: EditFormat<E>): RegisteredEditFormat {
  return {
    name: format.name,
    prompts: format.prompts,
    async withPlan(content, context, prepare, use) {
      context.signal?.throwIfAborted();
      const raw = await format.getEdits(content, context);
      const paths = [...context.inchatRelativeFiles, ...raw.flatMap((edit) => format.mutationPaths(edit))].map(context.absRootPath);
      return context.tree.mutate(
        paths,
        async (tree) => {
          const locked = { ...context, tree };
          const edits = await format.applyEditsDryRun(raw, locked);
          const prepared = await prepare(edits, locked);
          return use({ targets: prepared.map((edit) => edit[0]), apply: () => format.applyEdits(prepared, locked) });
        },
        context.signal,
      );
    },
  };
}

/** Files named on the command line before the first request, as Aider's `main` collects them. */
export interface InitialFiles {
  readonly editable: readonly string[];
  readonly readOnly: readonly string[];
}

/** The edit SAR's port: the format registry and the edit settings the coder hub reads. */
export interface EditFormats {
  readonly formats: ReadonlyMap<EditFormatName, RegisteredEditFormat>;
  /** `--edit-format`, or null to use the model's default format. */
  readonly requestedFormat: EditFormatName | null;
  readonly initialFiles: InitialFiles;
  readonly dryRun: boolean;
  readonly yesAlways: boolean | null;
  readonly tree: WorkingTree;
}

export type CommitContext = { readonly kind: 'conversation'; readonly text: string } | { readonly kind: 'linter' };
export type CommitResult = { readonly kind: 'disabled' } | { readonly kind: 'committed'; readonly hash: string; readonly message: string } | { readonly kind: 'unchanged' } | { readonly kind: 'failed'; readonly error: string };
export type CheckpointResult = { readonly kind: 'disabled' } | { readonly kind: 'protected' } | { readonly kind: 'unnecessary' } | { readonly kind: 'failed'; readonly error: string };

/** The Git parts of the coder hub (`aider/repo.py` and the Git calls in `base_coder.py`). */
export interface GitPolicy {
  /** `repo.root`, or null when there is no repository. */
  repoRoot(): string | null;
  /** `repo.get_tracked_files()`, or null when there is no repository. */
  trackedFiles(): Promise<readonly string[] | null>;
  /** `need_to_add` in `allowed_to_edit`: a repository exists and does not hold the path. */
  needToAdd(path: string): Promise<boolean>;
  isGitIgnored(path: string): Promise<boolean>;
  /** Stages a file the edit created, when automatic commits are on. */
  stageNewFile(absPath: string): Promise<void>;
  /** `check_for_dirty_commit`'s test: dirty commits are on and the path has uncommitted changes. */
  needsDirtyCommit(path: string): Promise<boolean>;
  dirtyCommit(paths: ReadonlySet<string>, signal?: AbortSignal): Promise<CheckpointResult>;
  autoCommit(paths: ReadonlySet<string | null>, context: CommitContext, signal?: AbortSignal): Promise<CommitResult>;
}

export interface MapRequest {
  readonly editable: ReadonlySet<string>;
  readonly readOnly: ReadonlySet<string>;
  readonly curMessageText: string;
}

/** The repository-map parts of the coder hub (`aider/repomap.py`, `get_repo_map`). */
export interface RepositoryContext {
  repoMap(request: MapRequest, signal?: AbortSignal): Promise<string | null>;
}

export type CheckOutcome = { readonly kind: 'disabled' } | { readonly kind: 'not-run' } | { readonly kind: 'passed' } | { readonly kind: 'failed'; readonly report: string } | { readonly kind: 'unavailable'; readonly reason: string };

/** The lint and test parts of the coder hub. */
export interface Validation {
  lintEdited(paths: ReadonlySet<string | null>, signal?: AbortSignal): Promise<CheckOutcome>;
  testEdited(signal?: AbortSignal): Promise<CheckOutcome>;
}

/** The Git port before the Git SAR lands: no repository, and every operation reports itself disabled. */
export const disabledGitPolicy: GitPolicy = {
  repoRoot: () => null,
  trackedFiles: async () => null,
  needToAdd: async () => false,
  isGitIgnored: async () => false,
  stageNewFile: async () => {},
  needsDirtyCommit: async () => false,
  dirtyCommit: async () => ({ kind: 'disabled' }),
  autoCommit: async () => ({ kind: 'disabled' }),
};

export const disabledRepositoryContext: RepositoryContext = { repoMap: async () => null };

export const disabledValidation: Validation = {
  lintEdited: async () => ({ kind: 'disabled' }),
  testEdited: async () => ({ kind: 'disabled' }),
};

export interface Ports {
  readonly edit: EditFormats;
  readonly git: GitPolicy;
  readonly map: RepositoryContext;
  readonly lint: Validation;
}

/** A feature together with its SAR name, so a list of features can be told apart. */
export type SarFeature = { [N in SarName]: Feature<Ports[N]> & { readonly name: N } }[SarName];
