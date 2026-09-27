import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'


class ReviewedReplay(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix='cli-re-replay-')
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.workspace = self.root / '.re'
        self.target = self.root / 'tool'
        self.target.write_text('#!/bin/sh\nprintf ok\n')
        self.target.chmod(0o755)
        result = self.invoke('init', '--target', str(self.target))
        self.assertEqual(result.returncode, 0, result.stderr)

    def invoke(self, action, *args):
        return subprocess.run([sys.executable, str(SCRIPTS / 'investigate.py'), action,
                               '--workspace', str(self.workspace), *args], capture_output=True,
                              text=True, timeout=20)

    def case(self, **changes):
        return {'id': 'one', 'question': 'What happens?', 'safe': True, 'args': [],
                'expect': {'exit_code': 0}, **changes}

    def replay(self, cases):
        (self.workspace / 'probes/cases.json').write_text(json.dumps(cases))
        return self.invoke('run')

    def test_invalid_reviewed_corpora_fail_before_any_replay_output(self):
        changes = ({'id': '../escape'}, {'id': None}, {'safe': False}, {'question': ''},
                   {'args': None}, {'args': ['\0']}, {'env': []}, {'env': {'HOME': '/tmp'}},
                   {'env': {'bad=name': 'x'}}, {'expect': {'unknown': 1}},
                   {'stdin_file': 'input', 'stdin_text': 'text'}, {'stdin_text': None},
                   {'timeout': True}, {'timeout': 0}, {'timeout': float('inf')},
                   {'after': -1}, {'send_signal': 'TERM', 'timeout': 1, 'after': 1},
                   {'stdin_mode': 'invalid'}, {'tty': 'invalid'}, {'seed': [None]}, {'unknown': 1})
        corpora = (None, {}, [], [None], [self.case(), self.case()],
                   *([self.case(**change)] for change in changes))
        for cases in corpora:
            with self.subTest(cases=cases):
                result = self.replay(cases)
                self.assertEqual(result.returncode, 2, result.stderr)
                self.assertNotIn('Traceback', result.stderr)
                self.assertFalse((self.workspace / 'probes/runs').exists())

    def test_nested_enum_assertion_and_timing_errors_are_rejected_before_output(self):
        changes = ({'stdin_mode': []}, {'tty': {}}, {'question': 'bad\0question'}, {'seed': ['bad\0seed']},
                   {'timeout': 10 ** 400}, {'after': 10 ** 400}, {'send_signal': 'SIG_IGN'},
                   {'send_signal': 'NO_SUCH_SIGNAL'}, {'expect': {'exit_code': False}},
                   {'expect': {'timed_out': 0}}, {'expect': {'signal': 'SIG_IGN'}},
                   {'expect': {'stdout_sha256': 'bad'}}, {'expect': {'stderr_sha256': None}})
        for change in changes:
            with self.subTest(change=change):
                result = self.replay([self.case(**change)])
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertNotIn('Traceback', result.stderr)
                self.assertFalse((self.workspace / 'probes/runs').exists())

    def test_large_finite_timeout_remains_supported(self):
        result = self.replay([self.case(timeout=1e300)])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_signal_assertions_require_emitted_names(self):
        for name in ('TERM', 'term', 'SIGIOT'):
            with self.subTest(name=name):
                result = self.replay([self.case(expect={'signal': name})])
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertFalse((self.workspace / 'probes/runs').exists())

    def test_send_signal_accepts_lowercase_with_a_canonical_assertion(self):
        self.target.write_text('#!/bin/sh\nexec sleep 20\n')
        identity_path = self.workspace / 'target/identity.json'
        identity = json.loads(identity_path.read_text())
        item = {**identity['artifacts'][0], 'sha256': hashlib.sha256(self.target.read_bytes()).hexdigest(), 'copy': None}
        identity_path.write_text(json.dumps({**identity, 'artifacts': [item]}))
        result = self.replay([self.case(send_signal='term', after=.1, timeout=3,
                                       expect={'signal': 'SIGTERM', 'exit_code': None})])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        record = json.loads((self.workspace / 'probes/results.jsonl').read_text())
        self.assertEqual(record['signal'], 'SIGTERM')
        self.assertEqual(record['signal_sent']['signal'], 'SIGTERM')

    def test_malformed_identity_is_rejected_before_output(self):
        path = self.workspace / 'target/identity.json'
        base = json.loads(path.read_text())
        invalid = (None, [], {'target_path': []}, {**base, 'artifacts': [None]},
                   {**base, 'artifacts': [{}]}, {**base, 'artifacts': 'bad'},
                   {**base, 'artifacts': [{**base['artifacts'][0], 'copy': []}]})
        for identity in invalid:
            with self.subTest(identity=identity):
                path.write_text(json.dumps(identity))
                result = self.replay([self.case()])
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertNotIn('Traceback', result.stderr)
                self.assertFalse((self.workspace / 'probes/runs').exists())

    def test_successful_runner_requires_one_valid_appended_observation(self):
        runner = self.workspace / 'repro/scripts/probe.py'
        for output in ('', 'null\n', '{}\n', '[]\n', '{broken\n'):
            with self.subTest(output=output):
                runner.write_text('import sys\nfrom pathlib import Path\n'
                                  'out = Path(sys.argv[sys.argv.index("--out") + 1])\n'
                                  f'(out / "probes.jsonl").write_text({output!r})\n')
                result = self.replay([self.case()])
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertNotIn('Traceback', result.stderr)
                self.assertEqual((self.workspace / 'probes/results.jsonl').read_text(), '')

    def test_runner_capture_and_input_errors_cannot_pass_exit_only_expectations(self):
        path = self.workspace / 'repro/scripts/probe.py'
        original = path.read_text()
        for operation in ('read', 'write'):
            with self.subTest(operation=operation):
                injection = (f'_original_io = os.{operation}\n'
                             'def injected_io(*args):\n'
                             '    if threading.current_thread() is not threading.main_thread():\n'
                             '        raise OSError(22, "injected")\n'
                             '    return _original_io(*args)\n'
                             f'os.{operation} = injected_io\n\n')
                path.write_text(original.replace('if __name__ == "__main__":', injection + 'if __name__ == "__main__":'))
                result = self.replay([self.case(stdin_text='input')])
                self.assertEqual(result.returncode, 1, result.stdout + result.stderr)
                self.assertIn('execution', json.loads(result.stdout)['failures'][0]['mismatches'])

    def test_replay_reads_only_new_observation_bytes(self):
        record = {'exit_code': 0, 'signal': None, 'timed_out': False,
                  'stdout': {'sha256': '0' * 64}, 'stderr': {'sha256': '0' * 64}}
        runner = self.workspace / 'repro/scripts/probe.py'
        runner.write_text('import json,sys\nfrom pathlib import Path\n'
                          'out = Path(sys.argv[sys.argv.index("--out") + 1]) / "probes.jsonl"\n'
                          'case = sys.argv[sys.argv.index("--id") + 1]\n'
                          'if out.exists():\n'
                          '    with out.open("r+b") as stream: stream.write(b"\\xff")\n'
                          f'record = {{**{record!r}, "id": case}}\n'
                          'with out.open("ab") as stream: stream.write(json.dumps(record).encode() + b"\\n")\n')
        result = self.replay([self.case(id='one'), self.case(id='two')])
        self.assertEqual(result.returncode, 0, result.stderr)
        records = [json.loads(line) for line in (self.workspace / 'probes/results.jsonl').read_text().splitlines()]
        self.assertEqual([record['id'] for record in records], ['one', 'two'])

    def test_malformed_new_outcomes_do_not_use_legacy_defaults(self):
        base = {'id': 'one', 'exit_code': 0, 'signal': None, 'timed_out': False,
                'stdout': {'sha256': '0' * 64}, 'stderr': {'sha256': '0' * 64}}
        invalid = ({'input_delivery': None}, {'capture_outcomes': []}, {'launch_error': {}},
                   {'launch_error': {'type': 'OSError', 'errno': True, 'message': 'bad'}},
                   {'capture_complete': 0}, {'descendants_hold_output': 0},
                   {'signal': 'term'}, {'signal': 'TERM'}, {'signal': 'SIGIOT'},
                   {'input_delivery': {'status': 'complete', 'bytes': False, 'error': None}},
                   {'input_delivery': {'status': 'error', 'bytes': 0, 'error': {'errno': []}}})
        runner = self.workspace / 'repro/scripts/probe.py'
        for change in invalid:
            with self.subTest(change=change):
                runner.write_text('import sys\nfrom pathlib import Path\n'
                                  'out = Path(sys.argv[sys.argv.index("--out") + 1])\n'
                                  f'(out / "probes.jsonl").write_text({json.dumps({**base, **change})!r} + "\\n")\n')
                result = self.replay([self.case()])
                self.assertEqual(result.returncode, 2, result.stdout + result.stderr)
                self.assertNotIn('Traceback', result.stderr)

    def test_modified_copy_and_wrong_first_artifact_stop_replay(self):
        path = self.workspace / 'target/identity.json'
        identity = json.loads(path.read_text())
        copied = Path(identity['artifacts'][0]['copy'])
        original = copied.read_bytes()
        copied.write_bytes(b'changed')
        self.assertIn('evidence copy changed', self.replay([self.case()]).stderr)
        copied.write_bytes(original)
        path.write_text(json.dumps({**identity, 'artifacts': []}))
        self.assertIn('target must be the first', self.replay([self.case()]).stderr)
        path.write_text(json.dumps({**identity, 'target_path': None}))
        self.assertIn('source-only investigation', self.replay([self.case()]).stderr)
        self.assertFalse((self.workspace / 'probes/runs').exists())

    def test_replay_forwards_stdin_environment_and_seed_inputs(self):
        fixture = self.root / 'fixture'
        fixture.write_text('seeded')
        script = self.root / 'inspect.py'
        script.write_text('import os, pathlib, sys\n'
                          'print(os.getenv("AUDIT_TEST"), os.getenv("AUDIT_MISSING"))\n'
                          'print(pathlib.Path("seed").read_text())\n'
                          'print(sys.stdin.read())\n')
        cases = [self.case(args=[str(script)], env={'AUDIT_TEST': 'present', 'AUDIT_MISSING': None},
                           seed=[f'{fixture}:work/seed'], stdin_text='input', stdin_mode='pipe', tty='none',
                           expect={'exit_code': 0, 'stdout_sha256': hashlib.sha256(b'present None\nseeded\ninput\n').hexdigest()})]
        identity_path = self.workspace / 'target/identity.json'
        identity = json.loads(identity_path.read_text())
        executable = Path(sys.executable).absolute()
        item = {'path': str(executable), 'resolved_path': str(executable.resolve()),
                'sha256': hashlib.sha256(executable.read_bytes()).hexdigest()}
        identity_path.write_text(json.dumps({**identity, 'target_path': str(executable), 'artifacts': [item]}))
        result = self.replay(cases)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        record = json.loads((self.workspace / 'probes/results.jsonl').read_text())
        self.assertEqual(record['env_overrides']['AUDIT_TEST'], 'present')
        self.assertIsNone(record['env_overrides']['AUDIT_MISSING'])
        self.assertEqual(record['stdin']['mode'], 'pipe')

    def test_runner_failure_is_reported_without_fabricated_target_result(self):
        (self.workspace / 'repro/scripts/probe.py').write_text('raise SystemExit(7)\n')
        result = self.replay([self.case()])
        self.assertEqual(result.returncode, 1)
        summary = json.loads(result.stdout)
        self.assertEqual(summary['failures'], [{'case': 'one', 'reason': 'probe runner failed', 'exit_code': 7}])
        self.assertEqual((self.workspace / 'probes/results.jsonl').read_text(), '')

    def test_launch_errors_and_timeouts_cannot_pass_an_exit_only_assertion(self):
        self.target.chmod(0o644)
        result = self.replay([self.case(expect={'exit_code': None})])
        self.assertEqual(result.returncode, 1)
        self.assertIn('execution', json.loads(result.stdout)['failures'][0]['mismatches'])
        self.target.chmod(0o755)
        self.target.write_text('#!/bin/sh\nsleep 10\n')
        identity_path = self.workspace / 'target/identity.json'
        identity = json.loads(identity_path.read_text())
        item = {**identity['artifacts'][0], 'sha256': hashlib.sha256(self.target.read_bytes()).hexdigest(), 'copy': None}
        identity_path.write_text(json.dumps({**identity, 'artifacts': [item]}))
        result = self.replay([self.case(timeout=.1, expect={'exit_code': None})])
        self.assertEqual(result.returncode, 1)
        self.assertIn('timeout', json.loads(result.stdout)['failures'][0]['mismatches'])
        result = self.replay([self.case(timeout=.1, expect={'timed_out': True})])
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_invalid_initialization_does_not_create_a_workspace(self):
        new_workspace = self.root / 'new'
        for args in ([], ['--target', str(self.root / 'missing')],
                     ['--target', str(self.target), '--artifact', str(self.root / 'missing')]):
            with self.subTest(args=args):
                result = subprocess.run([sys.executable, str(SCRIPTS / 'investigate.py'), 'init',
                                         '--workspace', str(new_workspace), *args], capture_output=True, text=True)
                self.assertEqual(result.returncode, 2)
                self.assertNotIn('Traceback', result.stderr)
                self.assertFalse(new_workspace.exists())


if __name__ == '__main__':
    unittest.main()
