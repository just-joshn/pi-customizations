#!/usr/bin/env node
// Build the map SAR obligation map: open ledger rows for uncovered behavioral
// clusters, and coverage.json entries for every map-slice census unit.
// Rerun: node scripts/map-map-obligations.mjs
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

/** Existing open map rows already in the ledger; leave their records untouched. */
const EXISTING_OPEN = new Set([
  'map.architect.disable-editor-map',
  'map.context.expand-refresh-map',
  'map.context.seed-and-fallback',
  'map.tags.coordinates',
  'map.tags.extract',
  'map.tags.lexical-fallback',
  'map.tags.python-query',
  'map.rank.lexical-graph',
  'map.rank.weights',
  'map.render.structural-context',
  'map.budget.model-default',
  'map.budget.explicit-enable',
  'map.budget.sampled-prefix',
  'map.budget.no-files',
  'map.cache.tags-mtime',
  'map.cache.rendered-policy',
  'map.tags.no-duplicate-final-capture',
  'map.model.mapping-policy',
]);

/**
 * Additional open behavioral clusters. Do not dump behavior into nonclaims.
 * @type {Array<{id: string, behavior: string, aider: string[], kind?: string, fix?: object}>}
 */
const OPEN_ROWS = [
  {
    id: 'map.files.tracked-universe',
    behavior: 'The map file universe is the sorted, deduplicated Git HEAD-and-index inventory after aiderignore and subtree filtering; untracked paths are excluded and summaries use working-tree text.',
    aider: ['aider/repo.py:433-570', 'aider/coders/base_coder.py:2153-2167'],
  },
  {
    id: 'map.files.partition-chat-other',
    behavior: 'Normal mapping partitions repository files into chat files (editable plus in-root read-only) and other files, and excludes chat filenames from rendered map text while still using them for ranking.',
    aider: ['aider/coders/base_coder.py:719-722', 'aider/repomap.py:550-557,748-785'],
  },
  {
    id: 'map.files.important-basenames',
    behavior: 'Important-basename helpers recognize configured root filenames case-insensitively across path forms, and ranking attempts to prepend important filenames absent from the ranked list.',
    aider: ['aider/special.py:1-80', 'aider/repomap.py:559-574,656-662'],
  },
  {
    id: 'map.hints.mention-extraction',
    behavior:
      'Mention hints come from concatenating current messages, splitting identifiers on non-word boundaries, and matching normalized paths, unique punctuated basenames, and lowercased stems of at least five characters, without scanning completed history.',
    aider: ['aider/coders/base_coder.py:672-707,1714-1759'],
  },
  {
    id: 'map.rank.personalization',
    behavior: 'PageRank personalization starts from chat membership and filename-path matches scaled by 100 over the scan universe, stores only positive values, and retries without personalization when the normalized sum is zero.',
    aider: ['aider/repomap.py:383,422-445,519-531'],
  },
  {
    id: 'map.rank.definition-scores',
    behavior: 'Definition scores sum identifier-specific edge ranks from referencing files, then ranked entries append non-chat definition tags and filename-only leftovers before budget search.',
    aider: ['aider/repomap.py:533-574'],
  },
  {
    id: 'map.render.prompt-insertion',
    behavior: 'The coder inserts the prefixed repository map as a user message followed by an assistant acknowledgment that mapped files will not be edited without approval, with optional cache marking after the map chunk.',
    aider: ['aider/coders/base_prompts.py:45-49', 'aider/coders/base_coder.py:750-761', 'aider/coders/chat_chunks.py:16-41'],
  },
  {
    id: 'map.commands.map-print',
    behavior: '/map builds the repository map through the coder wrapper and prints the resulting map text.',
    aider: ['aider/commands.py:472-478'],
  },
  {
    id: 'map.commands.map-refresh',
    behavior: '/map-refresh forces the first wrapper mapping attempt and reports success without printing the map.',
    aider: ['aider/commands.py:1418-1430'],
  },
  {
    id: 'map.commands.tokens-report',
    behavior: '/tokens calls RepoMap directly with editable files as chat, omitting repository read-only partitioning, mention hints, and global fallbacks, so its token report can differ from the request map.',
    aider: ['aider/commands.py:472-478', 'aider/coders/base_coder.py:789-800'],
  },
  {
    id: 'map.commands.show-repo-map',
    behavior: '--show-repo-map builds the map through the coder wrapper, prints it, and exits.',
    aider: ['aider/main.py:1046-1053'],
  },
  {
    id: 'map.config.map-mul',
    behavior: 'The map no-files multiplier option configures how far an empty-chat map budget may expand subject to known context capacity minus 4096 tokens.',
    aider: ['aider/args.py:400-450', 'aider/repomap.py:47-58,119-132'],
  },
  {
    id: 'map.query.asset-selection',
    behavior: 'Query selection prefers tree-sitter-language-pack tags assets, then falls back to tree-sitter-languages assets; missing assets yield no semantic tags for that language.',
    aider: ['aider/repomap.py:805-829'],
  },
  {
    id: 'map.query.julia-compat',
    behavior: 'Julia repository mapping degrades without an uncaught query error when the selected Julia tags query is incompatible with the installed grammar.',
    aider: ['aider/repomap.py:284-302', 'aider/queries/tree-sitter-language-pack/julia-tags.scm:1-40'],
    kind: 'fix',
    fix: {
      defect: 'Query construction and execution sit outside the parser-acquisition catch, so an incompatible Julia tags query raises QueryError during get_repo_map instead of degrading to no tags or filename-only output.',
      intent:
        'Parser-acquisition failures already skip a file with a printed message at aider/repomap.py:284-295; unknown languages and missing query assets yield no tags at :279-337. Julia should follow that degradation path rather than aborting the map.',
      behavior: 'Julia repository mapping degrades without an uncaught query error when the selected Julia tags query is incompatible with the installed grammar.',
    },
  },
  {
    id: 'map.fail.zero-budget-none',
    behavior: 'A nonpositive map token budget returns no map text from RepoMap.',
    aider: ['aider/repomap.py:111-146'],
  },
  {
    id: 'map.fail.recursion-disables',
    behavior: 'A RecursionError during map generation is reported and the map budget is set to zero so later maps stay disabled.',
    aider: ['aider/repomap.py:111-146', 'aider/coders/base_coder.py:713-746'],
  },
  {
    id: 'map.fail.cache-memory-fallback',
    behavior: 'When persistent tag-cache creation fails, mapping recreates the cache or falls back to an in-memory dictionary and continues producing maps.',
    aider: ['aider/repomap.py:177-230'],
  },
  {
    id: 'map.deps.query-runtime',
    behavior: 'Semantic repository mapping requires query assets and language parsers available to the running process; an install with zero query assets cannot emit definition or reference tags.',
    aider: ['aider/repomap.py:279-337,805-829', 'aider/models.py:155'],
  },
  {
    id: 'map.security.source-disclosure',
    behavior: 'Rendered map text can include filenames plus source excerpts with literals, comments, and configuration values, without secret redaction, because the read-only prefix is a model instruction only.',
    aider: ['aider/repomap.py:297-337,710-785', 'aider/coders/base_coder.py:750-761'],
  },
];

function rows(...ids) {
  return { rows: ids };
}

function nonclaim(category, note) {
  return { nonclaim: category, note };
}

const CORE_PIPELINE = rows('map.files.tracked-universe', 'map.files.partition-chat-other', 'map.tags.extract', 'map.rank.lexical-graph', 'map.budget.sampled-prefix', 'map.render.structural-context');

const SECTION_RULES = {
  overview: CORE_PIPELINE,
  'evidence-classes': nonclaim('meta', 'evidence class taxonomy for reading the reconstruction'),
  'checkout-implementation-versus-installed-distribution': nonclaim('provenance', 'checkout versus installed distribution identity and import origin'),
  'reconstruction-boundary': nonclaim('meta', 'stated reconstruction scope and non-claims'),
  'file-sets': rows('map.files.tracked-universe', 'map.files.partition-chat-other', 'map.hints.mention-extraction'),
  'tags-and-symbol-name-matching': rows('map.tags.coordinates', 'map.tags.extract', 'map.tags.lexical-fallback', 'map.tags.python-query'),
  'file-rank-versus-definition-rank': rows('map.rank.lexical-graph', 'map.rank.definition-scores'),
  'selected-entries-versus-rendered-text': rows('map.budget.sampled-prefix', 'map.render.structural-context'),
  'refresh-versus-invalidation': rows('map.cache.rendered-policy', 'map.cache.tags-mtime'),
  'component-diagram': CORE_PIPELINE,
  'normal-request-sequence': rows('map.context.seed-and-fallback', 'map.hints.mention-extraction', 'map.render.prompt-insertion'),
  '1-configuration-and-map-construction': rows('map.budget.model-default', 'map.budget.explicit-enable', 'map.model.mapping-policy'),
  '2-git-derived-file-selection': rows('map.files.tracked-universe'),
  '3-partitioning-and-mention-hints': rows('map.files.partition-chat-other', 'map.hints.mention-extraction', 'map.context.seed-and-fallback'),
  '4-tag-extraction': rows('map.tags.extract', 'map.tags.coordinates', 'map.tags.lexical-fallback', 'map.cache.tags-mtime'),
  '5-capture-multiplicity': rows('map.tags.no-duplicate-final-capture', 'map.tags.extract'),
  '6-graph-construction': rows('map.rank.lexical-graph', 'map.rank.weights', 'map.rank.personalization'),
  '7-ranking-and-prefix-selection': rows('map.rank.lexical-graph', 'map.rank.definition-scores', 'map.files.important-basenames', 'map.budget.sampled-prefix'),
  '8-rendering-and-prompt-insertion': rows('map.render.structural-context', 'map.render.prompt-insertion', 'map.files.partition-chat-other'),
  'data-structures': rows('map.tags.coordinates', 'map.rank.lexical-graph', 'map.cache.tags-mtime', 'map.cache.rendered-policy'),
  personalization: rows('map.rank.personalization', 'map.rank.lexical-graph'),
  'edge-weighting': rows('map.rank.weights', 'map.rank.lexical-graph'),
  pagerank: rows('map.rank.lexical-graph', 'map.rank.personalization'),
  'definition-scores': rows('map.rank.definition-scores', 'map.rank.lexical-graph'),
  'token-budget-and-measurement': rows('map.budget.sampled-prefix', 'map.budget.no-files', 'map.budget.model-default'),
  'configuration-and-default-matrix': rows('map.budget.model-default', 'map.budget.explicit-enable', 'map.budget.no-files', 'map.config.map-mul', 'map.model.mapping-policy', 'map.cache.rendered-policy'),
  'cache-invalidation-matrix': rows('map.cache.rendered-policy', 'map.cache.tags-mtime'),
  'observed-environment': nonclaim('evidence', 'recorded dependency versions in the verification environment'),
  'direct-dependency-mechanisms': rows('map.tags.extract', 'map.query.asset-selection', 'map.rank.lexical-graph', 'map.deps.query-runtime'),
  'broader-dependency-closure': nonclaim('evidence', 'declared dependency closure metadata beyond mapping runtime'),
  'language-support-distinctions': rows('map.tags.extract', 'map.query.asset-selection', 'map.tags.python-query', 'map.tags.lexical-fallback', 'map.query.julia-compat'),
  'commands-and-lifecycle-boundaries': rows(
    'map.commands.map-print',
    'map.commands.map-refresh',
    'map.commands.tokens-report',
    'map.commands.show-repo-map',
    'map.architect.disable-editor-map',
    'map.context.seed-and-fallback',
    'map.context.expand-refresh-map',
  ),
  'failure-matrix': rows('map.fail.zero-budget-none', 'map.fail.recursion-disables', 'map.fail.cache-memory-fallback', 'map.query.julia-compat', 'map.tags.extract', 'map.rank.personalization'),
  'source-disclosure': rows('map.security.source-disclosure', 'map.render.structural-context'),
  'local-execution-and-persistence': rows('map.cache.tags-mtime', 'map.deps.query-runtime'),
  'concurrency-and-consistency': rows('map.cache.rendered-policy', 'map.cache.tags-mtime'),
  'feature-probes': rows('map.tags.extract', 'map.tags.python-query', 'map.files.partition-chat-other', 'map.budget.no-files', 'map.cache.rendered-policy'),
  'boundary-probes': rows('map.cache.rendered-policy', 'map.hints.mention-extraction', 'map.budget.no-files', 'map.fail.recursion-disables', 'map.fail.cache-memory-fallback'),
  'query-compatibility-and-julia': rows('map.query.julia-compat', 'map.query.asset-selection'),
  'existing-tests': nonclaim('evidence', 'recorded existing Aider unittest execution totals'),
  'remaining-coverage-gaps': nonclaim('meta', 'stated investigation gaps without a new observable contract'),
  'reproduction-and-artifact-verification': nonclaim('evidence', 'reproduction commands and artifact verification pointers'),
  'where-things-live': nonclaim('provenance', 'source path registry for map components at the pinned commit'),
  gotchas: rows('map.tags.no-duplicate-final-capture', 'map.rank.weights', 'map.commands.tokens-report', 'map.query.julia-compat', 'map.files.important-basenames', 'map.security.source-disclosure'),
  'reconstruction-contract-and-uncertainties': nonclaim('meta', 'reconstruction contract statements and open uncertainties'),
};

const UNIT_OVERRIDES = {
  'map/overview/p6': nonclaim('provenance', 'pinned checkout commit identity'),
  'map/overview/c7': nonclaim('provenance', 'pinned checkout commit hash'),
  'map/overview/p8': nonclaim('evidence', 'runtime success scope for checkout probes'),
  'map/overview/i9': rows('map.query.julia-compat'),
  'map/overview/i10': rows('map.deps.query-runtime'),
  'map/overview/p11': nonclaim('meta', 'tests do not establish the incomplete installed distribution'),
  'map/checkout-implementation-versus-installed-distribution/p7': rows('map.deps.query-runtime'),
  'map/checkout-implementation-versus-installed-distribution/p8': nonclaim('meta', 'packaging root-cause not established beyond incomplete install observation'),
  'map/reconstruction-boundary/p2': nonclaim('evidence', 'pointer to archived source manifest'),
  'map/reconstruction-boundary/p3': nonclaim('meta', 'lead-in to reconstruction non-claim list'),
  'map/reconstruction-boundary/i4': nonclaim('meta', 'excludes native grammar decompilation'),
  'map/reconstruction-boundary/i5': nonclaim('meta', 'excludes complete semantic language support claims'),
  'map/reconstruction-boundary/i6': rows('map.deps.query-runtime'),
  'map/reconstruction-boundary/i7': nonclaim('meta', 'excludes model-answer quality evaluation'),
  'map/reconstruction-boundary/i8': nonclaim('meta', 'excludes repository-scale performance benchmarks'),
  'map/reconstruction-boundary/i9': nonclaim('meta', 'excludes transitive dependency verification'),
  'map/reconstruction-boundary/i10': nonclaim('meta', 'excludes product fixes in the reconstruction'),
  'map/reconstruction-boundary/p11': nonclaim('meta', 'no product changes in the reconstruction'),
  'map/language-support-distinctions/p1': nonclaim('meta', 'language-support stage taxonomy lead-in'),
  'map/language-support-distinctions/r8': nonclaim('meta', 'model-quality evaluation is outside map runtime contracts'),
  'map/language-support-distinctions/p9': nonclaim('evidence', 'pointer to installed language inventory artifact'),
  'map/language-support-distinctions/p10': nonclaim('meta', 'lead-in to inventory count table'),
  'map/language-support-distinctions/r11': nonclaim('evidence', 'installed language inventory counts from evidence artifacts'),
  'map/language-support-distinctions/r12': nonclaim('evidence', 'installed language inventory counts from evidence artifacts'),
  'map/language-support-distinctions/r13': nonclaim('evidence', 'installed language inventory counts from evidence artifacts'),
  'map/language-support-distinctions/r14': nonclaim('evidence', 'installed language inventory counts from evidence artifacts'),
  'map/language-support-distinctions/r15': nonclaim('evidence', 'installed language inventory counts from evidence artifacts'),
  'map/language-support-distinctions/p16': nonclaim('evidence', 'pointer to query-result and probe-source artifacts'),
  'map/language-support-distinctions/i19': rows('map.tags.python-query', 'map.query.asset-selection'),
  'map/language-support-distinctions/i20': rows('map.tags.lexical-fallback', 'map.query.asset-selection'),
  'map/language-support-distinctions/i21': rows('map.query.asset-selection', 'map.tags.extract'),
  'map/language-support-distinctions/p23': nonclaim('evidence', 'query probe proves compile compatibility on minimal input only'),
  'map/language-support-distinctions/p24': rows('map.query.julia-compat'),
  'map/language-support-distinctions/c25': rows('map.query.julia-compat'),
  'map/language-support-distinctions/p26': rows('map.query.julia-compat'),
  'map/language-support-distinctions/c27': rows('map.query.julia-compat'),
  'map/language-support-distinctions/p28': rows('map.query.julia-compat'),
  'map/language-support-distinctions/p29': nonclaim('meta', 'generated language docs mark support by query-file existence'),
  'map/language-support-distinctions/p30': nonclaim('out-of-scope', 'asset-download script reproducibility is outside map runtime contracts'),
  'map/existing-tests/c2': nonclaim('evidence', 'recorded repomap unittest command'),
  'map/existing-tests/c4': nonclaim('evidence', 'recorded special unittest command'),
  'map/feature-probes/c3': nonclaim('evidence', 'probe command listing'),
  'map/boundary-probes/c2': nonclaim('evidence', 'boundary probe command listing'),
  'map/reproduction-and-artifact-verification/c2': nonclaim('evidence', 'reproduction command block'),
  'map/reproduction-and-artifact-verification/c5': nonclaim('evidence', 'artifact verification command block'),
  'map/reproduction-and-artifact-verification/c7': nonclaim('evidence', 'hash verification command block'),
};

const EVIDENCE_RULES = {
  'ev-map/probe/provider-tags': rows('map.tags.extract', 'map.tags.python-query', 'map.tags.no-duplicate-final-capture'),
  'ev-map/probe/map-with-chat-file': rows('map.files.partition-chat-other', 'map.render.structural-context', 'map.rank.lexical-graph'),
  'ev-map/probe/global-map': rows('map.context.seed-and-fallback', 'map.budget.no-files'),
  'ev-map/probe/refresh-files-stale-until-forced': rows('map.cache.rendered-policy'),
  'ev-map/probe/forced-map': rows('map.cache.rendered-policy', 'map.commands.map-refresh'),
  'ev-map/probe/zero-budget-disables-map': rows('map.fail.zero-budget-none', 'map.budget.explicit-enable'),
  'ev-map/boundary/manual-reuses-map-even-when-file-list-changes': rows('map.cache.rendered-policy'),
  'ev-map/boundary/auto-cache-key-includes-identifier-hints': rows('map.cache.rendered-policy', 'map.hints.mention-extraction'),
  'ev-map/boundary/empty-chat-budget-with-6000-context': rows('map.budget.no-files', 'map.config.map-mul'),
  'ev-map/boundary/recursion-error-disables-subsequent-maps': rows('map.fail.recursion-disables'),
  'ev-map/boundary/sqlite-creation-failure-falls-back-to-memory-and-maps': rows('map.fail.cache-memory-fallback'),
  'ev-map/julia/get-repo-map': rows('map.query.julia-compat'),
  'ev-map/query/python': rows('map.tags.python-query', 'map.query.asset-selection', 'map.tags.extract'),
  'ev-map/query/julia': rows('map.query.julia-compat', 'map.query.asset-selection'),
};

for (const lang of [
  'arduino',
  'bash',
  'c',
  'chatito',
  'clojure',
  'commonlisp',
  'cpp',
  'csharp',
  'd',
  'dart',
  'elisp',
  'elixir',
  'elm',
  'fortran',
  'gleam',
  'go',
  'haskell',
  'hcl',
  'java',
  'javascript',
  'kotlin',
  'lua',
  'matlab',
  'ocaml',
  'ocaml-interface',
  'php',
  'pony',
  'properties',
  'r',
  'racket',
  'ruby',
  'rust',
  'scala',
  'solidity',
  'swift',
  'typescript',
  'udev',
  'zig',
]) {
  EVIDENCE_RULES[`ev-map/query/${lang}`] = rows('map.query.asset-selection', 'map.tags.extract');
}

const TEST_RULES = {
  'aider-test/test_commands/TestCommands.test_cmd_tokens_output': rows('map.commands.tokens-report'),
  'aider-test/test_main/TestMain.test_yaml_config_file_loading': rows('map.budget.model-default', 'map.config.map-mul'),
  'aider-test/test_main/TestMain.test_map_tokens_option': rows('map.budget.explicit-enable', 'map.fail.zero-budget-none'),
  'aider-test/test_main/TestMain.test_map_tokens_option_with_non_zero_value': rows('map.budget.explicit-enable', 'map.budget.model-default'),
  'aider-test/test_main/TestMain.test_sonnet_and_cache_options': rows('map.model.mapping-policy'),
  'aider-test/test_main/TestMain.test_map_mul_option': rows('map.config.map-mul', 'map.budget.no-files'),
  'aider-test/test_models/TestModels.test_get_repo_map_tokens': rows('map.budget.model-default'),
  'aider-test/test_models/TestModels.test_configure_model_settings': rows('map.model.mapping-policy'),
  'aider-test/test_models/TestModels.test_gpt_5_5_model_settings': rows('map.model.mapping-policy'),
  'aider-test/test_repomap/TestRepoMap.test_get_repo_map': rows('map.tags.extract', 'map.render.structural-context', 'map.rank.lexical-graph'),
  'aider-test/test_repomap/TestRepoMap.test_repo_map_refresh_files': rows('map.cache.rendered-policy'),
  'aider-test/test_repomap/TestRepoMap.test_repo_map_refresh_auto': rows('map.cache.rendered-policy'),
  'aider-test/test_repomap/TestRepoMap.test_get_repo_map_with_identifiers': rows('map.hints.mention-extraction', 'map.rank.personalization', 'map.rank.weights'),
  'aider-test/test_repomap/MyClass.test_get_repo_map_all_files': rows('map.budget.no-files', 'map.context.seed-and-fallback'),
  'aider-test/test_repomap/MyClass.test_get_repo_map_excludes_added_files': rows('map.files.partition-chat-other', 'map.render.structural-context'),
  'aider-test/test_repomap/TestRepoMapAllLanguages.test_repo_map_sample_code_base': rows('map.tags.extract', 'map.render.structural-context', 'map.rank.lexical-graph'),
  'aider-test/test_special/test_is_important': rows('map.files.important-basenames'),
  'aider-test/test_special/test_filter_important_files': rows('map.files.important-basenames'),
  'aider-test/test_special/test_is_important_case_sensitivity': rows('map.files.important-basenames'),
  'aider-test/test_special/test_is_important_with_paths': rows('map.files.important-basenames'),
  'aider-test/test_special/test_is_important_various_files': rows('map.files.important-basenames'),
};

for (const lang of [
  'c',
  'cpp',
  'd',
  'dart',
  'elixir',
  'gleam',
  'haskell',
  'java',
  'javascript',
  'kotlin',
  'lua',
  'php',
  'python',
  'ruby',
  'rust',
  'typescript',
  'tsx',
  'zig',
  'csharp',
  'elisp',
  'elm',
  'go',
  'hcl',
  'arduino',
  'chatito',
  'clojure',
  'commonlisp',
  'pony',
  'properties',
  'r',
  'racket',
  'solidity',
  'swift',
  'udev',
  'scala',
  'ocaml',
  'ocaml_interface',
  'matlab',
  'bash',
]) {
  const rowIds = lang === 'python' ? ['map.tags.python-query', 'map.query.asset-selection', 'map.tags.extract'] : ['map.query.asset-selection', 'map.tags.extract'];
  TEST_RULES[`aider-test/test_repomap/TestRepoMapAllLanguages.test_language_${lang}`] = rows(...rowIds);
}

function mapUnit(unit) {
  if (UNIT_OVERRIDES[unit.id]) return UNIT_OVERRIDES[unit.id];
  if (TEST_RULES[unit.id]) return TEST_RULES[unit.id];
  if (EVIDENCE_RULES[unit.id]) return EVIDENCE_RULES[unit.id];
  if (unit.id.startsWith('map/')) {
    const section = unit.id.split('/')[1];
    const rule = SECTION_RULES[section];
    if (!rule) throw new Error(`no SECTION_RULES entry for ${section} (${unit.id})`);
    return rule;
  }
  if (unit.id.startsWith('ev-map/')) throw new Error(`no EVIDENCE_RULES entry for ${unit.id}`);
  if (unit.id.startsWith('aider-test/')) throw new Error(`no TEST_RULES entry for ${unit.id}`);
  throw new Error(`unexpected map-slice unit ${unit.id}`);
}

function openRowRecord(spec) {
  const row = {
    id: spec.id,
    feature: 'map',
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

/** Every pre-existing open row must still be open and owned by this slice. */
function assertExistingOpen(ledger) {
  for (const id of EXISTING_OPEN) {
    const prior = ledger.rows.find((row) => row.id === id);
    if (!prior) throw new Error(`missing existing open map row ${id}`);
    if (prior.status !== 'open') throw new Error(`existing map row ${id} is ${prior.status}, expected open`);
    if (prior.feature !== 'map') throw new Error(`existing map row ${id} has feature ${prior.feature}`);
  }
}

function main() {
  const units = census().filter((unit) => sliceOf(unit.id) === 'map');
  const ledger = readJson('parity/ledger.json');
  const coverage = readJson('parity/coverage.json');

  assertExistingOpen(ledger);

  const existingById = new Map(ledger.rows.map((row) => [row.id, row]));
  const openRecords = OPEN_ROWS.map(openRowRecord);
  for (const row of openRecords) {
    if (EXISTING_OPEN.has(row.id)) throw new Error(`OPEN_ROWS collides with EXISTING_OPEN id ${row.id}`);
    const prior = existingById.get(row.id);
    if (prior && prior.status === 'verified') throw new Error(`refusing to overwrite verified row ${row.id}`);
  }

  const mapCoverage = {};
  for (const unit of units) {
    mapCoverage[unit.id] = mapUnit(unit);
  }

  const referenced = new Set();
  for (const entry of Object.values(mapCoverage)) {
    for (const id of entry.rows ?? []) referenced.add(id);
  }
  for (const id of EXISTING_OPEN) {
    if (!referenced.has(id)) throw new Error(`existing open row ${id} is not referenced by any map-slice unit`);
  }
  for (const row of openRecords) {
    if (!referenced.has(row.id)) throw new Error(`open row ${row.id} is not referenced by any map-slice unit`);
  }
  const knownIds = new Set([...existingById.keys(), ...openRecords.map((row) => row.id)]);
  for (const id of referenced) {
    if (!knownIds.has(id)) throw new Error(`coverage references unknown row ${id}`);
  }

  const nextCoverage = { ...coverage };
  for (const id of Object.keys(nextCoverage)) {
    if (sliceOf(id) === 'map') delete nextCoverage[id];
  }
  Object.assign(nextCoverage, mapCoverage);

  const openIds = new Set(openRecords.map((row) => row.id));
  const retained = ledger.rows.filter((row) => !openIds.has(row.id));
  const nextLedger = {
    ...ledger,
    rows: [...retained, ...openRecords],
  };

  writeJson('parity/coverage.json', nextCoverage);
  writeJson('parity/ledger.json', nextLedger);

  const covered = units.filter((unit) => Object.hasOwn(nextCoverage, unit.id)).length;
  const mapRows = nextLedger.rows.filter((row) => row.feature === 'map').length;
  process.stdout.write(`map-map-obligations: slice ${units.length}, covered ${covered}, open rows added ${openRecords.length}, map rows total ${mapRows}\n`);
}

main();
