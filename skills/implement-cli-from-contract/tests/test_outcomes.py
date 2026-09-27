import argparse
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import shlex
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

from test_differential import SCRIPT, run_cases

SPEC = importlib.util.spec_from_file_location('outcome_differential', SCRIPT)
differential = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(differential)


class OutcomeComparison(unittest.TestCase):
    def test_new_outcome_failures_cannot_match(self):
        invalid = (None, [], {}, {'status': [], 'bytes': 0, 'error': None},
                   {'status': 'complete', 'bytes': False, 'error': None},
                   {'status': 'complete', 'bytes': 0, 'error': {}},
                   {'status': 'not_applicable', 'bytes': 1, 'error': None},
                   {'status': 'error', 'bytes': 0, 'error': None},
                   {'status': 'cancelled', 'bytes': 0, 'error': None},
                   {'status': 'error', 'bytes': 0,
                    'error': {'type': 'OSError', 'errno': 22, 'message': 'injected'}})
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertEqual(run_cases(root, [{'id': 'one', 'args': ['hello']}]).returncode, 0)
            path = root / 'out/candidate/probes.jsonl'
            base = json.loads(path.read_text())
            for outcome in invalid:
                with self.subTest(outcome=outcome):
                    path.write_text(json.dumps({**base, 'input_delivery': outcome}) + '\n')
                    result = subprocess.run([sys.executable, str(SCRIPT), 'compare', '--out', str(root / 'out')],
                                            capture_output=True, text=True, timeout=10)
                    self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                    self.assertNotIn('Traceback', result.stderr)

    def test_malformed_output_outcomes_are_rejected(self):
        base = {'id': 'one', 'exit_code': 0, 'signal': None, 'timed_out': False,
                'stdout': {'path': '/missing'}, 'stderr': {'path': '/missing'}, 'fs_diff': {}}
        done = {'status': 'complete', 'bytes': 0, 'error': None}
        for outcomes in (None, [], {}, {'stdout': done},
                         {'stdout': {**done, 'status': 'closed'}, 'stderr': done, 'tty_echo': done}):
            with self.subTest(outcomes=outcomes), self.assertRaises(ValueError):
                differential.validate_record({**base, 'capture_outcomes': outcomes})

    def test_observation_values_reject_invalid_signals_and_paths(self):
        base = {'id': 'one', 'exit_code': 0, 'signal': None, 'timed_out': False,
                'stdout': {'path': '/missing'}, 'stderr': {'path': '/missing'}, 'fs_diff': {}}
        for change in ({'signal': 'SIG_IGN'}, {'signal': 'SIGIOT'}, {'exit_code': -1}, {'id': 'bad\0id'},
                       {'sandbox': 'bad\0path'}, {'stdout': {'path': 'bad\0path'}}):
            with self.subTest(change=change), self.assertRaises(ValueError):
                differential.validate_record({**base, **change})

    def test_selection_does_not_search_the_list_for_each_case(self):
        class Selection(list):
            def __contains__(self, value):
                raise AssertionError('quadratic selection scan')
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            corpus = root / 'cases.json'
            corpus.write_text(json.dumps([{'id': name, 'args': []} for name in ('skip', 'one', 'two')]))
            with patch.object(differential.subprocess, 'run') as run:
                run.return_value = subprocess.CompletedProcess([], 0, 'ok', '')
                args = argparse.Namespace(cases=str(corpus), only=Selection(['two', 'one']), out=str(root / 'out'),
                                          reference='/bin/echo', candidate='/bin/echo', probe=SCRIPT)
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(differential.run(args), 0)
                launched = [call.args[0][call.args[0].index('--id') + 1] for call in run.call_args_list]
                self.assertEqual(launched, ['one', 'one', 'two', 'two'])

    def test_selection_launches_only_requested_cases_in_corpus_order(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cases = [{'id': name, 'args': [name]} for name in ('skip', 'one', 'two')]
            result = run_cases(root, cases, '--only', 'two', 'one')
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            for side in ('reference', 'candidate'):
                records = [json.loads(line) for line in (root / 'out' / side / 'probes.jsonl').read_text().splitlines()]
                self.assertEqual([record['id'] for record in records], ['one', 'two'])
                self.assertEqual([Path(record['stdout']['path']).read_bytes() for record in records], [b'one\n', b'two\n'])

    def test_empty_comparison_and_missing_raw_stream_fail_cleanly(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            command = [sys.executable, str(SCRIPT), 'compare', '--out', str(root / 'out')]
            empty = subprocess.run(command, capture_output=True, text=True, timeout=10)
            self.assertEqual(empty.returncode, 1)
            self.assertIn('CASES 0', empty.stdout)
            self.assertEqual(run_cases(root, [{'id': 'one', 'args': []}]).returncode, 0)
            record = json.loads((root / 'out/candidate/probes.jsonl').read_text())
            Path(record['stdout']['path']).unlink()
            missing = subprocess.run(command, capture_output=True, text=True, timeout=10)
            self.assertEqual(missing.returncode, 2)
            self.assertNotIn('Traceback', missing.stderr)

    def test_optional_normalization_and_filesystem_diagnostics(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            stream = root / 'stream'
            stream.write_bytes(b'/sandbox/file\0other')
            base = {'exit_code': 0, 'signal': None, 'timed_out': False, 'sandbox': '/sandbox',
                    'stdout': {'path': str(stream)}, 'stderr': {'path': str(stream)},
                    'fs_diff': {'/sandbox': {'created': {'x': {'type': 'file'}}}, '/external': {}}}
            normalized = differential.observed(base)
            self.assertEqual(normalized['stdout'], b'<SANDBOX>/file\0other')
            self.assertEqual(normalized['fs_diff'], {'<SANDBOX>': {'created': {'x': {'type': 'file'}}}, '/external': {}})
            self.assertEqual(differential.observed({**base, 'sandbox': None})['stdout'], b'/sandbox/file\0other')
            self.assertEqual(differential.describe_filesystem({'root': {'deleted': {'x': 1}}}, {}),
                             'fs_diff:\n      deleted root/x: reference 1 candidate None')

    def test_invalid_later_case_options_prevent_all_launches(self):
        for options in (['--tty', 'bad'], ['--timeout', 'nan'], ['--send-signal', 'SIG_IGN'],
                        ['--env', 'bad'], ['--rows', '0'], ['--seed', 'fixture:work'],
                        ['--timeout', 'invalid', '--timeout', '1'], ['--after', 'invalid', '--after', '0'],
                        ['--timeout=invalid', '--timeout=1'], ['--after=invalid', '--after=0']):
            with self.subTest(options=options), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                marker, target = root / 'launched', root / 'target.py'
                target.write_text(f'from pathlib import Path\nPath({str(marker)!r}).touch()\n')
                command = shlex.join([sys.executable, str(target)])
                cases = [{'id': 'first', 'args': []}, {'id': 'bad', 'args': [], 'probe': options}]
                result = run_cases(root, cases, '--reference', command, '--candidate', command)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertFalse(marker.exists())
                self.assertFalse((root / 'out').exists())

    def test_stale_triage_is_reported_without_hiding_matches(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            self.assertEqual(run_cases(root, [{'id': 'one', 'args': []}]).returncode, 0)
            triage = root / 'triage.json'
            triage.write_text(json.dumps({'one': {'class': 'INTENTIONAL_CHANGE', 'reason': 'old'}}))
            result = subprocess.run([sys.executable, str(SCRIPT), 'compare', '--out', str(root / 'out'),
                                     '--triage', str(triage)], capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('MATCH one (stale triage entry, remove it)', result.stdout)


if __name__ == '__main__':
    unittest.main()
