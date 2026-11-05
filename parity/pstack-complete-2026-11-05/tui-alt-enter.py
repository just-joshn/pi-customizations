#!/usr/bin/env python3
"""Drives interactive Pi in a pseudo-terminal: types `/how find the parser`, presses Alt+Enter, and checks that the
chat entered the `how` mode (a pstack-mode entry in the session file and the footer badge), then that a plain
Alt+Enter on ordinary text still queues a message the Pi way. Usage: tui-alt-enter.py <pi-pstack-dir> <receipt-file>"""
import json, os, pty, select, shutil, subprocess, sys, tempfile, time

pkg, receipt = sys.argv[1], sys.argv[2]
root = tempfile.mkdtemp(prefix='pstack-tui-')
agent, work = os.path.join(root, 'agent'), os.path.join(root, 'work')
os.makedirs(agent); os.makedirs(work)
with open(os.path.join(agent, 'settings.json'), 'w') as f:
    json.dump({'packages': [pkg], 'extensions': [os.path.join(pkg, 'test/fixtures/scripted-model.ts')], 'quietStartup': True, 'defaultProvider': 'scripted', 'defaultModel': 'echo'}, f)
env = {**os.environ, 'HOME': root, 'PI_CODING_AGENT_DIR': agent, 'PI_OFFLINE': '1', 'PI_SKIP_VERSION_CHECK': '1', 'TERM': 'xterm-256color', 'COLUMNS': '160', 'LINES': '48', 'PSTACK_CLOUD_DRIVER': 'worktree'}
cli = os.path.join(pkg, 'node_modules/@earendil-works/pi-coding-agent/dist/bundle/cli.js')
pid, fd = pty.fork()
if pid == 0:
    os.chdir(work)
    os.execvpe('node', ['node', cli, '--offline'], env)
screen = b''
def pump(seconds):
    global screen
    end = time.time() + seconds
    while time.time() < end:
        ready, _, _ = select.select([fd], [], [], 0.1)
        if ready:
            try:
                screen += os.read(fd, 65536)
            except OSError:
                return
def send(data, pause=0.05):
    for ch in data:
        os.write(fd, ch.encode()); time.sleep(pause)
pump(6)
send('/how find the parser')
pump(1)
os.write(fd, b'\x1b\r')
pump(4)
sessions = os.path.join(agent, 'sessions')
entries = []
for dirpath, _, files in os.walk(sessions):
    for name in files:
        if name.endswith('.jsonl'):
            with open(os.path.join(dirpath, name)) as f:
                entries += [json.loads(line) for line in f if line.strip()]
mode_entries = [e for e in entries if e.get('type') == 'custom' and e.get('customType') == 'pstack/mode']
user_texts = [json.dumps(e['message'].get('content')) for e in entries if e.get('type') == 'message' and e['message'].get('role') == 'user']
text = screen.decode('utf8', 'replace')
ok_mode = any((e.get('data') or {}).get('skill') == 'how' for e in mode_entries)
ok_task = any('find the parser' in t for t in user_texts)
ok_badge = 'how' in text and 'mode' in text
os.kill(pid, 9)
shutil.rmtree(root, ignore_errors=True)
result = {'modeEntry': ok_mode, 'taskSent': ok_task, 'badgeShown': ok_badge, 'modeEntries': mode_entries, 'userMessages': user_texts[:3]}
with open(receipt, 'w') as f:
    json.dump(result, f, indent=2)
print(json.dumps({k: result[k] for k in ('modeEntry', 'taskSent', 'badgeShown')}))
sys.exit(0 if ok_mode and ok_task else 1)
