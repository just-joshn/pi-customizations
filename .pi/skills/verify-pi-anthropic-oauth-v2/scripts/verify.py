#!/usr/bin/env python3
"""Drive the checkout's extension through real Pi; never import extension internals."""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import pty
import re
import select
import shutil
import struct
import subprocess
import sys
import tempfile
import termios
import time

ROOT = Path(__file__).resolve().parents[4]
EXTENSION = ROOT / 'extensions/pi-anthropic-oauth-v2/src/index.ts'
AUDIT = Path(__file__).with_name('network-audit.cjs')
MODEL = 'custom-anthropic/claude-sonnet-4-6'
FAKE_API_KEY = 'sk-ant-api03-VERIFY-FAKE'
PROMPT = 'Reply with exactly OAUTH_VERIFY_OK; do not call tools.'
ANSI = re.compile(r'\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b\[[0-?]*[ -/]*[@-~]')


def save(path, value):
    path.write_text(json.dumps(value, indent=2) + '\n')


def sources():
    return {str(p.relative_to(ROOT)): hashlib.sha256(p.read_bytes()).hexdigest()
            for p in sorted(EXTENSION.parent.rglob('*.ts'))}


def environment(state, evidence, fake_api_key):
    key = {'CUSTOM_ANTHROPIC_API_KEY': FAKE_API_KEY} if fake_api_key else {}
    return {**key, 'PATH': os.environ['PATH'], 'HOME': str(state / 'home'),
            'TMPDIR': str(state), 'TERM': 'xterm-256color', 'COLORTERM': 'truecolor',
            'PI_CODING_AGENT_DIR': str(state / 'agent'), 'PI_OFFLINE': '1',
            'PI_SKIP_VERSION_CHECK': '1', 'PI_TELEMETRY': '0',
            'NODE_OPTIONS': f'--require="{AUDIT}"',
            'VERIFY_NETWORK_LOG': str(evidence / 'network.jsonl')}


def command(pi):
    return [pi, '--no-extensions', '--extension', str(EXTENSION), '--no-skills',
            '--no-prompt-templates', '--no-context-files', '--no-themes', '--no-mcp',
            '--no-approve', '--no-session', '--no-tools', '--model', MODEL]


def doctor(manifest, state):
    assert manifest['sources'] == sources(), 'Source changed; start a new evidence run'
    assert state.is_dir() and (state / 'agent').is_dir(), 'Scratch state missing'
    assert Path(manifest['pi']).is_file(), 'Pi executable missing'
    version = subprocess.run([manifest['pi'], '--version'], capture_output=True,
                             text=True, timeout=10, check=True).stdout.strip()
    assert version == manifest['version'] == '1.5.2', f'Unverified Pi version: {version}'
    print(json.dumps({'status': 'ready', 'version': version, 'pi': manifest['pi'],
                      'profile': str(state / 'agent'), 'model': MODEL,
                      'source_files': len(manifest['sources'])}))


def drive(args, cmd, state, evidence, env):
    master, slave = pty.openpty()
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 140, 0, 0))
    proc = None
    transcript = bytearray()
    events = []
    raw = evidence / 'terminal.raw'
    text = evidence / 'terminal.txt'
    assert not raw.exists(), 'Use fresh evidence for each PTY journey'

    def wait_for(expected, start):
        deadline = time.monotonic() + 30
        while time.monotonic() < deadline:
            if select.select([master], [], [], 0.1)[0]:
                try:
                    chunk = os.read(master, 65536)
                except OSError:
                    break
                if not chunk:
                    break
                transcript.extend(chunk)
                raw.write_bytes(transcript)
                clean = ANSI.sub('', transcript.decode(errors='replace')).replace('\r', '')
                text.write_text(clean)
                if expected in ANSI.sub('', transcript[start:].decode(errors='replace')):
                    events.append({'observed': expected, 'at': time.time()})
                    return
            if proc.poll() is not None:
                break
        raise RuntimeError(f'Terminal did not show {expected!r}; inspect {text}')

    try:
        proc = subprocess.Popen(cmd + ['--tui-mode', 'regular'], cwd=state / 'work',
                                env=env, stdin=slave, stdout=slave, stderr=slave)
        os.close(slave)
        slave = None
        events.append({'argv': cmd, 'pid': proc.pid, 'feature': args.feature})
        wait_for('Press ctrl+o to show full startup help and loaded resources.', 0)
        (evidence / 'before.txt').write_text(text.read_text())
        for action, expected in args.step:
            start = len(transcript)
            events.append({'send': action, 'key': 'Enter', 'at': time.time()})
            os.write(master, action.encode() + b'\r')
            wait_for(expected, start)
        save(evidence / 'drive-result.json', {'status': 'passed', 'feature': args.feature})
    finally:
        if proc is not None:
            if proc.poll() is None:
                proc.terminate()
                try:
                    proc.wait(timeout=5)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait()
            events.append({'teardown_exit': proc.returncode})
        if slave is not None:
            os.close(slave)
        os.close(master)
        save(evidence / 'actions.json', events)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['init', 'doctor', 'drive', 'print', 'list-models', 'run', 'cleanup'])
    parser.add_argument('evidence', type=Path)
    parser.add_argument('--feature', default='smoke')
    parser.add_argument('--fake-api-key', action='store_true',
                        help=f'Set CUSTOM_ANTHROPIC_API_KEY to the invalid {FAKE_API_KEY}')
    parser.add_argument('--step', nargs=2, action='append', default=[], metavar=('TEXT', 'EXPECT'))
    parser.add_argument('--message', default=PROMPT)
    args = parser.parse_args()
    evidence = args.evidence.resolve()
    manifest_path = evidence / 'run.json'
    if args.mode == 'init':
        evidence.mkdir(parents=True, exist_ok=False)
        pi = shutil.which('pi')
        assert pi, 'Install Pi 1.5.2 and put pi on PATH'
        version = subprocess.run([pi, '--version'], capture_output=True, text=True,
                                 timeout=10, check=True).stdout.strip()
        assert version == '1.5.2', f'Expected Pi 1.5.2, got {version}'
        state = Path(tempfile.mkdtemp(prefix='verify-pi-anthropic-'))
        for name in ['home', 'agent', 'work']:
            (state / name).mkdir()
        save(manifest_path, {'state': str(state), 'pi': pi, 'version': version,
                             'sources': sources(), 'model': MODEL})
        print(manifest_path)
        return
    manifest = json.loads(manifest_path.read_text())
    state = Path(manifest['state'])
    if args.mode == 'cleanup':
        assert state.name.startswith('verify-pi-anthropic-'), 'Not a verification scratch directory'
        if state.exists():
            shutil.rmtree(state)
        save(evidence / 'cleanup.json', {'scratch_removed': not state.exists(),
                                       'evidence_preserved': str(evidence)})
        print(f'Scratch removed; evidence retained at {evidence}')
        return
    doctor(manifest, state)
    if args.mode == 'doctor':
        return
    env = environment(state, evidence, args.fake_api_key)
    cmd = command(manifest['pi'])
    if args.mode == 'drive':
        assert args.step, 'Supply at least one --step TEXT EXPECT'
        drive(args, cmd, state, evidence, env)
    elif args.mode in ('print', 'list-models'):
        out = evidence / f'{args.mode}.json'
        assert not out.exists(), f'Use fresh evidence for another {args.mode} journey'
        argv = cmd + ['-p', args.message] if args.mode == 'print' else cmd + ['--list-models', 'custom-anthropic']
        result = subprocess.run(argv, cwd=state / 'work', env=env,
                                capture_output=True, text=True, timeout=45)
        save(out, {'feature': args.feature, 'argv': argv, 'fake_api_key': args.fake_api_key,
                   'stdout': result.stdout, 'stderr': result.stderr,
                   'exit_code': result.returncode})
        print(result.stdout + result.stderr, end='')
        print(f'exit={result.returncode}')
    elif args.mode == 'run':
        sys.exit(subprocess.call(cmd, cwd=state / 'work', env=env))


if __name__ == '__main__':
    main()
