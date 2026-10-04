import { readFileSync } from 'node:fs';

import { overlayInput } from '../source-overlay-input.mjs';

const upstream = async (path) => (await overlayInput(`skills/poteto-mode/scripts/orch/${path}`, readFileSync(new URL(`../../upstream/skills/poteto-mode/scripts/orch/${path}`, import.meta.url)))).toString('utf8');
const snippet = (name) => readFileSync(new URL(`./orch-snippets/${name}.ts.txt`, import.meta.url), 'utf8');

function span(text, start, end) {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  if (from < 0 || to < 0) throw new Error(`orch overlay cannot find ${start.slice(0, 40)}`);
  return text.slice(from, to);
}

const store = await upstream('store.ts');
const pinFunction = span(store, 'function validateFrontierPin(', 'export function openStore(');

export default [
  {
    path: 'skills/poteto-mode/scripts/orch/store.ts',
    edits: [
      ['import { execFileSync } from "node:child_process";', 'import { execFileSync, spawnSync } from "node:child_process";', 'Import spawnSync to detect a missing gt binary.'],
      [
        '  readonly onStaleLock?: (holder: string) => void;\n}',
        '  readonly onStaleLock?: (holder: string) => void;\n  readonly lockWaitMs?: number;\n}',
        'Let a writer wait a bounded time for a live lock holder instead of failing at once.',
      ],
      [span(store, 'async function acquireLock(', 'async function readTsv('), snippet('acquire-lock'), 'Serialize stale-lock take-over behind a guard file, retry with backoff, and name the --force recovery for a reused pid.'],
      [span(store, 'function resolveFrontier(', 'function validateFrontierPin('), snippet('frontier'), 'Resolve the frontier from gh when gt is not installed, and record the remote PR head instead of a stale local branch.'],
      [pinFunction, snippet('validate-frontier-pin'), 'Name the frontier source in pin mismatch errors.'],
      ['        const prs = resolveFrontier(repo);\n', '        const { prs, source } = resolveFrontier(repo);\n', 'Read the frontier source alongside the rows.'],
      ['            actual: prs.map((row) => row.pr),\n            expected: pin,\n', '            actual: prs.map((row) => row.pr),\n            expected: pin,\n            source,\n', 'Pass the frontier source to the pin check.'],
    ],
  },
  {
    path: 'skills/poteto-mode/scripts/orch/orch.ts',
    edits: [
      [
        '  type Verdict,\n} from "./store.ts";\n',
        '  type Verdict,\n} from "./store.ts";\nimport { createHash } from "node:crypto";\nimport { homedir } from "node:os";\nimport { basename, join } from "node:path";\n',
        'Import path helpers for the default store location.',
      ],
      [
        'function storeDirectory(program: Command): string {\n  const value = program.opts<GlobalOptions>().store;\n  if (value === undefined || value.trim().length === 0) {\n    throw new UsageError("set --store <dir> or ORCH_STORE");\n  }\n  return value;\n}',
        snippet('default-store'),
        'Default the store to the pstack agent store for the workspace when neither --store nor ORCH_STORE is set.',
      ],
      [
        'new Option("--store <dir>", "store directory (or ORCH_STORE)").env(',
        'new Option(\n        "--store <dir>",\n        "store directory (or ORCH_STORE; defaults to the pstack agent store for the workspace)"\n      ).env(',
        'Document the default store in help.',
      ],
      ['.description("manage the Graphite stack frontier")', '.description("manage the PR stack frontier")', 'The frontier no longer requires Graphite.'],
      [
        'leaf(frontier, "set", "discover the Graphite stack and set the frontier")',
        'leaf(\n    frontier,\n    "set",\n    "discover the PR stack (gt when installed, otherwise gh) and set the frontier"\n  )',
        'Describe the forge-neutral frontier source.',
      ],
    ],
  },
];
