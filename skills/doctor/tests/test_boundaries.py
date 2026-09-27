"""Regression coverage for inventory filesystem and process boundaries."""
import argparse
import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from test_inventory import SCRIPT, inventory, run_inventory


class PackageBoundaries(unittest.TestCase):
    def test_unsafe_npm_sources_are_not_scanned(self):
        sources = ('npm:/tmp/escape', 'npm:../escape', 'npm:@scope/../../escape',
                   'npm:', 'npm:@scope', 'npm:a/b', 'npm:a\\b', 'npm:a%2fb', 'npm:a\0b')
        for source in sources:
            with self.subTest(source=source):
                info = inventory.package_info(source, Path('/agent'), Path('/agent'))
                self.assertIsNone(info['dir'])
                self.assertIn('error', info)

    def test_npm_symlink_cannot_escape_managed_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            managed = root / 'npm/node_modules'
            managed.mkdir(parents=True)
            (managed / 'escape').symlink_to(root, target_is_directory=True)
            self.assertIsNone(inventory.package_info('npm:escape', root, root)['dir'])

    def test_cli_reports_unsafe_package(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            agent = root / 'agent'
            agent.mkdir()
            (agent / 'settings.json').write_text(json.dumps({'packages': ['npm:/tmp/escape']}))
            result = run_inventory(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIsNone(json.loads(result.stdout)['packages'][0]['dir'])


class ScanBoundaries(unittest.TestCase):
    def test_skill_read_and_traversal_errors_are_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'SKILL.md').write_text('content')
            with patch.object(Path, 'read_text', side_effect=PermissionError('denied')):
                with self.assertWarnsRegex(UserWarning, 'denied'):
                    self.assertEqual(inventory.scan_skills([root]), [])
            with patch.object(inventory.os, 'scandir', side_effect=PermissionError('traversal denied')):
                with self.assertWarnsRegex(UserWarning, 'traversal denied'):
                    self.assertEqual(inventory.scan_skills([root]), [])

    def test_unreadable_skill_does_not_hide_readable_sibling(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in ('good', 'bad'):
                directory = root / name
                directory.mkdir()
                (directory / 'SKILL.md').write_text(f'---\nname: {name}\ndescription: fixture\n---\n')
            original = Path.read_text
            def read_text(path, *args, **kwargs):
                if path.parent.name == 'bad':
                    raise PermissionError('denied')
                return original(path, *args, **kwargs)
            with patch.object(Path, 'read_text', read_text), self.assertWarns(UserWarning):
                result = inventory.scan_skills([root])
            self.assertEqual([skill['name'] for skill in result], ['good'])

    def test_session_encoding_failure_is_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'bad.jsonl'
            path.write_bytes(b'\xff')
            with self.assertWarnsRegex(UserWarning, 'read session'):
                self.assertEqual(list(inventory.session_entries(path)), [])

    def test_session_read_and_parse_failures_are_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'bad.jsonl'
            path.write_text('{broken\n{"type":"session"}\n')
            with self.assertWarnsRegex(UserWarning, 'session'):
                self.assertEqual(list(inventory.session_entries(path)), [{'type': 'session'}])
            with patch.object(Path, 'open', side_effect=PermissionError('denied')):
                with self.assertWarnsRegex(UserWarning, 'denied'):
                    self.assertEqual(list(inventory.session_entries(path)), [])

    def test_session_stat_race_is_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'gone.jsonl'
            path.touch()
            original = Path.stat
            def stat(candidate, *args, **kwargs):
                if candidate == path:
                    raise FileNotFoundError('disappeared')
                return original(candidate, *args, **kwargs)
            with patch.object(Path, 'stat', stat), self.assertWarnsRegex(UserWarning, 'disappeared'):
                self.assertEqual(inventory.session_files(root, 30), [])

    def test_invalid_header_path_is_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'bad.jsonl').write_text(json.dumps({'type': 'session', 'cwd': '\0bad'}))
            with self.assertWarnsRegex(UserWarning, 'header'):
                self.assertIsNone(inventory.newest_prompt(root, root))

    def test_extreme_days_rejected_without_traceback(self):
        with tempfile.TemporaryDirectory() as temp:
            result = run_inventory(Path(temp), '--days', '9' * 400)
            self.assertEqual(result.returncode, 2, result.stdout)
            self.assertNotIn('Traceback', result.stderr)

    def test_cli_marks_partial_session_results(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            sessions = root / 'agent/sessions'
            sessions.mkdir(parents=True)
            (sessions / 'broken.jsonl').write_text('{broken\n')
            result = run_inventory(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertTrue(report['partial'])
            self.assertEqual(report['diagnostics'][0]['operation'], 'read session')


class RemainingScanBoundaries(unittest.TestCase):
    def test_repository_boundary_error_is_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            original = Path.stat
            def stat(candidate, *args, **kwargs):
                if candidate.name == '.git':
                    raise PermissionError('repository denied')
                return original(candidate, *args, **kwargs)
            with patch.object(Path, 'stat', stat), patch.object(Path, 'home', return_value=root), \
                    self.assertWarnsRegex(UserWarning, 'repository denied'):
                self.assertEqual(inventory.skill_roots(root / 'agent', root, []), [])

    def test_missing_optional_roots_are_quiet(self):
        with tempfile.TemporaryDirectory() as temp:
            missing = Path(temp) / 'missing'
            with patch.object(inventory.warnings, 'warn') as warning:
                self.assertEqual(inventory.scan_skills([missing]), [])
                self.assertEqual(inventory.session_files(missing, 0), [])
            warning.assert_not_called()

    def test_broken_session_path_preserves_other_inventory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            loop = root / 'loop'
            loop.symlink_to(loop)
            result = run_inventory(root, '--session-dir', str(loop))
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertTrue(report['partial'])
            self.assertEqual(report['skills'], [])
            self.assertEqual(report['usage']['window']['files'], 0)

    def test_session_resolution_error_preserves_other_inventory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            sessions = root / 'sessions'
            args = argparse.Namespace(agent_dir=root / 'agent', cwd=root,
                                      session_dir=sessions, days=30)
            original = Path.resolve
            def resolve(candidate, *args, **kwargs):
                if candidate == sessions:
                    raise RuntimeError('symlink loop')
                return original(candidate, *args, **kwargs)
            with patch.object(Path, 'resolve', resolve), \
                    patch.dict(inventory.os.environ, {'HOME': str(root), 'PATH': ''}), \
                    self.assertWarnsRegex(UserWarning, 'resolve sessions'):
                report = inventory.inventory_report(args, inventory.diagnose)
            self.assertEqual(report['skills'], [])
            self.assertEqual(report['usage']['window']['files'], 0)

    def test_invalid_skill_encoding_is_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'SKILL.md').write_bytes(b'\xff')
            with self.assertWarnsRegex(UserWarning, 'read skill'):
                self.assertEqual(inventory.scan_skills([root]), [])

    def test_session_traversal_failure_is_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(inventory.os, 'scandir', side_effect=PermissionError('denied')), \
                    self.assertWarnsRegex(UserWarning, 'walk sessions'):
                self.assertEqual(inventory.session_files(Path(temp), 30), [])

    def test_out_of_range_timestamp_is_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'bad.jsonl'
            path.touch()
            original = Path.stat
            def stat(candidate, *args, **kwargs):
                if candidate == path:
                    return argparse.Namespace(st_mode=0o100644, st_mtime=1e100)
                return original(candidate, *args, **kwargs)
            with patch.object(Path, 'stat', stat), self.assertWarnsRegex(UserWarning, 'stat session'):
                self.assertEqual(inventory.session_files(root, 30), [])


class AdditionalBoundaries(unittest.TestCase):
    def test_settings_permission_and_encoding_errors_are_explicit(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'settings.json'
            path.write_bytes(b'\xff')
            self.assertIn('unparseable', inventory.load_json(path)[1])
            with patch.object(Path, 'read_text', side_effect=PermissionError('denied')):
                self.assertIn('denied', inventory.load_json(path)[1])

    def test_unreadable_optional_directory_is_not_absence(self):
        with patch.object(Path, 'stat', side_effect=PermissionError('denied')):
            with self.assertWarnsRegex(UserWarning, 'denied'):
                self.assertEqual(inventory.session_files(Path('/sessions'), 30), [])

    def test_invalid_trust_paths_are_diagnostics_not_stale(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            agent = root / 'agent'
            agent.mkdir()
            (agent / 'trust.json').write_text(json.dumps({'bad\0path': True}))
            result = run_inventory(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertTrue(report['partial'])
            self.assertEqual(report['trust']['stale'], [])
            self.assertEqual(report['diagnostics'][0]['operation'], 'inspect trust path')

    def test_invalid_trust_json_is_diagnostic(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            agent = root / 'agent'
            agent.mkdir()
            (agent / 'trust.json').write_text('{broken')
            result = run_inventory(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertTrue(report['partial'])
            self.assertEqual(report['diagnostics'][0]['operation'], 'read trust')

    def test_package_permission_error_is_not_absence(self):
        with patch.object(Path, 'stat', side_effect=PermissionError('denied')):
            result = inventory.package_info('git:host/user/repo', Path('/agent'), Path('/agent'))
        self.assertIn('error', result)
        self.assertIsNone(result['dir'])

    def test_cli_bad_package_marks_report_partial(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            agent = root / 'agent'
            agent.mkdir()
            (agent / 'settings.json').write_text(json.dumps({'packages': ['npm:../escape']}))
            report = json.loads(run_inventory(root).stdout)
            self.assertTrue(report['partial'])

    def test_malformed_header_has_explicit_diagnostic(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'bad.jsonl').write_text(json.dumps({'type': 'session', 'cwd': []}))
            with self.assertWarnsRegex(UserWarning, 'header'):
                self.assertIsNone(inventory.newest_prompt(root, root))


class ContractBoundaries(unittest.TestCase):
    def test_day_limits_and_invalid_cli_values(self):
        self.assertEqual(inventory.nonnegative_days('0'), 0)
        self.assertEqual(inventory.nonnegative_days(str(inventory.MAX_DAYS)), inventory.MAX_DAYS)
        for value in ('-1', str(inventory.MAX_DAYS + 1)):
            with self.subTest(value=value), self.assertRaises(argparse.ArgumentTypeError):
                inventory.nonnegative_days(value)
        with tempfile.TemporaryDirectory() as temp:
            result = run_inventory(Path(temp), '--days', 'not-a-number')
            self.assertEqual(result.returncode, 2)
            self.assertNotIn('Traceback', result.stderr)

    def test_valid_npm_sources_preserve_managed_locations(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp).resolve()
            for source, name in (('npm:tool', 'tool'), ('npm:tool@latest', 'tool'),
                                 ('npm:@scope/tool', '@scope/tool'), ('npm:@scope/tool@1.0', '@scope/tool')):
                with self.subTest(source=source):
                    self.assertEqual(inventory.package_dir(source, root, root), root / 'npm/node_modules' / name)

    def test_session_scan_stats_each_file_once(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'one.jsonl'
            path.touch()
            original = Path.stat
            with patch.object(Path, 'stat', autospec=True, side_effect=original) as stat_call:
                result = inventory.session_files(root, 30)
            self.assertEqual([item[0] for item in result], [path])
            self.assertEqual(sum(call.args[0] == path for call in stat_call.call_args_list), 1)

    def test_settings_and_prompt_inputs_remain_unchanged(self):
        settings = {'skills': ['custom'], 'packages': [{'source': 'npm:tool'}]}
        original = json.dumps(settings)
        self.assertIsNone(inventory.validate_settings(settings))
        self.assertEqual(json.dumps(settings), original)
        entries = ({'message': {'role': 'system', 'sections': {'base': 'hello'},
                               'toolsAdded': [{'name': 'read'}]}},)
        original = json.dumps(entries)
        first = inventory.prompt_state(entries)
        inventory.prompt_state(({'message': {'role': 'system', 'sections': {'base': None}}},))
        self.assertEqual(first[0], {'base': 'hello'})
        self.assertEqual(json.dumps(entries), original)

    def test_home_isolated_and_empty_inventory_is_complete(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            skill = root / '.agents/skills/isolated'
            skill.mkdir(parents=True)
            (root / '.git').mkdir()
            (skill / 'SKILL.md').write_text('---\nname: isolated\ndescription: fixture\n---\n')
            report = json.loads(run_inventory(root).stdout)
            self.assertFalse(report['partial'])
            self.assertEqual(report['diagnostics'], [])
            self.assertEqual([item['name'] for item in report['skills']], ['isolated'])
            self.assertEqual(report['install']['version_command']['status'], 'not_found')

    def test_version_failure_through_cli(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            executable = root / 'pi'
            executable.write_text('#!/bin/sh\nprintf misleading\nexit 7\n')
            executable.chmod(0o700)
            result = subprocess.run([sys.executable, str(SCRIPT), '--agent-dir', str(root / 'agent'),
                                     '--cwd', str(root)], env={'HOME': str(root), 'PATH': str(root)},
                                    capture_output=True, text=True, timeout=20)
            self.assertEqual(result.returncode, 0, result.stderr)
            report = json.loads(result.stdout)
            self.assertTrue(report['partial'])
            self.assertIsNone(report['install']['version'])
            self.assertEqual(report['install']['version_command']['returncode'], 7)


class InstallBoundaries(unittest.TestCase):
    def test_version_nonzero_is_not_accepted(self):
        failed = subprocess.CompletedProcess(['pi', '--version'], 7, 'not a version', 'failed')
        with patch.object(inventory.shutil, 'which', return_value='/pi'), \
                patch.object(inventory.subprocess, 'run', return_value=failed), \
                patch.dict(inventory.os.environ, {'PATH': ''}), \
                self.assertWarnsRegex(UserWarning, 'version'):
            result = inventory.install_info(Path('/missing-agent'))
        self.assertIsNone(result['version'])
        self.assertEqual(result['version_command']['returncode'], 7)
        self.assertEqual(result['version_command']['status'], 'failed')

    def test_version_timeout_and_execution_errors_are_explicit(self):
        failures = ((subprocess.TimeoutExpired('pi', 30), 'timeout'),
                    (OSError('cannot execute'), 'error'),
                    (UnicodeError('invalid output'), 'error'))
        for error, status in failures:
            with self.subTest(status=status), patch.object(inventory.shutil, 'which', return_value='/pi'), \
                    patch.object(inventory.subprocess, 'run', side_effect=error), \
                    patch.dict(inventory.os.environ, {'PATH': ''}), self.assertWarns(UserWarning):
                result = inventory.install_info(Path('/missing-agent'))
                self.assertIsNone(result['version'])
                self.assertEqual(result['version_command']['status'], status)

    def test_unreadable_releases_are_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            (root / 'install/releases').mkdir(parents=True)
            with patch.object(Path, 'iterdir', side_effect=PermissionError('denied')), \
                    patch.dict(inventory.os.environ, {'PATH': ''}), self.assertWarnsRegex(UserWarning, 'releases'):
                self.assertEqual(inventory.install_info(root)['releases'], [])

    def test_disappearing_release_preserves_other_releases(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            for name in ('good', 'gone'):
                (root / name).mkdir()
            original = Path.stat
            def stat(path, *args, **kwargs):
                if path.name == 'gone':
                    raise FileNotFoundError('disappeared')
                return original(path, *args, **kwargs)
            with patch.object(Path, 'stat', stat), self.assertWarnsRegex(UserWarning, 'stat release'):
                self.assertEqual(inventory.installed_releases(root), ['good'])

    def test_executable_resolution_failure_is_reported(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            executable = root / 'pi'
            executable.touch(mode=0o700)
            with patch.dict(inventory.os.environ, {'PATH': str(root)}), \
                    patch.object(Path, 'resolve', side_effect=RuntimeError('resolution failed')), \
                    patch.object(inventory.shutil, 'which', return_value=None), \
                    self.assertWarnsRegex(UserWarning, 'inspect executable'):
                result = inventory.install_info(root)
            self.assertEqual(result['pi_on_path'], [])
            self.assertEqual(result['version_command']['status'], 'not_found')

    def test_successful_version_and_absent_optional_directories(self):
        success = subprocess.CompletedProcess(['pi', '--version'], 0, '1.2.3\n', '')
        with tempfile.TemporaryDirectory() as temp:
            with patch.object(inventory.shutil, 'which', return_value='/pi'), \
                    patch.object(inventory.subprocess, 'run', return_value=success), \
                    patch.dict(inventory.os.environ, {'PATH': ''}):
                result = inventory.install_info(Path(temp))
            self.assertEqual(result['version'], '1.2.3')
            self.assertEqual(result['version_command']['status'], 'ok')
            self.assertEqual(result['releases'], [])


if __name__ == '__main__':
    unittest.main()
