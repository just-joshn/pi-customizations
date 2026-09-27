"""Process checks for reviewed corpus validation, isolation, and failure evidence."""
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
