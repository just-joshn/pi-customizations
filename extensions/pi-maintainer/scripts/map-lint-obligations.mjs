#!/usr/bin/env node
// Build the lint SAR obligation map: open ledger rows for uncovered behavioral
// clusters, and coverage.json entries for every lint-slice census unit.
// Rerun: node scripts/map-lint-obligations.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { census } from './census.mjs';

const packageRoot = resolve(fileURLToPath(new URL('..', import.meta.url)));
const readJson = (path) => JSON.parse(readFileSync(join(packageRoot, path), 'utf8'));
const writeJson = (path, value) => writeFileSync(join(packageRoot, path), `${JSON.stringify(value, null, 2)}\n`);

const sources = readJson('parity/sources.json');
const testOwners = readJson('parity/test-owners.json');
const moduleOwners = sources.testModuleOwners ?? {};

function sliceOf(unitId) {
  const [group = '', module = ''] = unitId.split('/');
  if (group !== 'aider-test') return group.replace(/^ev-/, '');
  return Object.hasOwn(moduleOwners, module) ? moduleOwners[module] : testOwners[unitId];
}

/** Existing open lint rows already in the ledger; leave their records untouched. */
const EXISTING_OPEN = new Set([
  'lint.followup.commit-before-validation',
  'lint.followup.order',
  'lint.followup.reflect-failures',
  'lint.options.auto-lint-auto-test',
  'lint.python.checks',
  'lint.test.command-output',
  'lint.shell.approve-and-run',
  'lint.run.local-shell',
]);

/**
 * Additional open behavioral clusters. Do not dump behavior into nonclaims.
 * @type {Array<{id: string, behavior: string, aider: string[], kind?: string, fix?: object}>}
 */
const OPEN_ROWS = [
  {
    id: 'lint.options.lint-cmd-mapping',
    behavior:
      'parse_lint_cmds accepts only language-prefixed commands matching ^[a-z]+:.*, maps unprefixed commands under None, strips whitespace, and lets later entries for the same key win.',
    aider: ['aider/args.py:526-565', 'aider/main.py:278-302'],
  },
  {
    id: 'lint.options.oneshot-flags',
    behavior:
      'Startup --lint runs the explicit lint workflow, and --test requires --test-cmd otherwise exiting with status 1, before optional commit and process exit.',
    aider: ['aider/main.py:1053-1073', 'aider/args.py:526-565'],
  },
  {
    id: 'lint.dispatch.precedence',
    behavior:
      'Without an explicit lint command override, Linter chooses a global configured command, else a language-specific checker, else tree-sitter syntax fallback, and filename recognition happens before selecting the global command.',
    aider: ['aider/linter.py:21-80'],
  },
  {
    id: 'lint.dispatch.unknown-skip',
    behavior:
      'Unknown or unsupported filename extensions produce no lint report under automatic and global-command dispatch, so an all-language command still skips unrecognized files.',
    aider: ['aider/linter.py:21-80'],
  },
  {
    id: 'lint.tree-sitter.syntax-errors',
    behavior:
      'Tree-sitter syntax fallback parses UTF-8 bytes and records zero-based start rows for ERROR and missing nodes without exposing column numbers.',
    aider: ['aider/linter.py:80-166'],
  },
  {
    id: 'lint.custom.append-relpath',
    behavior:
      'Custom lint appends one oslex-quoted relative filename to the configured shell string, runs through the subprocess path, discards output on exit zero, and turns nonzero output into diagnostic context.',
    aider: ['aider/linter.py:118-166', 'aider/run_cmd.py:42-86'],
  },
  {
    id: 'lint.diagnostics.line-extraction',
    behavior:
      'find_filenames_and_linenums extracts filename to one-based line-number sets from diagnostic text using a word-boundary filename pattern followed by :<line>.',
    aider: ['aider/linter.py:171-174,272-285'],
  },
  {
    id: 'lint.diagnostics.context-render',
    behavior:
      'Lint errors are rendered for the model under a fix-any-errors header with tree context around the extracted error lines.',
    aider: ['aider/linter.py:80-166,272-285'],
  },
  {
    id: 'lint.selection.edit-targets',
    behavior:
      'Automatic lint runs over the authorized edit-target set from apply_updates, not a post-write Git diff, including after partial failures and during global dry-run.',
    aider: ['aider/coders/base_coder.py:2267-2337,1585-1623'],
  },
  {
    id: 'lint.lifecycle.message-reset',
    behavior:
      'init_before_message resets edited-file accumulation, reflection state, lint and test outcomes, suggested commands, and related per-message counters at the start of each user-message lifecycle.',
    aider: ['aider/coders/base_coder.py:864-945'],
  },
  {
    id: 'lint.reflection.budget',
    behavior:
      'The shared reflection budget defaults to three additional requests after the original response and counts lint errors, test errors, malformed edits, and other reflection sources together.',
    aider: ['aider/coders/base_coder.py:1585-1623'],
  },
  {
    id: 'lint.commit.post-lint',
    behavior:
      'After automatic lint on selected targets, the coder attempts another commit using the context string "Ran the linter" whether or not diagnostics were produced.',
    aider: ['aider/coders/base_coder.py:1585-1623,2375-2423'],
  },
  {
    id: 'lint.test.callable-no-chat',
    behavior:
      'A callable test command is invoked directly, prints and returns truthy errors, and does not change cwd or insert chat messages.',
    aider: ['aider/commands.py:993-1011'],
  },
  {
    id: 'lint.test.no-command-noop',
    behavior:
      'cmd_test with neither an argument nor a configured test command returns silently without running a process.',
    aider: ['aider/commands.py:993-1047'],
  },
  {
    id: 'lint.commands.lint-file-selection',
    behavior:
      '/lint requires a repository and selects explicit filenames, otherwise chat files, otherwise dirty files unioning staged and unstaged paths.',
    aider: ['aider/commands.py:356-409'],
  },
  {
    id: 'lint.oneshot.test-exit',
    behavior:
      'Startup --test ignores returned failure feedback for model fixing unless io.placeholder is populated, and child test failure is not propagated as Aider process exit status.',
    aider: ['aider/main.py:1053-1073,1272-1274'],
  },
  {
    id: 'lint.apply.bypasses-validation',
    behavior:
      '--apply calls only apply_updates on a saved response and bypasses response-tail lint, shell, and test validation.',
    aider: ['aider/main.py:975-993'],
  },
  {
    id: 'lint.coder.ask-architect',
    behavior:
      'Ask mode produces no edits because get_edits returns an empty list, while architect mode inherits ask but still runs editor-path validation when the editor applies edits.',
    aider: ['aider/coders/base_coder.py:931-945,1585-1623'],
  },
  {
    id: 'lint.fail.ambiguous-pass',
    behavior:
      'A falsy lint result can mean clean, unsupported, unreadable, or unavailable parser, and a falsy test result can mean success or no configured command.',
    aider: ['aider/linter.py:70-80', 'aider/commands.py:993-1054'],
  },
  {
    id: 'lint.fail.explicit-unknown-command',
    behavior:
      'An explicit lint command bypasses unknown-file dispatch skipping, and a failed unknown command can still fail while building model-facing diagnostic context.',
    aider: ['aider/linter.py:118-166'],
  },
  {
    id: 'lint.fail.root-none-path',
    behavior:
      'When Linter.root is None, relative-name conversion preserves the incoming path object so a pathlib.Path can reach Flake8 command-header string joins unsafely.',
    aider: ['aider/linter.py:21-80,80-116'],
  },
  {
    id: 'lint.fail.stale-diagnostics',
    behavior:
      'Tree-sitter and compile checks use the initially read file bytes while Flake8 and custom commands read the on-disk file, so a modifying command can leave repair context stale relative to disk.',
    aider: ['aider/linter.py:80-166'],
  },
  {
    id: 'lint.security.shell-trust',
    behavior:
      'Lint, test, and shell command strings run as trusted arbitrary shell execution under the user account; filename quoting does not sandbox compound commands or redirections.',
    aider: ['aider/run_cmd.py:11-23,42-86', 'aider/linter.py:118-166'],
  },
  {
    id: 'lint.docs.lint-flag-typo',
    behavior:
      'The --lint option is boolean one-shot lint; language-specific checkers are configured only through --lint-cmd "language: command".',
    aider: ['aider/website/docs/usage/lint-test.md:31-34', 'aider/args.py:526-565'],
    kind: 'fix',
    fix: {
      defect:
        'The usage guide shows --lint "language: cmd", but --lint is a boolean one-shot flag and language mappings belong to --lint-cmd.',
      intent:
        'args.py declares --lint as store_true and --lint-cmd as the repeatable language-command mapping; the guide should match those flags.',
      behavior:
        'The --lint option is boolean one-shot lint; language-specific checkers are configured only through --lint-cmd "language: command".',
    },
  },
];

function rows(...ids) {
  return { rows: ids };
}

function nonclaim(category, note) {
  return { nonclaim: category, note };
}

const CORE_PIPELINE = rows(
  'lint.followup.order',
  'lint.python.checks',
  'lint.test.command-output',
  'lint.run.local-shell',
);

const SECTION_RULES = {
  'provenance-and-scope': nonclaim('provenance', 'pinned checkout, evidence classes, and reconstruction date'),
  'architectural-summary': rows(
    'lint.options.auto-lint-auto-test',
    'lint.followup.order',
    'lint.test.command-output',
  ),
  'recovered-component-boundaries': CORE_PIPELINE,
  'data-contracts': rows(
    'lint.python.checks',
    'lint.diagnostics.context-render',
    'lint.test.command-output',
    'lint.fail.ambiguous-pass',
    'lint.lifecycle.message-reset',
  ),
  'edit-targets-versus-changed-files': rows('lint.selection.edit-targets'),
  'configuration-exact-controls-and-precedence': rows(
    'lint.options.auto-lint-auto-test',
    'lint.options.lint-cmd-mapping',
    'lint.options.oneshot-flags',
    'lint.docs.lint-flag-typo',
  ),
  'full-lifecycle-state-flow': rows(
    'lint.lifecycle.message-reset',
    'lint.followup.commit-before-validation',
    'lint.followup.order',
    'lint.followup.reflect-failures',
    'lint.shell.approve-and-run',
    'lint.commit.post-lint',
    'lint.reflection.budget',
    'lint.selection.edit-targets',
  ),
  'lint-internals': rows(
    'lint.dispatch.precedence',
    'lint.dispatch.unknown-skip',
    'lint.python.checks',
    'lint.tree-sitter.syntax-errors',
    'lint.custom.append-relpath',
    'lint.diagnostics.line-extraction',
    'lint.diagnostics.context-render',
  ),
  'test-internals': rows(
    'lint.test.command-output',
    'lint.test.callable-no-chat',
    'lint.test.no-command-noop',
    'lint.run.local-shell',
  ),
  'execution-platform': rows('lint.run.local-shell', 'lint.security.shell-trust'),
  'manual-and-one-shot-distinctions': rows(
    'lint.commands.lint-file-selection',
    'lint.test.command-output',
    'lint.shell.approve-and-run',
    'lint.options.oneshot-flags',
    'lint.oneshot.test-exit',
    'lint.apply.bypasses-validation',
  ),
  'coder-inheritance-and-commit-interaction': rows(
    'lint.coder.ask-architect',
    'lint.followup.commit-before-validation',
    'lint.commit.post-lint',
  ),
  'source-map': nonclaim('provenance', 'source path registry for lint components at the pinned commit'),
  'dependencies-versions-and-roles': rows(
    'lint.python.checks',
    'lint.tree-sitter.syntax-errors',
    'lint.run.local-shell',
    'lint.custom.append-relpath',
  ),
  'replay-commands-and-evidence': nonclaim(
    'evidence',
    'reproduction commands and retained probe artifact pointers',
  ),
  'reconstruction-review': nonclaim('meta', 'independent review note without a new observable contract'),
  'failure-semantics-security-and-quality-attributes': rows(
    'lint.selection.edit-targets',
    'lint.fail.ambiguous-pass',
    'lint.fail.explicit-unknown-command',
    'lint.fail.root-none-path',
    'lint.docs.lint-flag-typo',
    'lint.dispatch.unknown-skip',
    'lint.security.shell-trust',
    'lint.fail.stale-diagnostics',
  ),
  'coverage-and-reconstruction-limits': nonclaim(
    'meta',
    'stated verification bounds and remaining unexercised boundaries',
  ),
};

const UNIT_OVERRIDES = {
  'lint/provenance-and-scope/p3': rows(
    'lint.options.auto-lint-auto-test',
    'lint.followup.order',
    'lint.python.checks',
    'lint.test.command-output',
  ),
  'lint/architectural-summary/p3': nonclaim(
    'evidence',
    'runtime Python version and installed-versus-checkout hash observations',
  ),
  'lint/architectural-summary/p4': nonclaim(
    'evidence',
    'setuptools package-discovery observation for the incomplete install',
  ),
  'lint/recovered-component-boundaries/r5': nonclaim(
    'out-of-scope',
    'edit-format coder parsing belongs to the edit SAR',
  ),
  'lint/configuration-exact-controls-and-precedence/p8': nonclaim(
    'meta',
    'configargparse precedence is shared configuration infrastructure',
  ),
  'lint/configuration-exact-controls-and-precedence/p9': nonclaim(
    'meta',
    'dotenv load order is shared configuration infrastructure',
  ),
  'lint/full-lifecycle-state-flow/p3': nonclaim(
    'out-of-scope',
    'exhausted-response and file-context reflection before edits belong to the edit SAR',
  ),
  'lint/dependencies-versions-and-roles/p1': nonclaim(
    'evidence',
    'Python version range and lockfile loading preamble',
  ),
  'lint/dependencies-versions-and-roles/r11': nonclaim(
    'evidence',
    'configargparse and PyYAML versions outside lint runtime contracts',
  ),
  'lint/dependencies-versions-and-roles/r12': nonclaim(
    'evidence',
    'python-dotenv version outside lint runtime contracts',
  ),
  'lint/dependencies-versions-and-roles/r13': nonclaim(
    'evidence',
    'GitPython version outside lint runtime contracts',
  ),
  'lint/dependencies-versions-and-roles/r14': nonclaim(
    'evidence',
    'rich and litellm versions outside lint runtime contracts',
  ),
  'lint/dependencies-versions-and-roles/r15': nonclaim(
    'evidence',
    'pathspec version outside lint runtime contracts',
  ),
  'lint/dependencies-versions-and-roles/p16': nonclaim(
    'evidence',
    'lock citation and installed-version artifact pointers',
  ),
  'lint/dependencies-versions-and-roles/p17': rows(
    'lint.tree-sitter.syntax-errors',
    'lint.python.checks',
  ),
  'lint/dependencies-versions-and-roles/p18': rows('lint.tree-sitter.syntax-errors'),
  'lint/dependencies-versions-and-roles/p19': rows('lint.custom.append-relpath', 'lint.run.local-shell'),
  'lint/failure-semantics-security-and-quality-attributes/p1': rows('lint.selection.edit-targets'),
  'lint/failure-semantics-security-and-quality-attributes/p5': rows(
    'lint.dispatch.unknown-skip',
    'lint.docs.lint-flag-typo',
  ),
  'lint/coverage-and-reconstruction-limits/p1': nonclaim(
    'evidence',
    'recorded focused unittest execution totals',
  ),
  'lint/coverage-and-reconstruction-limits/p2': nonclaim(
    'evidence',
    'recorded probe and orchestration case counts',
  ),
};

const EVIDENCE_RULES = {
  'ev-lint/probe/python-valid': rows('lint.python.checks'),
  'ev-lint/probe/python-undefined': rows('lint.python.checks', 'lint.diagnostics.context-render'),
  'ev-lint/probe/python-syntax': rows('lint.python.checks', 'lint.tree-sitter.syntax-errors'),
  'ev-lint/probe/javascript-syntax': rows('lint.tree-sitter.syntax-errors', 'lint.dispatch.precedence'),
  'ev-lint/probe/typescript-skipped': rows('lint.dispatch.unknown-skip'),
  'ev-lint/probe/unknown-extension-skipped': rows('lint.dispatch.unknown-skip'),
  'ev-lint/probe/python-style-ignored': rows('lint.python.checks'),
  'ev-lint/probe/custom-success-output-discarded': rows('lint.custom.append-relpath'),
  'ev-lint/probe/custom-failure-empty-output': rows(
    'lint.custom.append-relpath',
    'lint.diagnostics.context-render',
  ),
  'ev-lint/probe/custom-failure-diagnostic': rows(
    'lint.custom.append-relpath',
    'lint.diagnostics.line-extraction',
    'lint.diagnostics.context-render',
  ),
  'ev-lint/probe/global-unknown-extension-skipped': rows(
    'lint.dispatch.unknown-skip',
    'lint.dispatch.precedence',
  ),
  'ev-lint/probe/explicit-unknown-command-fails-in-context-renderer': rows(
    'lint.fail.explicit-unknown-command',
  ),
  'ev-lint/probe/python-root-path': rows('lint.fail.root-none-path', 'lint.python.checks'),
  'ev-lint/probe/python-root-path~2': rows('lint.fail.root-none-path', 'lint.python.checks'),
  'ev-lint/probe/tree-sitter-zero-based': rows('lint.tree-sitter.syntax-errors'),
  'ev-lint/probe/diagnostic-line-extraction': rows('lint.diagnostics.line-extraction'),
  'ev-lint/probe/test-success-output-not-in-chat': rows('lint.test.command-output'),
  'ev-lint/probe/test-failure-output-in-chat': rows('lint.test.command-output'),
  'ev-lint/probe/test-failure-empty-output-still-in-chat': rows('lint.test.command-output'),
  'ev-lint/probe/callable-failure-no-chat-insertion': rows('lint.test.callable-no-chat'),
  'ev-lint/probe/configured-test-fallback': rows('lint.test.command-output', 'lint.test.no-command-noop'),
  'ev-lint/probe/no-test-command-noop': rows('lint.test.no-command-noop'),
  'ev-lint/probe/runner-merges-stderr': rows('lint.run.local-shell'),
  'ev-lint/orchestration/no-edits-no-checks': rows(
    'lint.selection.edit-targets',
    'lint.followup.order',
  ),
  'ev-lint/orchestration/both-checks-pass': rows(
    'lint.followup.order',
    'lint.options.auto-lint-auto-test',
    'lint.test.command-output',
  ),
  'ev-lint/orchestration/accepted-lint-failure-defers-test': rows(
    'lint.followup.reflect-failures',
    'lint.followup.order',
  ),
  'ev-lint/orchestration/declined-lint-failure-runs-test': rows(
    'lint.followup.reflect-failures',
    'lint.followup.order',
    'lint.test.command-output',
  ),
  'ev-lint/orchestration/disabled-lint-runs-test': rows(
    'lint.options.auto-lint-auto-test',
    'lint.test.command-output',
  ),
  'ev-lint/orchestration/disabled-test-still-lints': rows(
    'lint.options.auto-lint-auto-test',
    'lint.python.checks',
  ),
  'ev-lint/orchestration/reflection-limit': rows('lint.reflection.budget', 'lint.followup.reflect-failures'),
  'ev-lint/oneshot/test-exit': rows('lint.oneshot.test-exit', 'lint.options.oneshot-flags'),
};

const TEST_RULES = {
  'aider-test/test_commands/TestCommands.test_cmd_test_unbound_local_error': rows(
    'lint.test.command-output',
  ),
  'aider-test/test_commands/TestCommands.test_cmd_test_returns_output_on_failure': rows(
    'lint.test.command-output',
  ),
  'aider-test/test_commands/TestCommands.test_cmd_lint_with_dirty_file': rows(
    'lint.commands.lint-file-selection',
  ),
  'aider-test/test_main/TestMain.test_lint_option': rows('lint.options.oneshot-flags'),
  'aider-test/test_linter/TestLinter.test_init': rows('lint.dispatch.precedence'),
  'aider-test/test_linter/TestLinter.test_set_linter': rows(
    'lint.dispatch.precedence',
    'lint.options.lint-cmd-mapping',
  ),
  'aider-test/test_linter/TestLinter.test_get_rel_fname': rows('lint.fail.root-none-path'),
  'aider-test/test_linter/TestLinter.test_run_cmd': rows('lint.custom.append-relpath', 'lint.run.local-shell'),
  'aider-test/test_linter/TestLinter.test_run_cmd_win': rows(
    'lint.custom.append-relpath',
    'lint.run.local-shell',
  ),
  'aider-test/test_linter/TestLinter.test_run_cmd_with_errors': rows(
    'lint.custom.append-relpath',
    'lint.diagnostics.context-render',
  ),
  'aider-test/test_linter/TestLinter.test_run_cmd_with_special_chars': rows(
    'lint.custom.append-relpath',
  ),
  'aider-test/test_run_cmd/test_run_cmd_echo': rows('lint.run.local-shell'),
};

function mapUnit(unit) {
  if (UNIT_OVERRIDES[unit.id]) return UNIT_OVERRIDES[unit.id];
  if (TEST_RULES[unit.id]) return TEST_RULES[unit.id];
  if (EVIDENCE_RULES[unit.id]) return EVIDENCE_RULES[unit.id];
  if (unit.id.startsWith('lint/')) {
    const section = unit.id.split('/')[1];
    const rule = SECTION_RULES[section];
    if (!rule) throw new Error(`no SECTION_RULES entry for ${section} (${unit.id})`);
    return rule;
  }
  if (unit.id.startsWith('ev-lint/')) throw new Error(`no EVIDENCE_RULES entry for ${unit.id}`);
  if (unit.id.startsWith('aider-test/')) throw new Error(`no TEST_RULES entry for ${unit.id}`);
  throw new Error(`unexpected lint-slice unit ${unit.id}`);
}

function openRowRecord(spec) {
  const row = {
    id: spec.id,
    feature: 'lint',
    behavior: spec.behavior,
    aider: spec.aider,
    kind: spec.kind ?? 'parity',
    status: 'open',
    pi: [],
    src: [],
    tests: [],
  };
  if (spec.fix) row.fix = spec.fix;
  return row;
}

function main() {
  const units = census().filter((unit) => sliceOf(unit.id) === 'lint');
  const ledger = readJson('parity/ledger.json');
  const coverage = readJson('parity/coverage.json');

  for (const id of EXISTING_OPEN) {
    const prior = ledger.rows.find((row) => row.id === id);
    if (!prior) throw new Error(`missing existing open lint row ${id}`);
    if (prior.status !== 'open') throw new Error(`existing lint row ${id} is ${prior.status}, expected open`);
    if (prior.feature !== 'lint') throw new Error(`existing lint row ${id} has feature ${prior.feature}`);
  }

  const existingById = new Map(ledger.rows.map((row) => [row.id, row]));
  const openRecords = OPEN_ROWS.map(openRowRecord);
  for (const row of openRecords) {
    if (EXISTING_OPEN.has(row.id)) throw new Error(`OPEN_ROWS collides with EXISTING_OPEN id ${row.id}`);
    const prior = existingById.get(row.id);
    if (prior && prior.status === 'verified') throw new Error(`refusing to overwrite verified row ${row.id}`);
  }

  const lintCoverage = {};
  for (const unit of units) {
    lintCoverage[unit.id] = mapUnit(unit);
  }

  const referenced = new Set();
  for (const entry of Object.values(lintCoverage)) {
    for (const id of entry.rows ?? []) referenced.add(id);
  }
  for (const id of EXISTING_OPEN) {
    if (!referenced.has(id)) throw new Error(`existing open row ${id} is not referenced by any lint-slice unit`);
  }
  for (const row of openRecords) {
    if (!referenced.has(row.id)) throw new Error(`open row ${row.id} is not referenced by any lint-slice unit`);
  }
  const knownIds = new Set([...existingById.keys(), ...openRecords.map((row) => row.id)]);
  for (const id of referenced) {
    if (!knownIds.has(id)) throw new Error(`coverage references unknown row ${id}`);
  }

  const nextCoverage = { ...coverage };
  for (const id of Object.keys(nextCoverage)) {
    if (sliceOf(id) === 'lint') delete nextCoverage[id];
  }
  Object.assign(nextCoverage, lintCoverage);

  const openIds = new Set(openRecords.map((row) => row.id));
  const retained = ledger.rows.filter((row) => !openIds.has(row.id));
  const nextLedger = {
    ...ledger,
    rows: [...retained, ...openRecords],
  };

  writeJson('parity/coverage.json', nextCoverage);
  writeJson('parity/ledger.json', nextLedger);

  const covered = units.filter((unit) => Object.hasOwn(nextCoverage, unit.id)).length;
  const lintRows = nextLedger.rows.filter((row) => row.feature === 'lint').length;
  process.stdout.write(
    `map-lint-obligations: slice ${units.length}, covered ${covered}, open rows added ${openRecords.length}, lint rows total ${lintRows}\n`,
  );
}

main();
