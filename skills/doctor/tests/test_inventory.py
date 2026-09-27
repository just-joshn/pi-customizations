"""Inventory uses parsed session records and respects project boundaries."""
import importlib.util
import io
import json
import os
import subprocess
import sys
from contextlib import redirect_stdout
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / 'scripts/inventory.py'
SPEC = importlib.util.spec_from_file_location('inventory', SCRIPT)
inventory = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(inventory)


def log(path, cwd, messages):
    records = [{'type': 'session', 'cwd': str(cwd)},
               *({'type': 'message', 'timestamp': '2026-09-26', 'message': message} for message in messages)]
    path.write_text('\n'.join(json.dumps(record) for record in records) + '\n')


def run_inventory(root, *options):
    return subprocess.run([sys.executable, str(SCRIPT), '--agent-dir', str(root / 'agent'),
                           '--cwd', str(root / 'project'), *options], cwd=root,
                          env={**os.environ, 'HOME': str(root), 'PATH': '', 'PI_CODING_AGENT_SESSION_DIR': ''},
                          capture_output=True, text=True, timeout=20)


class InventorySessions(unittest.TestCase):
    def test_relative_session_directory_uses_requested_cwd(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            project = root / 'project'
            (project / '.pi').mkdir(parents=True)
            sessions = project / 'history'
            sessions.mkdir()
            log(sessions / 'session.jsonl', project, [{'role': 'system', 'sections': {'base': 'hello'}}])
            (project / '.pi/settings.json').write_text(json.dumps({'sessionDir': 'history'}))
            result = run_inventory(root)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(json.loads(result.stdout)['prompt']['section_chars'], {'base': 5})

    def test_invalid_settings_are_reported_and_negative_days_rejected(self):
        invalid = (None, [], {'skills': None}, {'skills': 'wrong'}, {'skills': [None]},
                   {'packages': None}, {'packages': {}}, {'packages': [12]}, {'packages': [{'source': 12}]},
                   {'sessionDir': 12}, {'sessionDir': ''})
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            config = root / 'project/.pi/settings.json'
            config.parent.mkdir(parents=True)
            for settings in invalid:
                with self.subTest(settings=settings):
                    config.write_text(json.dumps(settings))
                    result = run_inventory(root)
                    self.assertEqual(result.returncode, 0, result.stderr)
                    self.assertTrue(json.loads(result.stdout)['settings'][str(config.resolve())].startswith('invalid:'))
            negative = run_inventory(root, '--days', '-1')
            self.assertEqual(negative.returncode, 2)
            self.assertNotIn('Traceback', negative.stderr)

    def test_unsafe_remote_install_paths_are_reported_without_scanning(self):
        base = Path('/example/project/.pi')
        sources = ('git:git@evil.example:../../victim/repo', 'git:git@evil.example:/absolute/repo',
                   'https://evil.example/..%2F..%2Fvictim/repo',
                   'https://evil.example/..%2F..%2Fvictim/repo%',
                   'git:git@evil.example:user\\repo/name', 'git:git@evil.example:user/repo\0name',
                   'git:git@evil%2Fexample:user/repo')
        for source in sources:
            with self.subTest(source=source):
                info = inventory.package_info(source, base, base)
                self.assertFalse(info['exists'])
                self.assertIsNone(info['dir'])
                self.assertIn('error', info)

    def test_git_ssh_sources_map_to_official_managed_directories(self):
        base = Path('/example/project/.pi')
        sources = ('ssh://git@github.com/user/repo', 'ssh://git@github.com/user/repo.git@v1.0',
                   'git:git@github.com:user/repo@v1.0', 'git:ssh://git@github.com/user/repo.git',
                   'git:https://github.com/user/repo.git@main', 'https://github.com/user/repo#main')
        for source in sources:
            with self.subTest(source=source):
                self.assertEqual(inventory.package_dir(source, base, base), base / 'git/github.com/user/repo')

    def test_full_inventory_honors_project_session_directory(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            agent, project = root / 'agent', root / 'project'
            agent.mkdir()
            (project / '.pi').mkdir(parents=True)
            sessions = root / 'project-sessions'
            sessions.mkdir()
            log(sessions / 'ours.jsonl', project, [{'role': 'system', 'sections': {'base': 'hello'}}])
            (agent / 'settings.json').write_text(json.dumps({'sessionDir': str(root / 'old')}))
            (project / '.pi/settings.json').write_text(json.dumps({'sessionDir': str(sessions)}))
            (agent / 'trust.json').write_text(json.dumps({str(root / 'gone'): True}))
            output = io.StringIO()
            with patch('sys.argv', ['inventory', '--agent-dir', str(agent), '--cwd', str(project)]), \
                    patch.dict(inventory.os.environ, {'PATH': ''}, clear=True), \
                    patch.object(inventory.Path, 'home', return_value=root), redirect_stdout(output):
                self.assertEqual(inventory.main(), 0)
            result = json.loads(output.getvalue())
            self.assertEqual(result['prompt']['section_chars'], {'base': 5})
            self.assertEqual(result['usage']['window']['files'], 1)
            self.assertEqual(result['trust']['stale'], [str(root / 'gone')])

    def test_frontmatter_missing_invalid_and_folded_fields(self):
        self.assertEqual(inventory.frontmatter('body'), (None, 'no frontmatter'))
        self.assertEqual(inventory.frontmatter('---\nname: missing'), (None, 'unterminated frontmatter'))
        fields, error = inventory.frontmatter('---\nname: how\ndescription: >-\n  Explain\n  code\n---\n')
        self.assertIsNone(error)
        self.assertEqual(fields['description'], 'Explain code')

    def test_skill_problems_and_literal_configured_roots(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            agent, cwd = root / 'agent', root / 'project'
            (cwd / '.git').mkdir(parents=True)
            custom = agent / 'custom'
            custom.mkdir(parents=True)
            (custom / 'SKILL.md').write_text('---\nname: BAD NAME\ndescription: ""\nextra: true\n---\n')
            settings = [{'base': agent, 'data': {'skills': ['custom', '!disabled'], 'packages': []}}]
            with patch.object(inventory.Path, 'home', return_value=root):
                roots = inventory.skill_roots(agent, cwd, settings)
            self.assertEqual(roots, [custom.resolve()])
            problems = inventory.scan_skills(roots)[0]['problems']
            self.assertIn('invalid name', problems)
            self.assertIn('missing description (not loaded)', problems)
            self.assertIn('non-spec fields: extra', problems)
            self.assertEqual(inventory.package_dir('./local', agent, cwd), (cwd / 'local').resolve())
            self.assertEqual(inventory.load_json(root / 'missing'), (None, 'missing'))
            bad = root / 'bad.json'
            bad.write_text('{broken')
            self.assertIn('unparseable', inventory.load_json(bad)[1])

    def test_prompt_uses_only_active_branch_ancestry(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'session.jsonl'
            entries = [
                {'type': 'session', 'cwd': str(root)},
                {'type': 'message', 'id': 'a', 'parentId': None,
                 'message': {'role': 'system', 'sections': {'base': 'abc'}}},
                {'type': 'message', 'id': 'b', 'parentId': 'a',
                 'message': {'role': 'system', 'sections': {'abandoned': 'secret'}}},
                {'type': 'message', 'id': 'c', 'parentId': 'a',
                 'message': {'role': 'system', 'sections': {'active': 'xy'}}},
            ]
            path.write_text('\n'.join(json.dumps(entry) for entry in entries))
            self.assertEqual(inventory.newest_prompt(root, root)['section_chars'], {'base': 3, 'active': 2})

    def test_managed_packages_use_the_settings_scope(self):
        agent = Path('/example/agent')
        project = Path('/example/project/.pi')
        for base in (agent, project):
            with self.subTest(base=base):
                self.assertEqual(inventory.package_dir('npm:@org/skill@1.2.3', agent, base),
                                 base / 'npm/node_modules/@org/skill')
                self.assertEqual(inventory.package_dir('git:example.com/org/skill@main', agent, base),
                                 base / 'git/example.com/org/skill')

    def test_whitespace_json_counts_skill_and_tool_usage(self):
        with tempfile.TemporaryDirectory() as temp:
            path = Path(temp) / 'session.jsonl'
            log(path, temp, [{'role': 'user', 'content': '<skill name="how">'},
                             {'role': 'assistant', 'content': [{'type': 'toolCall', 'name': 'read',
                              'arguments': {'path': '/skills/how/SKILL.md'}}]}])
            result = inventory.scan_usage([path])
            self.assertEqual(result['skills']['how']['explicit'], 1)
            self.assertEqual(result['skills']['how']['model_reads'], 1)
            self.assertEqual(result['tools'], {'read': 1})

    def test_prompt_fallback_matches_header_cwd_and_applies_tool_deltas(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            cwd = root / 'project'
            log(root / 'ours.jsonl', cwd, [
                {'role': 'system', 'sections': {'one': 'abc'}, 'toolsAdded': [{'name': 'read'}]},
                {'role': 'system', 'sections': {'two': 'xy', 'one': None},
                 'toolsAdded': [{'name': 'bash'}], 'toolsRemoved': [{'name': 'read'}]}])
            log(root / 'other.jsonl', root / 'elsewhere', [{'role': 'system', 'sections': {'secret': 'unrelated'}}])
            result = inventory.newest_prompt(root, cwd)
            self.assertEqual(result['section_chars'], {'two': 2})
            self.assertEqual(set(result['tool_chars']), {'bash'})
            self.assertEqual(result['session'], str(root / 'ours.jsonl'))
            self.assertIsNone(inventory.newest_prompt(root, root / 'missing'))

    def test_malformed_records_and_fields_do_not_discard_valid_evidence(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            path = root / 'session.jsonl'
            log(path, root, [{'role': 'system', 'sections': {'one': 'abc'},
                              'toolsAdded': [None, 'bad', {'name': 'read'}],
                              'toolsRemoved': ['bad', None]},
                             {'role': 'system', 'sections': [], 'toolsAdded': 'bad'},
                             {'role': 'user', 'content': [{'text': None}, {'text': '<skill name="how">'}]},
                             {'role': 'assistant', 'content': [{'type': 'toolCall', 'name': 'read', 'arguments': []}]}])
            with path.open('a') as stream:
                stream.write('null\n[]\n{"message":5}\n{broken\n')
            with self.assertWarnsRegex(UserWarning, 'read session'):
                self.assertEqual(inventory.newest_prompt(root, root)['section_chars'], {'one': 3})
            with self.assertWarnsRegex(UserWarning, 'read session'):
                self.assertEqual(inventory.scan_usage([path])['skills']['how']['explicit'], 1)

    def test_skill_directory_cycles_are_pruned(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            skill = root / 'how'
            skill.mkdir()
            (skill / 'SKILL.md').write_text('---\nname: how\ndescription: Explain code\n---\n')
            (skill / 'cycle').symlink_to(root, target_is_directory=True)
            scans = []
            original = inventory.os.scandir

            def bounded(path):
                scans.append(path)
                if len(scans) > 5:
                    raise AssertionError('followed a directory cycle')
                return original(path)

            with patch.object(inventory.os, 'scandir', bounded):
                result = inventory.scan_skills([root])
            self.assertEqual([item['name'] for item in result], ['how'])


if __name__ == '__main__':
    unittest.main()
