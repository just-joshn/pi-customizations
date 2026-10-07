import { posix } from 'node:path';

import type { AuthorizationAction, Gate } from '../domain/state.ts';
import { commandsOf, hasFlag, positionals, type SimpleCommand } from './shell-words.ts';

export function grantMatches(gate: Gate, action: AuthorizationAction, scope: string): boolean {
  return gate.kind === 'authorization' && gate.action === action && gate.scope === scope;
}

type Classifier = (args: readonly string[], cwd: string) => readonly AuthorizationAction[];

const none: readonly AuthorizationAction[] = [];

const set = (...items: string[]): ReadonlySet<string> => new Set(items);

function subcommand(args: readonly string[], valued: ReadonlySet<string>): { readonly name: string; readonly rest: readonly string[] } {
  for (let index = 0; index < args.length; index += 1) {
    const word = args[index] ?? '';
    if (valued.has(word)) index += 1;
    else if (!word.startsWith('-')) return { name: word, rest: args.slice(index + 1) };
  }
  return { name: '', rest: [] };
}

const GIT_PUSH_VALUED = set('--repo', '-o', '--push-option', '--receive-pack', '--exec');

function gitPush(args: readonly string[]): readonly AuthorizationAction[] {
  if (hasFlag(args, ['--dry-run'], 'n')) return none;
  const refs = positionals(args, GIT_PUSH_VALUED).slice(1);
  const force = hasFlag(args, ['--force', '--force-with-lease'], 'f') || refs.some((ref) => ref.startsWith('+'));
  const remove = hasFlag(args, ['--delete'], 'd') || refs.some((ref) => ref.startsWith(':') && ref.length > 1);
  return [...(force ? (['force_push'] as const) : []), ...(remove ? (['destructive_data_deletion'] as const) : [])];
}

function git(args: readonly string[]): readonly AuthorizationAction[] {
  const { name, rest } = subcommand(args, set('-C', '-c', '--git-dir', '--work-tree', '--namespace'));
  switch (name) {
    case 'push':
      return gitPush(rest);
    case 'clean':
      return !hasFlag(rest, ['--dry-run'], 'n') && hasFlag(rest, ['--force'], 'f') ? ['destructive_data_deletion'] : none;
    case 'reset':
      return hasFlag(rest, ['--hard'], '') ? ['destructive_data_deletion'] : none;
    case 'branch': {
      const forced = hasFlag(rest, [], 'D') || (hasFlag(rest, ['--delete'], 'd') && hasFlag(rest, ['--force'], 'f'));
      return forced ? ['destructive_data_deletion'] : none;
    }
    default:
      return none;
  }
}

function ghApi(args: readonly string[]): readonly AuthorizationAction[] {
  const method = args.flatMap((word, index) => (word === '-X' || word === '--method' ? [args[index + 1] ?? ''] : word.startsWith('--method=') ? [word.slice(9)] : [])).at(-1);
  const fields = hasFlag(args, ['--field', '--raw-field', '--input'], 'f') || hasFlag(args, [], 'F');
  const verb = (method ?? (fields ? 'POST' : 'GET')).toUpperCase();
  const path = positionals(args, set('-X', '--method', '-H', '--header', '-f', '-F', '--field', '--raw-field', '--input', '-q', '--jq', '-t', '--template', '--hostname', '--cache'))[0] ?? '';
  if (verb === 'GET') return none;
  if (/\/merge\/?$/.test(path)) return ['merge'];
  if (/\/(comments|reviews|issues|pulls|releases)(\/\d+)?\/?$/.test(path)) return ['public_message'];
  return verb === 'DELETE' ? ['destructive_data_deletion'] : none;
}

function gh(args: readonly string[]): readonly AuthorizationAction[] {
  const words = positionals(args, set('-R', '--repo', '--hostname', '-X', '--method', '-H', '--header', '-f', '-F', '--field', '--raw-field', '-t', '--title', '-b', '--body', '-B', '--base'));
  const [group, verb] = words;
  if (group === 'api') return ghApi(args.slice(args.indexOf('api') + 1));
  if (group === 'pr' && verb === 'merge') return ['merge'];
  if ((group === 'pr' || group === 'issue') && ['create', 'comment', 'review', 'close', 'edit'].includes(verb ?? '')) return ['public_message'];
  if (group === 'release' && verb === 'create') return ['public_message'];
  return none;
}

function forge(merge: string, publish: readonly string[]): Classifier {
  return (args) => {
    const [group, verb] = positionals(args, set('-R', '--repo'));
    if ((group === 'pr' || group === 'mr') && verb === merge) return ['merge'];
    return ['pr', 'mr', 'issue'].includes(group ?? '') && publish.includes(verb ?? '') ? ['public_message'] : none;
  };
}

function vercel(args: readonly string[]): readonly AuthorizationAction[] {
  if (hasFlag(args, ['--help', '--version'], '')) return none;
  const first = positionals(args, set('--token', '-t', '--scope', '-S', '--team', '-T', '--cwd', '--local-config', '-A', '--global-config', '-Q', '-e', '--env', '-b', '--build-env', '-m', '--meta'))[0];
  if (first === undefined || ['deploy', 'redeploy', 'promote', 'rollback'].includes(first) || first.startsWith('.') || first.startsWith('/')) return ['deploy'];
  return first === 'rm' || first === 'remove' ? ['destructive_data_deletion'] : none;
}

function verbs(table: Readonly<Record<string, AuthorizationAction>>, valued: ReadonlySet<string> = set()): Classifier {
  return (args) => {
    const action = positionals(args, valued)
      .map((word) => table[word])
      .find((found) => found !== undefined);
    return action === undefined ? none : [action];
  };
}

const KUBECTL_VALUED = set('-n', '--namespace', '--context', '--kubeconfig', '--cluster', '--user', '-s', '--server', '-l', '--selector', '-f', '--filename', '-o', '--output');

function kubectl(args: readonly string[]): readonly AuthorizationAction[] {
  if (args.some((word) => word.startsWith('--dry-run') && word !== '--dry-run=none')) return none;
  const [verb, object] = positionals(args, KUBECTL_VALUED);
  if (['apply', 'create', 'replace', 'patch', 'scale', 'edit', 'set', 'autoscale', 'expose', 'run'].includes(verb ?? '')) return ['deploy'];
  if (verb === 'rollout' && ['restart', 'undo', 'resume', 'pause'].includes(object ?? '')) return ['deploy'];
  return verb === 'delete' || verb === 'drain' ? ['destructive_data_deletion'] : none;
}

function terraform(args: readonly string[]): readonly AuthorizationAction[] {
  const verb = positionals(args, set())[0];
  if (verb === 'destroy' || (verb === 'apply' && hasFlag(args, ['-destroy'], ''))) return ['destructive_data_deletion'];
  return verb === 'apply' ? ['deploy'] : none;
}

const PACKAGE_VALUED = set('--workspace', '-w', '--filter', '-F', '--prefix', '-C', '--cwd', '--registry', '--tag', '--otp', '--access', '--userconfig');

function packageManager(args: readonly string[]): readonly AuthorizationAction[] {
  if (hasFlag(args, ['--dry-run'], '')) return none;
  return positionals(args, PACKAGE_VALUED).some((word) => ['publish', 'unpublish', 'deprecate'].includes(word)) ? ['irreversible_action'] : none;
}

function cargo(args: readonly string[]): readonly AuthorizationAction[] {
  return positionals(args, set())[0] === 'publish' && !hasFlag(args, ['--dry-run'], 'n') ? ['irreversible_action'] : none;
}

function containers(args: readonly string[]): readonly AuthorizationAction[] {
  const words = positionals(args, set('-H', '--host', '--context', '-c', '--config'));
  return words[0] === 'push' || (words[0] === 'image' && words[1] === 'push') ? ['irreversible_action'] : none;
}

const TEMP_ROOTS = ['/tmp/', '/private/tmp/', '/var/folders/', '/private/var/folders/'];

function strictlyInside(path: string, root: string): boolean {
  const prefix = root.endsWith('/') ? root : `${root}/`;
  return path.startsWith(prefix) && path.length > prefix.length;
}

// Paths outside the working tree and temp roots, the tree itself, and unresolved variables could name anything.
function dangerousTarget(target: string, cwd: string): boolean {
  if (target === '') return false;
  if (target.includes('$') || target === '~' || target.startsWith('~/') || target === '*' || target === '.*') return true;
  const path = posix.normalize(target.startsWith('/') ? target : posix.join(cwd, target));
  return !strictlyInside(path, cwd) && !TEMP_ROOTS.some((root) => strictlyInside(path, root));
}

function rm(args: readonly string[], cwd: string): readonly AuthorizationAction[] {
  if (!hasFlag(args, ['--recursive'], 'r') && !hasFlag(args, [], 'R')) return none;
  return positionals(args, set()).some((target) => dangerousTarget(target, cwd)) ? ['destructive_data_deletion'] : none;
}

const DESTRUCTIVE_SQL = /\b(drop|truncate)\s+(table|database|schema)\b|\bdelete\s+from\b/i;

function sql(args: readonly string[]): readonly AuthorizationAction[] {
  return args.some((word) => DESTRUCTIVE_SQL.test(word)) ? ['destructive_data_deletion'] : none;
}

function http(args: readonly string[]): readonly AuthorizationAction[] {
  return args.some((word) => word.includes('hooks.slack.com/services')) ? ['public_message'] : none;
}

const CLASSIFIERS: Readonly<Record<string, Classifier>> = {
  git,
  gh,
  glab: forge('merge', ['create', 'note']),
  origin: forge('merge', ['create', 'comment']),
  vercel,
  netlify: verbs({ deploy: 'deploy' }),
  fly: verbs({ deploy: 'deploy' }),
  flyctl: verbs({ deploy: 'deploy' }),
  serverless: verbs({ deploy: 'deploy', remove: 'destructive_data_deletion' }),
  sls: verbs({ deploy: 'deploy', remove: 'destructive_data_deletion' }),
  gcloud: verbs({ deploy: 'deploy' }),
  helm: verbs({ install: 'deploy', upgrade: 'deploy', rollback: 'deploy', uninstall: 'destructive_data_deletion', delete: 'destructive_data_deletion' }, set('-n', '--namespace', '--kube-context', '-f', '--values')),
  kubectl,
  terraform,
  tofu: terraform,
  npm: packageManager,
  pnpm: packageManager,
  yarn: packageManager,
  bun: packageManager,
  cargo,
  twine: verbs({ upload: 'irreversible_action' }),
  gem: verbs({ push: 'irreversible_action' }),
  docker: containers,
  podman: containers,
  rm,
  psql: sql,
  mysql: sql,
  mariadb: sql,
  sqlite3: sql,
  duckdb: sql,
  sqlcmd: sql,
  'clickhouse-client': sql,
  mongosh: sql,
  curl: http,
  wget: http,
  xh: http,
};

function classify(command: SimpleCommand, cwd: string): readonly AuthorizationAction[] {
  const [program, ...args] = command.words;
  const classifier = program === undefined ? undefined : CLASSIFIERS[program];
  return classifier === undefined ? none : classifier(args, cwd);
}

// Every distinct gated action in the line, in order, so a line with two actions needs both authorized.
export function gatedActions(command: string, cwd: string): readonly AuthorizationAction[] {
  return [...new Set(commandsOf(command).flatMap((simple) => classify(simple, cwd)))];
}
