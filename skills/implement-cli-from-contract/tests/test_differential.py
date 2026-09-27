import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/differential.py'


def run_cases(root, cases, *options):
    corpus = root / 'cases.json'
    corpus.write_text(json.dumps(cases))
    return subprocess.run([sys.executable, str(SCRIPT), 'run', str(corpus),
                           '--reference', '/bin/echo', '--candidate', '/bin/echo',
                           '--out', str(root / 'out'), *options],
                          capture_output=True, text=True, timeout=20)


class DifferentialSafety(unittest.TestCase):
    def test_failed_launches_cannot_be_reported_as_matching(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            missing = str(root / 'missing-command')
            result = run_cases(root, [{'id': 'one', 'args': [], 'probe': ['--isolate']}],
                               '--reference', missing, '--candidate', missing)
            self.assertEqual(result.returncode, 0, result.stderr)
            comparison = subprocess.run([sys.executable, str(SCRIPT), 'compare', '--out', str(root / 'out')],
                                        capture_output=True, text=True)
            self.assertEqual(comparison.returncode, 2, comparison.stdout)
            self.assertIn('launch', comparison.stderr)
            self.assertNotIn('MATCH one', comparison.stdout)

    def test_incomplete_capture_is_rejected_while_older_records_are_supported(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertEqual(run_cases(root, [{'id': 'one', 'args': ['hello']}]).returncode, 0)
            record_path = root / 'out/candidate/probes.jsonl'
            record = json.loads(record_path.read_text())
            command = [sys.executable, str(SCRIPT), 'compare', '--out', str(root / 'out')]
            record_path.write_text(json.dumps({**record, 'capture_complete': False}) + '\n')
            incomplete = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(incomplete.returncode, 2, incomplete.stdout)
            self.assertIn('capture', incomplete.stderr)
            older = {key: value for key, value in record.items()
                     if key not in ('launch_error', 'capture_complete', 'capture_outcomes', 'input_delivery')}
            record_path.write_text(json.dumps(older) + '\n')
            self.assertEqual(subprocess.run(command, capture_output=True).returncode, 0)

    def test_malformed_comparison_records_fail_without_tracebacks(self):
        base = {'id': 'one', 'exit_code': 0, 'signal': None, 'timed_out': False,
                'stdout': {'path': '/missing'}, 'stderr': {'path': '/missing'}, 'fs_diff': {}}
        invalid = (None, [], {}, {'id': []}, {'id': 'one', 'stdout': None},
                   {'id': 'one', 'exit_code': 0, 'signal': None, 'timed_out': False,
                    'stdout': {'path': []}, 'stderr': {'path': '/missing'}, 'fs_diff': {}},
                   {'id': 'one', 'exit_code': 0, 'signal': None, 'timed_out': False,
                    'stdout': {'path': '/missing'}, 'stderr': {'path': '/missing'}, 'fs_diff': {'root': []}},
                   *({**base, field: value} for field, value in (('exit_code', False), ('signal', []),
                      ('timed_out', None), ('sandbox', []), ('fs_diff', None))))
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            records = root / 'reference/probes.jsonl'
            records.parent.mkdir()
            for record in invalid:
                with self.subTest(record=record):
                    records.write_text(json.dumps(record) + '\n')
                    result = subprocess.run([sys.executable, str(SCRIPT), 'compare', '--out', str(root)],
                                            capture_output=True, text=True)
                    self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                    self.assertNotIn('Traceback', result.stderr)

    def test_malformed_triage_is_rejected_even_without_comparisons(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'triage.json'
            for triage in (None, [], {'one': None}, {'one': {}}, {'one': {'class': [], 'reason': 'x'}},
                           {'one': {'class': 'INTENTIONAL_CHANGE', 'reason': None}}):
                with self.subTest(triage=triage):
                    path.write_text(json.dumps(triage))
                    result = subprocess.run([sys.executable, str(SCRIPT), 'compare', '--out', str(root),
                                             '--triage', str(path)], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                    self.assertNotIn('Traceback', result.stderr)

    def test_comparison_reports_mismatches_triage_and_missing_records(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            out = root / 'out'
            cases = [{'id': 'one', 'args': ['hello'], 'probe': ['--isolate', '--timeout=10']}]
            self.assertEqual(run_cases(root, cases, '--candidate', '/bin/echo other').returncode, 0)
            command = [sys.executable, str(SCRIPT), 'compare', '--out', str(out)]
            different = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(different.returncode, 1)
            self.assertIn('UNCLASSIFIED one: stdout', different.stdout)
            self.assertIn('first difference at byte 0', different.stdout)
            triage = root / 'triage.json'
            triage.write_text(json.dumps({'one': {'class': 'EXPECTED_DIFFERENCE', 'reason': 'candidate adds prefix'}}))
            accepted = subprocess.run([*command, '--triage', str(triage)], capture_output=True, text=True)
            self.assertEqual(accepted.returncode, 0, accepted.stderr)
            self.assertIn('INTENTIONAL_CHANGE one', accepted.stdout)
            triage.write_text(json.dumps({'one': {'class': 'UNKNOWN', 'reason': 'unknown'}}))
            self.assertEqual(subprocess.run([*command, '--triage', str(triage)], capture_output=True).returncode, 1)
            (out / 'candidate/probes.jsonl').unlink()
            missing = subprocess.run(command, capture_output=True, text=True)
            self.assertEqual(missing.returncode, 1)
            self.assertIn('MISSING one', missing.stdout)

    def test_selection_empty_commands_and_invalid_json_fail_cleanly(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cases = [{'id': 'one', 'args': []}]
            for options in (('--only', 'absent'), ('--reference', ' ')):
                result = run_cases(root, cases, *options)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn('Traceback', result.stderr)
            self.assertEqual(run_cases(root, cases, '--only', 'one').returncode, 0)
            corpus = root / 'cases.json'
            corpus.write_text('{broken')
            result = subprocess.run([sys.executable, str(SCRIPT), 'run', str(corpus),
                                     '--reference', '/bin/echo', '--candidate', '/bin/echo'], capture_output=True)
            self.assertEqual(result.returncode, 2)

    def test_absolute_and_parent_ids_cannot_delete_existing_directories(self):
        for kind in ('absolute', 'parent'):
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                victim = root / 'victim'
                victim.mkdir()
                (root / 'out/reference/sandboxes').mkdir(parents=True)
                sentinel = victim / 'keep'
                sentinel.write_text('evidence')
                case_id = str(victim) if kind == 'absolute' else '../../../victim'
                result = run_cases(root, [{'id': case_id, 'args': []}])
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertTrue(sentinel.exists(), 'invalid ID deleted unrelated evidence')

    def test_valid_repeated_cases_preserve_legacy_and_new_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            legacy = root / 'out/reference/sandboxes/one'
            legacy.mkdir(parents=True)
            (legacy / 'keep').write_text('evidence')
            cases = [{'id': 'one', 'args': ['hello'], 'probe': ['--isolate', '--clean-env']}]
            for _ in range(2):
                result = run_cases(root, cases)
                self.assertEqual(result.returncode, 0, result.stderr)
            self.assertTrue((legacy / 'keep').exists())
            records = [json.loads(line) for line in (root / 'out/reference/probes.jsonl').read_text().splitlines()]
            self.assertEqual(len(records), 2)
            self.assertNotEqual(records[0]['sandbox'], records[1]['sandbox'])
            self.assertEqual(Path(records[0]['stdout']['path']).read_bytes(), b'hello\n')

    def test_invalid_corpus_is_rejected_before_any_launch(self):
        invalid = (None, {}, [], [None], [{'id': 'one', 'args': None}],
                   [{'id': 'one', 'args': [1]}], [{'id': 'one', 'args': ['\0']}],
                   [{'id': 'one', 'args': [], 'label': None}],
                   [{'id': 'one', 'args': [], 'probe': None}],
                   [{'id': 'one', 'args': []}, {'id': 'one', 'args': []}],
                   [{'id': 'one', 'args': []}, {'id': '../bad', 'args': []}])
        for cases in invalid:
            with self.subTest(cases=cases), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                result = run_cases(root, cases)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertNotIn('Traceback', result.stderr)
                self.assertFalse((root / 'out').exists())

    def test_probe_cannot_override_record_identity_or_output(self):
        for probe in (['--id', 'other'], ['--out=elsewhere'], ['--ou', 'elsewhere'],
                      ['--', '/bin/true'], ['--timeout'], ['--unknown'], [None]):
            with self.subTest(probe=probe), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                result = run_cases(root, [{'id': 'one', 'args': [], 'probe': probe}])
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertFalse((root / 'out').exists())

    def test_output_symlinks_cannot_redirect_artifacts(self):
        for path in ('reference', 'reference/raw', 'reference/sandboxes', 'reference/probes.jsonl'):
            with self.subTest(path=path), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                victim = root / 'victim'
                victim.mkdir()
                link = root / 'out' / path
                link.parent.mkdir(parents=True)
                link.symlink_to(victim)
                result = run_cases(root, [{'id': 'one', 'args': [], 'probe': ['--isolate']}])
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertEqual(list(victim.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
