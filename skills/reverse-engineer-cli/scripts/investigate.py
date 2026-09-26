#!/usr/bin/env python3
"""Initialize an evidence workspace or replay its reviewed case corpus. Python 3.10+."""
from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import platform
import re
import shutil
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

DIRECTORIES = (
    'target', 'raw/help', 'raw/versions', 'raw/metadata', 'probes', 'source',
    'traces/process', 'traces/filesystem', 'traces/network', 'traces/runtime',
    'binary/metadata', 'binary/strings', 'binary/functions', 'binary/decompiler',
    'hypotheses', 'repro/fixtures', 'repro/scripts', 'report',
)


def digest(path: Path) -> str:
    h = hashlib.sha256()
    with path.open('rb') as f:
        for block in iter(lambda: f.read(1024 * 1024), b''):
            h.update(block)
    return h.hexdigest()


def write_json(path: Path, value: object) -> None:
    with path.open('x') as f:
        json.dump(value, f, indent=2, ensure_ascii=False)
        f.write('\n')


def artifact(path: str, copy_to: Path, index: int) -> dict:
    original = Path(path).absolute()
    resolved = original.resolve(strict=True)
    value = {'path': str(original), 'resolved_path': str(resolved),
             'sha256': digest(resolved), 'size': resolved.stat().st_size}
    destination = copy_to / f'{index:03d}-{resolved.name}'
    shutil.copyfile(resolved, destination)
    value['copy'] = str(destination)
    return value


def init(a: argparse.Namespace) -> int:
    if not a.target and not a.repository:
        raise ValueError('provide --target or --repository')
    root = Path(a.workspace).resolve()
    if root.exists():
        raise ValueError('workspace exists; use a new directory to preserve evidence')
    repository = Path(a.repository).resolve(strict=True) if a.repository else None
    target = None
    if a.target:
        target = shutil.which(a.target)
        if not target:
            raise ValueError('target is not executable or was not found; provide its executable path')
        target = str(Path(target).absolute())
    # Resolve inputs before creating a workspace; never launch the target here.
    paths = ([target] if target else []) + a.artifact
    for path in paths:
        if not Path(path).is_file():
            raise ValueError(f'artifact is not a file: {path}')
    repo = None
    repo_outputs = {}
    if repository:
        repo = {'path': str(repository)}
        for key, args in [('commit', ['rev-parse', 'HEAD']),
                          ('dirty_state', ['status', '--porcelain']),
                          ('describe', ['describe', '--tags', '--always'])]:
            result = subprocess.run(['git', '-C', str(repository), *args],
                                    capture_output=True, timeout=30)
            repo_outputs[f'git-{key}.stdout'] = result.stdout
            repo_outputs[f'git-{key}.stderr'] = result.stderr
            repo[key] = result.stdout.decode('utf-8', 'backslashreplace').strip() if result.returncode == 0 else None
            repo[f'{key}_exit_code'] = result.returncode
    for directory in DIRECTORIES:
        (root / directory).mkdir(parents=True, exist_ok=True)
    for filename, data in repo_outputs.items():
        (root / 'raw/metadata' / filename).write_bytes(data)
    artifacts = [artifact(path, root / 'target', i) for i, path in enumerate(paths)]
    identity = {
        'schema_version': 1, 'analysis_timestamp': datetime.now(timezone.utc).isoformat(),
        'target_path': target, 'resolved_target_path': artifacts[0]['resolved_path'] if target else None,
        'sha256': artifacts[0]['sha256'] if target else None,
        'file_size': artifacts[0]['size'] if target else None,
        'platform': platform.platform(), 'host_architecture': platform.machine(),
        'architecture': None, 'reported_version': None, 'runtime_version': None,
        'package_manager_metadata': None, 'launcher_chain': [], 'repository': repo,
        'version_correspondence': 'UNKNOWN', 'artifacts': artifacts,
        'unresolved': ['target architecture, version, runtime, package metadata and launcher chain require investigation'],
    }
    write_json(root / 'target/identity.json', identity)
    (root / 'target/hashes.txt').write_text(''.join(f"{item['sha256']}  {item['path']}\n" for item in artifacts))
    write_json(root / 'probes/cases.json', [])
    (root / 'probes/results.jsonl').touch()
    write_json(root / 'source/entrypoints.json', [])
    write_json(root / 'source/command-tree.json', {'command': None, 'options': [], 'arguments': [], 'subcommands': []})
    (root / 'source/symbols.jsonl').touch()
    (root / 'source/flow.md').write_text('# Execution flow\n\nNot investigated.\n')
    for name in ('open', 'resolved'):
        (root / 'hypotheses' / f'{name}.md').write_text(f'# {name.capitalize()} hypotheses\n')
    for name in ('behavior', 'architecture', 'evidence'):
        (root / 'report' / f'{name}.md').write_text(f'# {name.capitalize()}\n\nStatus: NOT INVESTIGATED\n')
    for name in ('probe.py', 'investigate.py'):
        shutil.copyfile(Path(__file__).with_name(name), root / 'repro/scripts' / name)
    launcher = root / 'repro/run-all'
    launcher.write_text(
        '#!/usr/bin/env python3\nfrom pathlib import Path\nimport subprocess\nimport sys\n'
        'root = Path(__file__).resolve().parents[1]\n'
        'raise SystemExit(subprocess.call([sys.executable, str(root / "repro/scripts/investigate.py"), '
        '"run", "--workspace", str(root)]))\n'
    )
    launcher.chmod(0o755)
    print(root)
    return 0


def validate_cases(cases: object) -> list[dict]:
    if not isinstance(cases, list) or not cases:
        raise ValueError('cases.json must be a nonempty list of reviewed cases')
    seen = set()
    supported = {'id', 'question', 'safe', 'args', 'env', 'seed', 'stdin_file', 'stdin_text',
                 'tty', 'stdin_mode', 'timeout', 'send_signal', 'after', 'expect'}
    assertions = {'exit_code', 'signal', 'stdout_sha256', 'stderr_sha256', 'timed_out'}
    for case in cases:
        if not isinstance(case, dict) or set(case) - supported:
            raise ValueError('invalid case or unsupported field')
        case_id = case.get('id', '')
        if not isinstance(case_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', case_id) or case_id in seen:
            raise ValueError('case IDs must be unique safe file components')
        seen.add(case_id)
        if case.get('safe') is not True or not isinstance(case.get('question'), str) or not case['question'].strip():
            raise ValueError(f'{case_id}: require a question and safe=true after reviewing effects')
        if not isinstance(case.get('args'), list) or not all(isinstance(x, str) and '\0' not in x for x in case['args']):
            raise ValueError(f'{case_id}: args must be an array of strings')
        env = case.get('env', {})
        if not isinstance(env, dict) or not all(isinstance(k, str) and k and '=' not in k and '\0' not in k and
                                                (v is None or isinstance(v, str) and '\0' not in v) for k, v in env.items()):
            raise ValueError(f'{case_id}: invalid environment')
        if set(env) & {'HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'TMPDIR'}:
            raise ValueError(f'{case_id}: use seeds for isolated home/config/temp paths')
        expected = case.get('expect', {})
        if not isinstance(expected, dict) or set(expected) - assertions:
            raise ValueError(f'{case_id}: unsupported assertion; add a target-specific check')
        if 'stdin_file' in case and 'stdin_text' in case:
            raise ValueError(f'{case_id}: choose one stdin input')
        for field in ('stdin_file', 'stdin_text', 'send_signal'):
            if field in case and (not isinstance(case[field], str) or '\0' in case[field]):
                raise ValueError(f'{case_id}: {field} must be a string without NUL bytes')
        timeout, after = case.get('timeout', 30), case.get('after', 0.1)
        if any(isinstance(v, bool) or not isinstance(v, (int, float)) or not math.isfinite(v) for v in (timeout, after)):
            raise ValueError(f'{case_id}: invalid timing')
        if timeout <= 0 or after < 0 or ('send_signal' in case and after >= timeout):
            raise ValueError(f'{case_id}: require positive timeout and signal delay below timeout')
        if case.get('stdin_mode', 'null') not in {'pipe', 'null', 'closed', 'tty'}:
            raise ValueError(f'{case_id}: unsupported stdin mode')
        if case.get('tty', 'none') not in {'none', 'stdout', 'stderr', 'both'}:
            raise ValueError(f'{case_id}: unsupported TTY mode')
        if not isinstance(case.get('seed', []), list) or not all(isinstance(s, str) for s in case.get('seed', [])):
            raise ValueError(f'{case_id}: seed must be an array of strings')
    return cases


def run(a: argparse.Namespace) -> int:
    root = Path(a.workspace).resolve()
    identity = json.loads((root / 'target/identity.json').read_text())
    if not identity.get('target_path'):
        raise ValueError('source-only investigation: register an isolated build as a new target workspace before replay')
    if not identity.get('artifacts') or identity['artifacts'][0]['path'] != identity['target_path']:
        raise ValueError('target must be the first hashed artifact')
    for item in identity['artifacts']:
        if str(Path(item['path']).resolve()) != item['resolved_path'] or digest(Path(item['path'])) != item['sha256']:
            raise ValueError(f"artifact identity changed: {item['path']}")
        if item.get('copy') and digest(Path(item['copy'])) != item['sha256']:
            raise ValueError(f"evidence copy changed: {item['copy']}")
    cases = validate_cases(json.loads((root / 'probes/cases.json').read_text()))
    run_id = f"R-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:8]}"
    out = root / 'probes/runs' / run_id
    out.mkdir(parents=True)
    write_json(out / 'cases.json', cases)
    write_json(out / 'identity.json', identity)
    failures, unchecked = [], []
    for case in cases:
        command = [sys.executable, str(root / 'repro/scripts/probe.py'), '--out', str(out),
                   '--id', case['id'], '--label', case['question'], '--isolate', '--clean-env',
                   '--timeout', str(case.get('timeout', 30)), '--after', str(case.get('after', 0.1))]
        for key, value in case.get('env', {}).items():
            command += ['--unset', key] if value is None else ['--env', f'{key}={value}']
        for seed in case.get('seed', []):
            command += ['--seed', seed]
        for key in ('stdin_file', 'stdin_text', 'stdin_mode', 'tty', 'send_signal'):
            if key in case:
                command += ['--' + key.replace('_', '-'), str(case[key])]
        command += ['--', identity['target_path'], *case['args']]
        result = subprocess.run(command, cwd=root, capture_output=True)
        (out / f"{case['id']}.runner.stdout").write_bytes(result.stdout)
        (out / f"{case['id']}.runner.stderr").write_bytes(result.stderr)
        if result.returncode:
            failures.append({'case': case['id'], 'reason': 'probe runner failed', 'exit_code': result.returncode})
            continue
        record = json.loads((out / 'probes.jsonl').read_text().splitlines()[-1])
        record['corpus_run'] = run_id
        actual = {k: record[k] for k in ('exit_code', 'signal', 'timed_out')}
        actual.update({f'{s}_sha256': record[s]['sha256'] for s in ('stdout', 'stderr')})
        expected = case.get('expect', {})
        if not expected:
            unchecked.append(case['id'])
        mismatches = {key: {'expected': value, 'actual': actual[key]} for key, value in expected.items() if actual[key] != value}
        if record['launch_error'] or not record['capture_complete'] or record['descendants_hold_output']:
            mismatches['execution'] = 'launch failure, incomplete capture, or descendant-held output'
        if record['timed_out'] and expected.get('timed_out') is not True:
            mismatches['timeout'] = 'unexpected timeout'
        if mismatches:
            failures.append({'case': case['id'], 'mismatches': mismatches})
        record['expectation_mismatches'] = mismatches
        with (root / 'probes/results.jsonl').open('a') as stream:
            stream.write(json.dumps(record, ensure_ascii=False) + '\n')
    summary = {'run': run_id, 'cases': len(cases), 'failures': failures, 'unchecked_cases': unchecked,
               'status': 'FAIL' if failures else 'OBSERVATIONS_ONLY' if unchecked else 'PASS'}
    write_json(out / 'summary.json', summary)
    print(json.dumps(summary, indent=2))
    return 1 if failures else 3 if unchecked else 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='action', required=True)
    initialize = sub.add_parser('init')
    initialize.add_argument('--workspace', default='.re')
    initialize.add_argument('--target')
    initialize.add_argument('--repository')
    initialize.add_argument('--artifact', action='append', default=[])
    replay = sub.add_parser('run')
    replay.add_argument('--workspace', default='.re')
    args = parser.parse_args()
    try:
        return init(args) if args.action == 'init' else run(args)
    except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
        print(f'investigate: {exc}', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
