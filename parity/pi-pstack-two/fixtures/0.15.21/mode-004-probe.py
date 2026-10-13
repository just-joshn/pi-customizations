#!/usr/bin/env python3
"""Authorized public Cursor UI probe; no settings or ledger writes."""
import importlib.util
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[4]
spec = importlib.util.spec_from_file_location('capture', ROOT / 'parity/scripts/capture-mode-sticky-agents-window.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)
OUT = Path(__file__).parent / 'mode-004-agents-window'
OUT.mkdir(exist_ok=True)
h = module.Helper()
try:
    for index, action in enumerate(sys.argv[1:]):
        with (OUT / 'commands.jsonl').open('a') as f:
            f.write(json.dumps({'time': time.time(), 'action': action}) + '\n')
        if action.startswith('click:'):
            x, y = map(float, action[6:].split(','))
            h.tool('get_app_state', app='Cursor')
            h.tool('click', app='Cursor', x=x, y=y)
        elif action.startswith('key:'):
            h.key(action[4:])
        elif action.startswith('type:'):
            h.type(action[5:])
        elif action.startswith('wait:'):
            time.sleep(float(action[5:]))
        elif action.startswith('shot:'):
            name = action[5:]
            state = h.tool('get_app_state', app='Cursor')
            text = [part for part in state.get('result', {}).get('content', []) if part.get('type') != 'image']
            (OUT / (name + '.json')).write_text(json.dumps(text, indent=2) + '\n')
            import base64
            for part in state.get('result', {}).get('content', []):
                if part.get('type') == 'image':
                    (OUT / (name + '.png')).write_bytes(base64.b64decode(part['data']))
            print(json.dumps(text))
        else:
            raise ValueError(action)
finally:
    h.close()
