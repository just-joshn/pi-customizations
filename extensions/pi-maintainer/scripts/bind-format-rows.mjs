#!/usr/bin/env node
// Fill pi/src/tests and mark verified for format rows whose listed tests already pass.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const path = join(root, 'parity/ledger.json');
const ledger = JSON.parse(readFileSync(path, 'utf8'));

const turnEnd = ["pi.on('turn_end')"];
const queueTurn = ['withFileMutationQueue', "pi.on('turn_end')"];
const udiffSrc = ['src/edit/udiff.ts'];
const patchSrc = ['src/edit/patch.ts', 'src/edit/patch-parse.ts', 'src/edit/patch-apply.ts', 'src/edit/patch-sections.ts'];
const patchParseSrc = ['src/edit/patch.ts', 'src/edit/patch-parse.ts', 'src/edit/patch-sections.ts'];

/** @type {Record<string, { pi: string[]; src: string[]; tests: string[] }>} */
const bindings = {
  'edit.io.read-text': {
    pi: ["pi.on('context_with_system')"],
    src: ['src/edit/working-tree.ts'],
    tests: [
      'test/working-tree-read.oracle.test.ts::reads Aider text *',
      'test/working-tree.test.ts::invalid UTF-8 bytes produce the encoding hint',
      'test/working-tree.test.ts::reads UTF-16LE bytes when that codec is configured',
    ],
  },
  'edit.whole.overwrite': {
    pi: queueTurn,
    src: ['src/edit/wholefile.ts'],
    tests: [
      'test/wholefile.test.ts::overwrites an existing chat file',
      'test/wholefile.test.ts::overwrites a file with an empty block',
      'test/wholefile.test.ts::replays the recorded whole-file CLI replacement content',
    ],
  },
  'edit.whole.unfinished-block': {
    pi: queueTurn,
    src: ['src/edit/wholefile.ts'],
    tests: ['test/wholefile.oracle.test.ts::getEdits get_edits/unclosed*'],
  },
  'edit.udiff.inherit-path': {
    pi: turnEnd,
    src: udiffSrc,
    tests: [
      'test/udiff.test.ts::getEdits inherits the prior path across fences',
      'test/udiff.oracle.test.ts::get edits get_edits/inherit-path',
    ],
  },
  'edit.udiff.normalize-dedupe': {
    pi: turnEnd,
    src: udiffSrc,
    tests: [
      'test/udiff.oracle.test.ts::normalize hunk *',
      'test/udiff.oracle.test.ts::apply edits apply_edits/normalize-dedupe',
    ],
  },
  'edit.udiff.empty-before-appends': {
    pi: turnEnd,
    src: udiffSrc,
    tests: ['test/udiff.oracle.test.ts::do replace do_replace/append*'],
  },
  'edit.udiff.direct-replace': {
    pi: turnEnd,
    src: udiffSrc,
    tests: [
      'test/udiff.oracle.test.ts::directly apply *',
      'test/udiff.test.ts::replays the recorded udiff CLI replacement content',
      'test/udiff.test.ts::udiff format plans an upsert and applies the hunk',
    ],
  },
  'edit.udiff.context-reduction': {
    pi: turnEnd,
    src: udiffSrc,
    tests: ['test/udiff.oracle.test.ts::apply hunk apply_hunk/context-reduction'],
  },
  'edit.udiff.all-occurrences': {
    pi: turnEnd,
    src: udiffSrc,
    tests: [
      'test/udiff.oracle.test.ts::directly apply directly_apply/all-occurrences',
      'test/udiff.test.ts::literal udiff replace changes every occurrence',
    ],
  },
  'edit.udiff.sequential-writes': {
    pi: turnEnd,
    src: udiffSrc,
    tests: [
      'test/udiff.test.ts::applyEdits keeps earlier writes when a later hunk fails',
      'test/udiff.oracle.test.ts::apply edits apply_edits/sequential-success',
      'test/udiff.oracle.test.ts::apply edits apply_edits/partial-success-survives',
    ],
  },
  'edit.udiff.no-match-error': {
    pi: turnEnd,
    src: udiffSrc,
    tests: [
      'test/udiff.test.ts::applyEdits keeps earlier writes when a later hunk fails',
      'test/udiff.oracle.test.ts::apply edits apply_edits/no-match-error',
    ],
  },
  'edit.udiff.empty-result-success': {
    pi: turnEnd,
    src: udiffSrc,
    tests: ['test/udiff.oracle.test.ts::apply edits apply_edits/empty-result-truthiness'],
  },
  'edit.patch.sentinels': {
    pi: turnEnd,
    src: patchParseSrc,
    tests: [
      'test/edit/patch.oracle.test.ts::getEdits get_edits/full-sentinels',
      'test/edit/patch.oracle.test.ts::getEdits get_edits/missing-sentinels',
      'test/edit/patch.oracle.test.ts::getEdits get_edits/not-patch-like',
      'test/edit/patch.oracle.test.ts::applies reply apply_reply/missing-sentinels-applies',
    ],
  },
  'edit.patch.read-files-at-parse': {
    pi: turnEnd,
    src: ['src/edit/patch.ts'],
    tests: [
      'test/edit/patch.oracle.test.ts::getEdits get_edits/missing-update-file',
      'test/edit/patch.oracle.test.ts::getEdits get_edits/missing-delete-file',
      'test/edit/patch.oracle.test.ts::getEdits get_edits/read-error-before-parse-error',
    ],
  },
  'edit.patch.action-headers': {
    pi: turnEnd,
    src: patchParseSrc,
    tests: [
      'test/edit/patch.oracle.test.ts::parsePatchText parse_patch_text/update-single-chunk',
      'test/edit/patch.oracle.test.ts::parsePatchText parse_patch_text/delete',
      'test/edit/patch.oracle.test.ts::parsePatchText parse_patch_text/move-to',
      'test/edit/patch.oracle.test.ts::getEdits get_edits/full-sentinels',
    ],
  },
  'edit.patch.repeated-actions': {
    pi: turnEnd,
    src: patchParseSrc,
    tests: ['test/edit/patch.oracle.test.ts::parsePatchText parse_patch_text/repeated-update*'],
  },
  'edit.patch.parse-errors': {
    pi: turnEnd,
    src: patchParseSrc,
    tests: [
      'test/edit/patch.oracle.test.ts::getEdits get_edits/invalid-line-prefix',
      'test/edit/patch.oracle.test.ts::getEdits get_edits/invalid-add-line',
      'test/edit/patch.oracle.test.ts::parsePatchText parse_patch_text/context-not-found',
    ],
  },
  'edit.patch.add-lines': {
    pi: turnEnd,
    src: patchParseSrc,
    tests: [
      'test/edit/patch.oracle.test.ts::applyEdits apply_edits/add-appends-newline',
      'test/edit/patch.oracle.test.ts::getEdits get_edits/invalid-add-line',
    ],
  },
  'edit.patch.update-lines': {
    pi: turnEnd,
    src: patchParseSrc,
    tests: [
      'test/edit/patch.oracle.test.ts::peekNextSection peek_next_section/context-delete-insert',
      'test/edit/patch.oracle.test.ts::peekNextSection peek_next_section/blank-line-is-context',
    ],
  },
  'edit.patch.scope-markers': {
    pi: turnEnd,
    src: patchParseSrc,
    tests: [
      'test/edit/patch.oracle.test.ts::parsePatchText parse_patch_text/scope-*',
      'test/edit/patch.oracle.test.ts::applies reply apply_reply/scope-marker',
    ],
  },
  'edit.patch.context-fuzz': {
    pi: turnEnd,
    src: ['src/edit/patch-sections.ts'],
    tests: [
      'test/edit/patch.oracle.test.ts::findContextCore *',
      'test/edit/patch.test.ts::exact context matches at fuzz 0',
      'test/edit/patch.test.ts::trimmed context matches at fuzz 100',
      'test/edit/patch.oracle.test.ts::applies reply apply_reply/fuzz-*',
    ],
  },
  'edit.patch.eof-context': {
    pi: turnEnd,
    src: ['src/edit/patch-sections.ts'],
    tests: [
      'test/edit/patch.oracle.test.ts::findContext find_context/eof-*',
      'test/edit/patch.oracle.test.ts::applies reply apply_reply/eof-*',
    ],
  },
  'edit.patch.context-not-found': {
    pi: turnEnd,
    src: patchParseSrc,
    tests: [
      'test/edit/patch.oracle.test.ts::parsePatchText parse_patch_text/context-not-found',
      'test/edit/patch.oracle.test.ts::parsePatchText parse_patch_text/eof-context-not-found',
    ],
  },
  'edit.patch.original-indices': {
    pi: turnEnd,
    src: patchSrc,
    tests: ['test/edit/patch.oracle.test.ts::applyEdits apply_edits/update-equal-index-insertio*'],
  },
  'edit.patch.update-reconstruction': {
    pi: turnEnd,
    src: patchSrc,
    tests: [
      'test/edit/patch.test.ts::replays the recorded patch CLI update content',
      'test/edit/patch.oracle.test.ts::applies reply apply_reply/cli-patch-update',
      'test/edit/patch.oracle.test.ts::applies reply apply_reply/sequential-sections',
    ],
  },
  'edit.patch.verify-deletions': {
    pi: turnEnd,
    src: ['src/edit/patch-apply.ts'],
    tests: ['test/edit/patch.oracle.test.ts::applyEdits apply_edits/update-deletion-mismatch'],
  },
  'edit.patch.update-missing-file': {
    pi: turnEnd,
    src: patchSrc,
    tests: [
      'test/edit/patch.oracle.test.ts::applyEdits apply_edits/update-missing-file',
      'test/edit/patch.oracle.test.ts::applyEdits apply_edits/update-unreadable-directory',
    ],
  },
  'edit.patch.add-existing-fails': {
    pi: turnEnd,
    src: ['src/edit/patch-apply.ts'],
    tests: ['test/edit/patch.oracle.test.ts::applyEdits apply_edits/add-existing-file'],
  },
  'edit.patch.add-writes': {
    pi: turnEnd,
    src: patchSrc,
    tests: [
      'test/edit/patch.oracle.test.ts::applyEdits apply_edits/add-appends-newline',
      'test/edit/patch.oracle.test.ts::applyEdits apply_edits/add-creates-parents',
      'test/edit/patch.test.ts::ADD editIntent leaves creation to application',
    ],
  },
  'edit.patch.delete-unlinks': {
    pi: turnEnd,
    src: ['src/edit/patch-apply.ts'],
    tests: [
      'test/edit/patch.oracle.test.ts::applyEdits apply_edits/delete-removes-file',
      'test/edit/patch.oracle.test.ts::applyEdits apply_edits/delete-missing-warns',
    ],
  },
  'edit.patch.move': {
    pi: turnEnd,
    src: patchSrc,
    tests: [
      'test/edit/patch.oracle.test.ts::applyEdits apply_edits/move-to-new-directory',
      'test/edit/patch.oracle.test.ts::applies reply apply_reply/move-into-new-directory',
    ],
  },
  'edit.patch.action-errors': {
    pi: turnEnd,
    src: ['src/edit/patch-apply.ts'],
    tests: [
      'test/edit/patch.oracle.test.ts::applyEdits apply_edits/move-mismatch-leaves-files',
      'test/edit/patch.oracle.test.ts::applyEdits apply_edits/delete-then-update',
      'test/edit/patch.test.ts::ADD under a regular-file parent raises Python Errno 17',
    ],
  },
};

const byId = new Map(ledger.rows.map((row) => [row.id, row]));
const updated = [];
for (const [id, binding] of Object.entries(bindings)) {
  const row = byId.get(id);
  if (!row) throw new Error(`missing row ${id}`);
  row.pi = binding.pi;
  row.src = binding.src;
  row.tests = binding.tests;
  row.status = 'verified';
  updated.push(id);
}

writeFileSync(path, `${JSON.stringify(ledger, null, 2)}\n`);
process.stdout.write(`verified ${updated.length} rows\n${updated.join('\n')}\n`);
