#!/usr/bin/env node
import { COMMANDS } from './lib/commands.mjs';
// pi-rea: a dependency-free reimplementation of REA's investigation contract.
// Every command writes its evidence record before it reports, so a result cited
// in a conversation always exists on disk.
import { errorEnvelope, invalidInput, ReaError } from './lib/errors.mjs';
import { defaultStoreDir, openStore } from './lib/store.mjs';

const GLOBAL_BOOLEAN_FLAGS = new Set(['--json', '--help', '--schema']);
const USAGE = 'rea <command> [arguments] [--flags]';

/**
 * The command name is the first token that is neither a flag nor a global flag's
 * value. Knowing it first is what lets a flag be a bit flag on one command and a
 * value flag on another, instead of every unknown flag silently becoming true.
 */
function commandNameFrom(argv) {
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--store') {
      index += 1;
      continue;
    }
    if (token.startsWith('--')) continue;
    return token;
  }
  return undefined;
}

function parse(argv, booleanFlags) {
  const positionals = [];
  const args = {};
  const issues = [];
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }
    const equals = token.indexOf('=');
    const name = equals < 0 ? token : token.slice(0, equals);
    const value = equals < 0 ? undefined : token.slice(equals + 1);
    if (booleanFlags.has(name)) {
      args[name] = value === undefined ? true : value !== 'false';
      continue;
    }
    if (value !== undefined) {
      args[name] = value;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      // Record the name so an undeclared flag is reported as unknown rather than
      // as a missing value; the issue list is filtered once the command is known.
      args[name] = true;
      issues.push({ path: [name], reason: 'required', message: `${name} needs a value` });
      continue;
    }
    args[name] = next;
    index += 1;
  }
  return { positionals, args, issues };
}

function booleanFlagsFor(name) {
  const declared = name === undefined ? {} : (COMMANDS.get(name)?.flags ?? {});
  return new Set([
    ...GLOBAL_BOOLEAN_FLAGS,
    ...Object.entries(declared)
      .filter(([, shape]) => shape === 'flag')
      .map(([flag]) => flag),
  ]);
}

function knownFlags(command) {
  return new Set([...Object.keys(command.flags), ...GLOBAL_BOOLEAN_FLAGS, '--store']);
}

function validateFlags(command, args) {
  const known = knownFlags(command);
  return Object.keys(args)
    .filter((name) => !known.has(name))
    .map((name) => ({ path: [name], reason: 'unknown_flag', message: `${name} is not a flag of ${command.name}` }));
}

function parseNumberFlag(args, name, issues) {
  if (args[name] === undefined) return;
  const value = Number(args[name]);
  if (!Number.isInteger(value) || value < 0) issues.push({ path: [name], reason: 'invalid_value', message: `${name} must be a non-negative integer` });
}

function helpFor(command) {
  if (command === null) {
    const lines = ['pi-rea — reverse engineer a shipped artifact with local tools only.', '', `Usage: ${USAGE}`, '', 'Commands:'];
    for (const entry of [...COMMANDS.values()].sort((left, right) => (left.name < right.name ? -1 : 1))) lines.push(`  ${entry.name.padEnd(34)} ${entry.summary}`);
    lines.push('', 'Global flags: --json  --store <dir>  --help  --schema');
    return lines.join('\n');
  }
  const lines = [`pi-rea ${command.name} — ${command.summary}`, '', `Usage: pi-rea ${command.name} ${Object.keys(command.flags).length > 0 ? '[options]' : ''}`.trim(), '', 'Options:'];
  for (const [flag, shape] of Object.entries(command.flags)) lines.push(`  ${flag.padEnd(24)} ${shape}`);
  lines.push('', 'Global flags: --json  --store <dir>  --help');
  return lines.join('\n');
}

function schemaFor(command) {
  return {
    name: command.name,
    description: command.summary,
    options: Object.fromEntries(Object.entries(command.flags).map(([flag, shape]) => [flag, { type: shape === 'flag' ? 'boolean' : shape.includes('|') ? 'enum' : 'string', values: shape.includes('|') ? shape.split('|') : undefined }])),
  };
}

async function main(argv) {
  const name = commandNameFrom(argv);
  const { positionals, args, issues } = parse(argv, booleanFlagsFor(name));
  if (args['--help'] === true || name === undefined || name === 'help') {
    process.stdout.write(`${helpFor(name === undefined ? null : (COMMANDS.get(name) ?? null))}\n`);
    return 0;
  }
  const command = COMMANDS.get(name);
  if (command === undefined) throw invalidInput(`Unknown command: ${name}`, [{ path: ['command'], reason: 'invalid_value', message: `unknown command: ${name}` }]);
  if (args['--schema'] === true) {
    process.stdout.write(`${JSON.stringify(schemaFor(command), null, 2)}\n`);
    return 0;
  }
  const unknownFlags = new Set(validateFlags(command, args).map((issue) => issue.path[0]));
  const flagIssues = [...validateFlags(command, args), ...issues.filter((issue) => !(issue.reason === 'required' && unknownFlags.has(issue.path[0])))];
  parseNumberFlag(args, '--offset', flagIssues);
  parseNumberFlag(args, '--limit', flagIssues);
  parseNumberFlag(args, '--expected-revision', flagIssues);
  if (flagIssues.length > 0) throw invalidInput('The command arguments are not valid.', flagIssues);

  let storePromise = null;
  const storeFor = async () => {
    storePromise ??= openStore({ dir: args['--store'] ?? defaultStoreDir() });
    return storePromise;
  };
  const store = command.needsStore === false ? null : await storeFor();
  const result = await command.run({ positionals: positionals.slice(1), args, store, cwd: process.cwd() });
  const payload = result.envelope ?? result.result ?? null;
  if (args['--json'] === true) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  else if (result.plain !== undefined && result.plain !== null) process.stdout.write(`${result.plain}\n`);
  else if (payload !== null) process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  return 0;
}

try {
  const code = await main(process.argv.slice(2));
  process.exitCode = code;
} catch (error) {
  process.stdout.write(`${JSON.stringify(errorEnvelope(error), null, 2)}\n`);
  if (!(error instanceof ReaError)) {
    if (process.env.PI_REA_DEBUG === '1') process.stderr.write(`${error?.stack ?? error}\n`);
  }
  process.exitCode = 1;
}
