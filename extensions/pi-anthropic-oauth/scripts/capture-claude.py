import json
import os
import shutil
import subprocess
import tempfile
from http.server import BaseHTTPRequestHandler, HTTPServer
from threading import Thread

PROMPT = 'Reply LOCAL_OK.'
MODEL = 'claude-sonnet-4-6'
SYNTHETIC_TOKEN = 'sk-ant-oat01-local-parity-synthetic'
TIMEOUT_SECONDS = 45
IDENTITY_HEADERS = ('user-agent', 'x-app', 'anthropic-version', 'anthropic-beta')


class Gateway(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def do_GET(self):
        self.send_response(200)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        self.wfile.write(b'{}')

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers.get('Content-Length', 0))) or b'{}')
        if '/messages' not in self.path:
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.end_headers()
            self.wfile.write(b'{}')
            return
        system = body.get('system', [])
        report = {
            'prompt': PROMPT,
            'model': body['model'],
            'headers': {name: self.headers.get(name) for name in IDENTITY_HEADERS},
            'billing': system[0].get('text') if system else None,
            'preamble': system[1].get('text') if len(system) > 1 else None,
            'systemCache': [block['cache_control'] for block in system if 'cache_control' in block],
            'thinking': body.get('thinking'),
            'output_config': body.get('output_config'),
            'max_tokens': body.get('max_tokens'),
        }
        print(json.dumps(report, indent=2), flush=True)
        self.send_response(200)
        self.send_header('Content-Type', 'text/event-stream')
        self.end_headers()
        events = [
            ('message_start', {'type': 'message_start', 'message': {'id': 'msg_local_probe', 'type': 'message', 'role': 'assistant', 'model': body['model'], 'content': [], 'stop_reason': None, 'stop_sequence': None, 'usage': {'input_tokens': 10, 'output_tokens': 0}}}),
            ('content_block_start', {'type': 'content_block_start', 'index': 0, 'content_block': {'type': 'text', 'text': ''}}),
            ('content_block_delta', {'type': 'content_block_delta', 'index': 0, 'delta': {'type': 'text_delta', 'text': 'LOCAL_OK'}}),
            ('content_block_stop', {'type': 'content_block_stop', 'index': 0}),
            ('message_delta', {'type': 'message_delta', 'delta': {'stop_reason': 'end_turn', 'stop_sequence': None}, 'usage': {'output_tokens': 2}}),
            ('message_stop', {'type': 'message_stop'}),
        ]
        self.wfile.write(''.join(f'event: {name}\ndata: {json.dumps(data)}\n\n' for name, data in events).encode())


def capture():
    binary = shutil.which(os.environ.get('CLAUDE_BIN', 'claude'))
    if not binary:
        raise RuntimeError('Claude Code is not installed. Set CLAUDE_BIN to its executable.')
    server = HTTPServer(('127.0.0.1', 0), Gateway)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        with tempfile.TemporaryDirectory(prefix='claude-parity-') as home:
            inherited = {key: value for key, value in os.environ.items() if not any(part in key for part in ('ANTHROPIC', 'CLAUDE', 'PI_', 'TOKEN', 'API_KEY'))}
            env = {**inherited, 'HOME': home, 'CLAUDE_CONFIG_DIR': home, 'ANTHROPIC_BASE_URL': f'http://127.0.0.1:{server.server_port}', 'CLAUDE_CODE_OAUTH_TOKEN': SYNTHETIC_TOKEN, 'CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC': '1', 'DISABLE_AUTOUPDATER': '1'}
            result = subprocess.run([binary, '--safe-mode', '--setting-sources', '', '--strict-mcp-config', '--no-session-persistence', '--model', MODEL, '--effort', 'medium', '--tools', '', '-p', PROMPT], cwd=home, env=env, text=True, capture_output=True, timeout=TIMEOUT_SECONDS)
            if result.returncode != 0 or result.stdout.strip() != 'LOCAL_OK':
                raise RuntimeError('Claude Code did not finish the local synthetic request.')
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


if __name__ == '__main__':
    capture()
