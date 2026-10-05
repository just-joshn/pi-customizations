import hashlib
import json
import subprocess
import sys
from pathlib import Path

repo = Path(sys.argv[1])
candidate = Path(sys.argv[2])
ref = '03ce27fe525e5f00acaaee6324cdad35c8c662b2'
roots = ['extensions/pi-pstack/upstream', 'extensions/pi-pstack/upstream-team-kit', 'extensions/pi-pstack/skills', 'extensions/pi-pstack/prompts']
paths = subprocess.check_output(['git', '-C', str(repo), 'ls-tree', '-r', '--name-only', ref, '--', *roots], text=True).splitlines()
expected = set(paths)
checked = []
failures = []
for path in paths:
    original = subprocess.check_output(['git', '-C', str(repo), 'show', f'{ref}:{path}'])
    target = candidate / path
    if not target.is_file():
        failures.append({'path': path, 'reason': 'missing'})
        continue
    actual = target.read_bytes()
    if original != actual:
        failures.append({'path': path, 'reason': 'byte drift', 'main_sha256': hashlib.sha256(original).hexdigest(), 'candidate_sha256': hashlib.sha256(actual).hexdigest()})
    checked.append(path)
for root in roots:
    for target in (candidate / root).rglob('*'):
        if not target.is_file() or 'node_modules' in target.parts or target.name == '.DS_Store':
            continue
        path = str(target.relative_to(candidate))
        if path not in expected:
            failures.append({'path': path, 'reason': 'extra source or generated file'})
sys.stdout.write(json.dumps({'main': ref, 'candidate': str(candidate), 'checked': len(checked), 'failures': failures}, indent=2) + '\n')
sys.exit(bool(failures))
