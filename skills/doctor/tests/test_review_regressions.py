"""Regressions for the independent doctor remediation review."""
import io
import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stdout
from pathlib import Path
from unittest.mock import patch

from test_inventory import SCRIPT, inventory, log, run_inventory


class ReviewRegressions(unittest.TestCase):
    def test_existing_file_session_root_has_its_own_diagnostic(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            sessions = root / 'not-a-directory'
            sessions.touch()
            result = run_inventory(root, '--session-dir', str(sessions))
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertTrue(report['partial'])
            self.assertEqual(report['usage']['window']['files'], 0)
            self.assertIsNone(report['prompt'])
            self.assertIn({'operation': 'inspect directory', 'path': str(sessions.resolve()),
                           'error': 'not a directory'}, report['diagnostics'])

    def test_shallow_prompt_fallback_follows_directory_symlinks(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            sessions = root / 'sessions'
            sessions.mkdir()
            target = root / 'external-history'
            target.mkdir()
            log(target / 'session.jsonl', root / 'project',
                [{'role': 'system', 'sections': {'base': 'hello'}}])
            link = sessions / 'non-keyed-link'
            link.symlink_to(target, target_is_directory=True)
            self.assertEqual(list(sessions.glob('*/*.jsonl')), [link / 'session.jsonl'])
            result = run_inventory(root, '--session-dir', str(sessions))
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertIsNotNone(report['prompt'])
            self.assertEqual(report['prompt']['section_chars'], {'base': 5})
            self.assertEqual(report['usage']['window']['files'], 0)
            self.assertFalse(report['partial'])

    def test_explicit_cwd_does_not_evaluate_missing_process_cwd(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            output = io.StringIO()
            argv = ['inventory', '--agent-dir', str(root / 'agent'), '--cwd', str(root)]
            with patch.object(sys, 'argv', argv), patch.dict(os.environ, {'HOME': str(root), 'PATH': ''}, clear=True), \
                    patch.object(Path, 'cwd', side_effect=FileNotFoundError('cwd removed')) as cwd, \
                    redirect_stdout(output):
                self.assertEqual(inventory.main(), 0)
            cwd.assert_not_called()
            report = json.loads(output.getvalue())
            self.assertFalse(report['partial'])
            self.assertEqual(report['cwd'], str(root))

    def test_missing_default_cwd_is_an_inventory_diagnostic(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            output = io.StringIO()
            with patch.object(sys, 'argv', ['inventory', '--agent-dir', str(root / 'agent')]), \
                    patch.object(Path, 'cwd', side_effect=FileNotFoundError('cwd removed')), \
                    redirect_stdout(output):
                self.assertEqual(inventory.main(), 0)
            report = json.loads(output.getvalue())
            self.assertTrue(report['partial'])
            self.assertEqual(report['diagnostics'][0]['error'], 'cwd removed')

    def test_home_failure_is_inside_inventory_boundary(self):
        for explicit_agent in (False, True):
            with self.subTest(explicit_agent=explicit_agent), tempfile.TemporaryDirectory() as temp:
                root = Path(temp).resolve()
                argv = ['inventory', '--cwd', str(root)]
                argv = [*argv, '--agent-dir', str(root / 'agent')] if explicit_agent else argv
                output = io.StringIO()
                with patch.object(sys, 'argv', argv), patch.dict(os.environ, {'PATH': ''}, clear=True), \
                        patch.object(Path, 'home', side_effect=RuntimeError('home unavailable')), \
                        redirect_stdout(output):
                    self.assertEqual(inventory.main(), 0)
                report = json.loads(output.getvalue())
                self.assertTrue(report['partial'])
                self.assertEqual(report['diagnostics'][0]['error'], 'home unavailable')

    def test_failed_version_stderr_is_not_published(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            executable = root / 'pi'
            executable.write_text('#!/bin/sh\nprintf "SECRET_SENTINEL_91" >&2\nexit 7\n')
            executable.chmod(0o700)
            result = subprocess.run([sys.executable, str(SCRIPT), '--agent-dir', str(root / 'agent'),
                                     '--cwd', str(root)], env={'HOME': str(root), 'PATH': str(root)},
                                    capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertNotIn('SECRET_SENTINEL_91', result.stdout + result.stderr)
            report = json.loads(result.stdout)
            self.assertTrue(report['partial'])
            self.assertEqual(report['install']['version_command']['returncode'], 7)
            self.assertIsNone(report['install']['version'])


if __name__ == '__main__':
    unittest.main()
