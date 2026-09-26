"""Executable-boundary checks for evidence preservation and replay failures."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'


class EvidenceTools(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='cli-re-test-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.out = self.root / 'probes'

    def probe(self, *args, expected=0):
        result = subprocess.run([sys.executable, str(SCRIPTS / 'probe.py'), '--out', str(self.out),
                                 *args], capture_output=True, timeout=20)
        self.assertEqual(result.returncode, expected, result.stderr.decode())
        if expected:
            return result
        return json.loads((self.out / 'probes.jsonl').read_text().splitlines()[-1])

    def test_streams_stdin_files_and_repeated_ids_preserve_evidence(self):
        code = 'import sys,pathlib; x=sys.stdin.buffer.read(); sys.stdout.buffer.write(x); sys.stderr.write("err"); pathlib.Path("created").write_bytes(x)'
        fixture = self.root / 'input.bin'
        fixture.write_bytes(b'hello\x00world')
        args = ['--id', 'repeat', '--isolate', '--clean-env', '--stdin-file', str(fixture), '--', sys.executable, '-c', code]
        first = self.probe(*args)
        second = self.probe(*args)
        self.assertNotEqual(first['sandbox'], second['sandbox'])
        self.assertNotEqual(first['stdout']['path'], second['stdout']['path'])
        self.assertEqual(Path(first['stdout']['path']).read_bytes(), fixture.read_bytes())
        self.assertEqual(Path(first['stderr']['path']).read_bytes(), b'err')
        self.assertEqual(Path(first['stdin_fixture']).read_bytes(), fixture.read_bytes())
        self.assertIn('work/created', first['fs_diff'][first['sandbox']]['created'])
        self.assertTrue(Path(first['filesystem_before']).is_file())
        self.assertIsNone(first['network_observed'])

    def test_tty_streams_remain_separate(self):
        record = self.probe('--isolate', '--clean-env', '--tty', 'both', '--', sys.executable,
                            '-c', 'import os; print(os.isatty(1)); os.write(2,b"stderr\\n")')
        self.assertEqual(Path(record['stdout']['path']).read_bytes(), b'True\r\n')
        self.assertEqual(Path(record['stderr']['path']).read_bytes(), b'stderr\r\n')

    def test_launch_failure_is_not_target_exit(self):
        record = self.probe('--isolate', '--', str(self.root / 'missing'))
        self.assertIsNone(record['exit_code'])
        self.assertEqual(record['launch_error']['type'], 'FileNotFoundError')
        self.assertTrue(record['capture_complete'])

    def test_timeout_and_signal_are_recorded(self):
        record = self.probe('--timeout', '.3', '--after', '.1', '--', sys.executable,
                            '-c', 'import time; time.sleep(10)')
        self.assertTrue(record['timed_out'])
        self.assertEqual(record['signal'], 'SIGTERM')
        record = self.probe('--send-signal', 'TERM', '--after', '.1', '--', sys.executable,
                            '-c', 'import time; time.sleep(10)')
        self.assertFalse(record['timed_out'])
        self.assertEqual(record['signal_sent']['signal'], 'SIGTERM')

    def test_relative_executable_hash_uses_child_cwd(self):
        target = self.root / 'target'
        target.write_text('#!/bin/sh\nprintf ok\n')
        target.chmod(0o755)
        record = self.probe('--cwd', str(self.root), '--', './target')
        self.assertEqual(record['target']['sha256'], hashlib.sha256(target.read_bytes()).hexdigest())
        self.assertEqual(Path(record['stdout']['path']).read_bytes(), b'ok')

    def test_seed_escape_and_id_escape_are_rejected(self):
        fixture = self.root / 'seed'
        fixture.write_text('test')
        self.probe('--id', '../escape', '--', '/bin/true', expected=2)
        result = subprocess.run([sys.executable, str(SCRIPTS / 'probe.py'), '--out', str(self.out),
                                 '--isolate', '--seed', f'{fixture}:../../escape', '--', '/bin/true'],
                                capture_output=True, timeout=10)
        self.assertNotEqual(result.returncode, 0)
        self.assertFalse((self.out / 'escape').exists())

    def test_corpus_assertions_empty_cases_hashes_and_replay(self):
        target = self.root / 'tool'
        target.write_text('#!/bin/sh\nprintf "hello\\n"\n')
        target.chmod(0o755)
        workspace = self.root / '.re'
        init = [sys.executable, str(SCRIPTS / 'investigate.py'), 'init', '--workspace', str(workspace), '--target', str(target)]
        self.assertEqual(subprocess.run(init, capture_output=True).returncode, 0)
        self.assertEqual(subprocess.run(init, capture_output=True).returncode, 2)
        run = [sys.executable, str(workspace / 'repro/run-all')]
        self.assertEqual(subprocess.run(run, capture_output=True).returncode, 2)
        cases = [{'id': 'help', 'question': 'What bytes are printed?', 'safe': True, 'args': [],
                  'expect': {'exit_code': 0, 'stdout_sha256': hashlib.sha256(b'hello\n').hexdigest()}}]
        corpus = workspace / 'probes/cases.json'
        corpus.write_text(json.dumps(cases))
        for _ in range(2):
            result = subprocess.run(run, capture_output=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr.decode() + result.stdout.decode())
        records = [json.loads(line) for line in (workspace / 'probes/results.jsonl').read_text().splitlines()]
        self.assertEqual(len(records), 2)
        self.assertNotEqual(records[0]['stdout']['path'], records[1]['stdout']['path'])
        cases[0]['expect']['exit_code'] = 9
        corpus.write_text(json.dumps(cases))
        self.assertEqual(subprocess.run(run, capture_output=True).returncode, 1)
        del cases[0]['expect']
        corpus.write_text(json.dumps(cases))
        self.assertEqual(subprocess.run(run, capture_output=True).returncode, 3)
        target.write_text('#!/bin/sh\nprintf changed\n')
        self.assertEqual(subprocess.run(run, capture_output=True).returncode, 2)

    def test_source_only_identity_does_not_claim_runtime(self):
        repo = self.root / 'repository'
        repo.mkdir()
        subprocess.run(['git', 'init', '-q', str(repo)], check=True)
        workspace = self.root / '.re'
        result = subprocess.run([sys.executable, str(SCRIPTS / 'investigate.py'), 'init',
                                 '--workspace', str(workspace), '--repository', str(repo)], capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        identity = json.loads((workspace / 'target/identity.json').read_text())
        self.assertIsNone(identity['target_path'])
        self.assertIsNone(identity['reported_version'])
        self.assertEqual(identity['version_correspondence'], 'UNKNOWN')

    def test_existing_differential_consumer_can_replay_twice(self):
        script = SCRIPTS.parents[1] / 'implement-cli-from-contract/scripts/differential.py'
        corpus = self.root / 'cases.json'
        corpus.write_text(json.dumps([{'id': 'one', 'args': ['hello'], 'probe': ['--isolate', '--clean-env']}]))
        for _ in range(2):
            result = subprocess.run([sys.executable, str(script), 'run', str(corpus), '--reference', '/bin/echo',
                                     '--candidate', '/bin/echo', '--out', str(self.out)], capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr.decode())
            comparison = subprocess.run([sys.executable, str(script), 'compare', '--out', str(self.out)], capture_output=True)
            self.assertEqual(comparison.returncode, 0, comparison.stdout.decode() + comparison.stderr.decode())


if __name__ == '__main__':
    unittest.main()
