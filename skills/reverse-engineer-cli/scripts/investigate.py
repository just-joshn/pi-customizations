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
import signal
import subprocess
import sys
import uuid
from datetime import datetime, timezone
from pathlib import Path

GIT_QUERY_TIMEOUT_SECONDS = 30
SIGNAL_NAMES = frozenset(member.name for member in signal.Signals)

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
    return {**value, 'copy': str(destination)}


def initialization_inputs(a: argparse.Namespace):
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
    paths = ([target] if target else []) + a.artifact
    for path in paths:
        if not Path(path).is_file():
            raise ValueError(f'artifact is not a file: {path}')
    return root, repository, target, paths


def repository_metadata(repository: Path | None):
    if repository is None:
        return None, {}
    queries = [('commit', ['rev-parse', 'HEAD']), ('dirty_state', ['status', '--porcelain']),
               ('describe', ['describe', '--tags', '--always'])]
    results = {key: subprocess.run(['git', '-C', str(repository), *args], capture_output=True, timeout=GIT_QUERY_TIMEOUT_SECONDS)
               for key, args in queries}
    metadata = {'path': str(repository),
                **{key: value.stdout.decode('utf-8', 'backslashreplace').strip() if value.returncode == 0 else None
                   for key, value in results.items()},
                **{f'{key}_exit_code': value.returncode for key, value in results.items()}}
    outputs = {f'git-{key}.{stream}': getattr(value, stream)
               for key, value in results.items() for stream in ('stdout', 'stderr')}
    return metadata, outputs


def initial_identity(target: str | None, artifacts: list[dict], repo: dict | None) -> dict:
    return {
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


def initialize_workspace_files(root: Path) -> None:
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


def init(a: argparse.Namespace) -> int:
    root, repository, target, paths = initialization_inputs(a)
    repo, repo_outputs = repository_metadata(repository)
    for directory in DIRECTORIES:
        (root / directory).mkdir(parents=True, exist_ok=True)
    for filename, data in repo_outputs.items():
        (root / 'raw/metadata' / filename).write_bytes(data)
    artifacts = [artifact(path, root / 'target', index) for index, path in enumerate(paths)]
    write_json(root / 'target/identity.json', initial_identity(target, artifacts, repo))
    (root / 'target/hashes.txt').write_text(''.join(f"{item['sha256']}  {item['path']}\n" for item in artifacts))
    initialize_workspace_files(root)
    print(root)
    return 0


def signal_member(value: str):
    return signal.Signals.__members__.get('SIG' + value.upper().removeprefix('SIG'))


def finite_number(value: object) -> bool:
    try:
        return type(value) in (int, float) and math.isfinite(value)
    except OverflowError:
        return False


def valid_text(value: object) -> bool:
    return isinstance(value, str) and bool(value) and '\0' not in value


def validate_assertions(expected: object) -> None:
    if not isinstance(expected, dict):
        raise ValueError('expect must be an assertion object')
    validators = {
        'exit_code': lambda value: value is None or type(value) is int and value >= 0,
        'signal': lambda value: value is None or isinstance(value, str) and value in SIGNAL_NAMES,
        'timed_out': lambda value: type(value) is bool,
        'stdout_sha256': lambda value: isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value),
        'stderr_sha256': lambda value: isinstance(value, str) and re.fullmatch('[a-f0-9]{64}', value),
    }
    if any(key not in validators or not validators[key](value) for key, value in expected.items()):
        raise ValueError('unsupported assertion or invalid assertion value')


def validate_case_controls(case: dict) -> None:
    if 'stdin_file' in case and 'stdin_text' in case:
        raise ValueError('choose one stdin input')
    for field in ('stdin_file', 'stdin_text', 'send_signal'):
        if field in case and (not isinstance(case[field], str) or '\0' in case[field]):
            raise ValueError(f'{field} must be a string without NUL bytes')
    timeout, after = case.get('timeout', 30), case.get('after', 0.1)
    if not all(finite_number(value) for value in (timeout, after)):
        raise ValueError('invalid timing')
    if timeout <= 0 or after < 0 or ('send_signal' in case and after >= timeout):
        raise ValueError('require positive timeout and signal delay below timeout')
    if 'send_signal' in case and signal_member(case['send_signal']) is None:
        raise ValueError('unknown signal')
    for key, default, choices in (('stdin_mode', 'null', ('pipe', 'null', 'closed', 'tty')),
                                  ('tty', 'none', ('none', 'stdout', 'stderr', 'both'))):
        if not isinstance(case.get(key, default), str) or case.get(key, default) not in choices:
            raise ValueError(f'unsupported {key}')
    if not isinstance(case.get('seed', []), list) or not all(valid_text(s) for s in case.get('seed', [])):
        raise ValueError('seed must be an array of nonempty strings without NUL bytes')


def validate_cases(cases: object) -> list[dict]:
    if not isinstance(cases, list) or not cases:
        raise ValueError('cases.json must be a nonempty list of reviewed cases')
    supported = {'id', 'question', 'safe', 'args', 'env', 'seed', 'stdin_file', 'stdin_text',
                 'tty', 'stdin_mode', 'timeout', 'send_signal', 'after', 'expect'}
    for case in cases:
        if not isinstance(case, dict) or set(case) - supported:
            raise ValueError('invalid case or unsupported field')
        case_id = case.get('id', '')
        if not isinstance(case_id, str) or not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', case_id):
            raise ValueError('case IDs must be unique safe file components')
        if case.get('safe') is not True or not valid_text(case.get('question')) or not case['question'].strip():
            raise ValueError(f'{case_id}: require a question and safe=true after reviewing effects')
        if not isinstance(case.get('args'), list) or not all(isinstance(x, str) and '\0' not in x for x in case['args']):
            raise ValueError(f'{case_id}: args must be an array of strings')
        env = case.get('env', {})
        if not isinstance(env, dict) or not all(isinstance(k, str) and k and '=' not in k and '\0' not in k and
                                                (v is None or isinstance(v, str) and '\0' not in v) for k, v in env.items()):
            raise ValueError(f'{case_id}: invalid environment')
        if set(env) & {'HOME', 'XDG_CONFIG_HOME', 'XDG_CACHE_HOME', 'XDG_DATA_HOME', 'XDG_STATE_HOME', 'TMPDIR'}:
            raise ValueError(f'{case_id}: use seeds for isolated home/config/temp paths')
        validate_assertions(case.get('expect', {}))
        validate_case_controls(case)
    if len({case['id'] for case in cases}) != len(cases):
        raise ValueError('case IDs must be unique safe file components')
    return cases


def validate_identity(identity: object) -> None:
    if not isinstance(identity, dict):
        raise ValueError('identity must be an object')
    if identity.get('target_path') is not None and not valid_text(identity['target_path']):
        raise ValueError('identity target_path must be a nonempty string or null')
    artifacts = identity.get('artifacts')
    if not isinstance(artifacts, list):
        raise ValueError('identity artifacts must be an array')
    for item in artifacts:
        if not isinstance(item, dict) or not all(valid_text(item.get(key)) for key in ('path', 'resolved_path', 'sha256')):
            raise ValueError('artifact requires path, resolved_path and sha256 strings')
        if not re.fullmatch('[a-f0-9]{64}', item['sha256']):
            raise ValueError('artifact sha256 must be a SHA-256 digest')
        if item.get('copy') is not None and not valid_text(item['copy']):
            raise ValueError('artifact copy must be a path or null')
        if 'size' in item and (type(item['size']) is not int or item['size'] < 0):
            raise ValueError('artifact size must be a nonnegative integer')


def verify_identity(identity: dict) -> None:
    validate_identity(identity)
    if not identity.get('target_path'):
        raise ValueError('source-only investigation: register an isolated build as a new target workspace before replay')
    if not identity.get('artifacts') or identity['artifacts'][0]['path'] != identity['target_path']:
        raise ValueError('target must be the first hashed artifact')
    for item in identity['artifacts']:
        if str(Path(item['path']).resolve()) != item['resolved_path'] or digest(Path(item['path'])) != item['sha256']:
            raise ValueError(f"artifact identity changed: {item['path']}")
        if item.get('copy') and digest(Path(item['copy'])) != item['sha256']:
            raise ValueError(f"evidence copy changed: {item['copy']}")


def case_command(root: Path, out: Path, case: dict, target: str) -> list[str]:
    options = [sys.executable, str(root / 'repro/scripts/probe.py'), '--out', str(out),
               '--id', case['id'], '--label', case['question'], '--isolate', '--clean-env',
               '--timeout', str(case.get('timeout', 30)), '--after', str(case.get('after', 0.1))]
    env = [part for key, value in case.get('env', {}).items()
           for part in (['--unset', key] if value is None else ['--env', f'{key}={value}'])]
    seeds = [part for seed in case.get('seed', []) for part in ('--seed', seed)]
    inputs = [part for key in ('stdin_file', 'stdin_text', 'stdin_mode', 'tty', 'send_signal') if key in case
              for part in ('--' + key.replace('_', '-'), str(case[key]))]
    return options + env + seeds + inputs + ['--', target, *case['args']]


def validate_stream_outcome(value: object, allowed: tuple[str, ...]) -> None:
    if not isinstance(value, dict) or set(value) != {'status', 'bytes', 'error'}:
        raise ValueError('stream outcome must contain status, bytes and error')
    if not isinstance(value['status'], str) or value['status'] not in allowed:
        raise ValueError('invalid stream outcome status')
    if type(value['bytes']) is not int or value['bytes'] < 0:
        raise ValueError('stream outcome bytes must be a nonnegative integer')
    error = value['error']
    if value['status'] == 'error':
        if not isinstance(error, dict) or set(error) != {'type', 'errno', 'message'}:
            raise ValueError('invalid stream error')
        if not valid_text(error['type']) or not isinstance(error['message'], str):
            raise ValueError('invalid stream error details')
        if error['errno'] is not None and type(error['errno']) is not int:
            raise ValueError('invalid stream error errno')
    elif error is not None:
        raise ValueError('only an error outcome may carry an error')
    if value['status'] == 'not_applicable' and value['bytes'] != 0:
        raise ValueError('unused stream cannot transfer bytes')


def outcomes_failed(record: dict) -> bool:
    outcomes = record.get('capture_outcomes', {})
    if 'capture_outcomes' in record:
        if not isinstance(outcomes, dict) or set(outcomes) != {'stdout', 'stderr', 'tty_echo'}:
            raise ValueError('capture outcomes must describe stdout, stderr and tty_echo')
        for name, outcome in outcomes.items():
            allowed = ('complete', 'error', 'cancelled') + (('not_applicable',) if name == 'tty_echo' else ())
            validate_stream_outcome(outcome, allowed)
    delivery = record.get('input_delivery')
    if 'input_delivery' in record:
        validate_stream_outcome(delivery, ('complete', 'closed', 'not_applicable', 'error', 'cancelled'))
    return any(item['status'] in ('error', 'cancelled') for item in outcomes.values()) or (
        delivery is not None and delivery['status'] in ('error', 'cancelled'))


def validate_observation(record: object, case_id: str) -> dict:
    if not isinstance(record, dict) or record.get('id') != case_id:
        raise ValueError('runner observation must be an object matching the case id')
    if any(key not in record for key in ('exit_code', 'signal', 'timed_out', 'stdout', 'stderr')):
        raise ValueError('runner observation is missing required fields')
    validate_assertions({key: record[key] for key in ('exit_code', 'signal', 'timed_out')})
    for name in ('stdout', 'stderr'):
        if not isinstance(record[name], dict):
            raise ValueError('runner stream must be an object')
        validate_assertions({name + '_sha256': record[name].get('sha256')})
    for name in ('capture_complete', 'descendants_hold_output'):
        if name in record and type(record[name]) is not bool:
            raise ValueError(f'{name} must be a boolean')
    if record.get('launch_error') is not None:
        validate_stream_outcome({'status': 'error', 'bytes': 0, 'error': record['launch_error']}, ('error',))
    outcomes_failed(record)
    return record


def expectation_mismatches(record: dict, expected: dict) -> dict:
    actual = {**{key: record[key] for key in ('exit_code', 'signal', 'timed_out')},
              **{f'{stream}_sha256': record[stream]['sha256'] for stream in ('stdout', 'stderr')}}
    differences = {key: {'expected': value, 'actual': actual[key]}
                   for key, value in expected.items() if actual[key] != value}
    incomplete = (record.get('launch_error') or not record.get('capture_complete', True)
                  or record.get('descendants_hold_output', False) or outcomes_failed(record))
    return {**differences,
            **({'execution': 'launch failure, incomplete capture, input error, or descendant-held output'} if incomplete else {}),
            **({'timeout': 'unexpected timeout'} if record['timed_out'] and expected.get('timed_out') is not True else {})}


def replay_case(root: Path, out: Path, run_id: str, case: dict, target: str):
    log = out / 'probes.jsonl'
    offset = log.stat().st_size if log.exists() else 0
    result = subprocess.run(case_command(root, out, case, target), cwd=root, capture_output=True)
    (out / f"{case['id']}.runner.stdout").write_bytes(result.stdout)
    (out / f"{case['id']}.runner.stderr").write_bytes(result.stderr)
    if result.returncode:
        return {'case': case['id'], 'reason': 'probe runner failed', 'exit_code': result.returncode}, None
    with log.open('rb') as stream:
        stream.seek(offset)
        lines = stream.read().splitlines()
    if len(lines) != 1:
        raise ValueError('runner must append exactly one observation')
    record = validate_observation(json.loads(lines[0]), case['id'])
    expected = case.get('expect', {})
    mismatches = expectation_mismatches(record, expected)
    completed = {**record, 'corpus_run': run_id, 'expectation_mismatches': mismatches}
    with (root / 'probes/results.jsonl').open('a') as stream:
        stream.write(json.dumps(completed, ensure_ascii=False) + '\n')
    return ({'case': case['id'], 'mismatches': mismatches} if mismatches else None,
            case['id'] if not expected else None)


def run(a: argparse.Namespace) -> int:
    root = Path(a.workspace).resolve()
    identity = json.loads((root / 'target/identity.json').read_text())
    verify_identity(identity)
    cases = validate_cases(json.loads((root / 'probes/cases.json').read_text()))
    run_id = f"R-{datetime.now(timezone.utc):%Y%m%dT%H%M%S}-{uuid.uuid4().hex[:8]}"
    out = root / 'probes/runs' / run_id
    out.mkdir(parents=True)
    write_json(out / 'cases.json', cases)
    write_json(out / 'identity.json', identity)
    outcomes = tuple(replay_case(root, out, run_id, case, identity['target_path']) for case in cases)
    failures = [failure for failure, _ in outcomes if failure]
    unchecked = [case_id for _, case_id in outcomes if case_id]
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
