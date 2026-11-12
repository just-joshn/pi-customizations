// The receipt's shape in words, shared by the pstack_evidence tool description, validation errors, and the compiled
// worker reference, so none of them can drift from the others. src/evidence.ts holds the schema these describe.
export const RECEIPT_KINDS = ['test', 'command', 'screenshot', 'trace', 'review', 'measurement', 'other'] as const;
export const RECEIPT_VERDICTS = ['pass', 'fail', 'inconclusive'] as const;

/** What each receipt field must be, keyed by field name. Validation errors quote the entry of the field they reject. */
export const RECEIPT_FIELD_HINTS: Readonly<Record<string, string>> = {
  schemaVersion: 'the number 1',
  id: 'letters, digits, ".", "_", "-"; starts with a letter or digit; at most 128 characters',
  runId: "the run's id, the folder name under .pi/pstack/runs",
  target: 'a TODO step id, worker id, or commit; non-empty',
  kind: `one of ${RECEIPT_KINDS.join(', ')}`,
  verdict: `one of ${RECEIPT_VERDICTS.join(', ')}`,
  commit: 'the commit SHA the check examined, or null',
  environment: 'text saying where the check ran',
  command: 'optional; the command as an array of strings',
  exitCode: 'optional; the command exit status, an integer',
  artifacts: 'an array of { path, sha256 }, [] when there is no file; path is relative to the run root or absolute inside it; sha256 is 64 lowercase hex characters of the file',
  defects: 'optional; an array of strings',
  reason: 'optional; text',
  expectedFail: 'optional; true marks an intended failing-before proof: verdict pass then means the command failed as intended, and exitCode must be non-zero',
  createdAt: 'an ISO timestamp string',
};

export const RECEIPT_FIELDS = Object.keys(RECEIPT_FIELD_HINTS);

/** Markdown for the worker reference: every field, the rules `verify` applies, and one complete example. */
export const RECEIPT_REFERENCE = `## Evidence receipt

A receipt is one JSON file for one check you ran. A writable worker saves it under its worker directory's \`evidence/\` and registers it with \`pstack_evidence\` \`record\` (\`{ action: "record", runId, receiptPath }\`). The parent saves its own under the run directory. \`record\` rejects a field not listed here and names the field it rejects.

${RECEIPT_FIELDS.map((field) => `- \`${field}\`: ${RECEIPT_FIELD_HINTS[field]}.`).join('\n')}

\`pstack_evidence\` \`verify\` takes a \`target\` and re-checks every receipt recorded for it. A missing receipt is \`inconclusive\`. A \`pass\` with no artifacts is \`inconclusive\`, because it is an assertion and not evidence. A \`pass\` whose \`exitCode\` is not 0 fails, unless \`expectedFail\` is \`true\`. A \`fail\` receipt makes the target fail. \`verify\` also fails a receipt whose artifact is missing or does not match its \`sha256\`, and, when the target is a commit, one whose \`commit\` differs.

To prove a check fails before the fix, run it and record a receipt with \`expectedFail: true\`, \`verdict: "pass"\`, the non-zero \`exitCode\`, and the failing output as the artifact, under its own target such as \`<step>-before\`. Record the passing run after the fix under the step's target. A receipt without \`expectedFail\` that says \`pass\` with a non-zero \`exitCode\` is rejected as contradicting itself.

\`\`\`json receipt
{
  "schemaVersion": 1,
  "id": "repro-before",
  "runId": "fix-login-redirect",
  "target": "4-before",
  "kind": "test",
  "verdict": "pass",
  "expectedFail": true,
  "commit": "4f2c1a9e0b7d3c5a8e6f1b2d4c9a7e3f5b1d8c6a",
  "environment": "worker worktree, node 22",
  "command": ["npx", "vitest", "run", "redirect.test.ts"],
  "exitCode": 1,
  "artifacts": [{ "path": "workers/fix/evidence/repro-before.txt", "sha256": "<64 hex characters of that file>" }],
  "createdAt": "2026-11-12T10:00:00Z"
}
\`\`\`
`;

/** The short form for the pstack_evidence tool description. */
export const RECEIPT_TOOL_SUMMARY = `A receipt is a JSON object with exactly these fields: ${RECEIPT_FIELDS.map((field) => `${field} (${RECEIPT_FIELD_HINTS[field]})`).join('; ')}.`;
