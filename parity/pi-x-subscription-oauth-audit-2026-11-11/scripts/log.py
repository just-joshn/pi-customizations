import json, re, time
from mitmproxy import http
OUT = '/tmp/xaudit/mitm/flows.jsonl'
JWT = re.compile(r'eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}')
IDENTITY = {'x-api-key', 'x-email', 'x-userid', 'x-teamid', 'x-grok-user-id', 'x-blob-encryption-key', 'cookie', 'set-cookie'}
SECRET_KEY = r'[\w-]*(?:token|secret|key|password|verifier|session|code|auth)[\w-]*'
def red(v, name=''):
    if name.lower() in IDENTITY:
        return '<redacted>'
    v = JWT.sub('<JWT>', v)
    return re.sub(r'(?i)^(bearer\s+).*', r'\1<redacted len=%d>' % len(v), v)
def url(request):
    base, _, query = request.pretty_url.partition('?')
    return base + ('?' + '&'.join(part.split('=', 1)[0] + '=<redacted>' for part in query.split('&')) if query else '')
def headers(m):
    return [[k, red(v, k)] for k, v in m.headers.items(multi=True)]
def body(m):
    raw = m.get_content(strict=False) or b''
    ct = m.headers.get('content-type','')
    if 'json' in ct or 'x-www-form' in ct or (raw[:1] in (b'{', b'[')):
        t = raw.decode('utf8','replace')
        t = JWT.sub('<JWT>', t)
        t = re.sub(r'(?i)("' + SECRET_KEY + r'"\s*:\s*")[^"]*', r'\1<redacted>', t)
        t = re.sub(r'(?i)((?:^|&)' + SECRET_KEY + r'=)[^&]*', r'\1<redacted>', t)
        return t[:200000]
    return {'bytes': len(raw), 'head_hex': raw[:64].hex()}
def response(flow: http.HTTPFlow):
    rec = {'t': time.time(), 'method': flow.request.method, 'url': url(flow.request), 'http_version': flow.request.http_version,
           'req_headers': headers(flow.request),
           'req_body': body(flow.request),
           'status': flow.response.status_code,
           'resp_headers': headers(flow.response),
           'resp_body': 'sse' if 'event-stream' in flow.response.headers.get('content-type', '') else body(flow.response)}
    with open(OUT, 'a') as f: f.write(json.dumps(rec) + '\n')

def requestheaders(flow: http.HTTPFlow):
    if 'cursor.sh' in flow.request.pretty_host and ('Agent' in flow.request.path or 'agent.v1' in flow.request.path):
        rec = {'t': time.time(), 'phase': 'requestheaders', 'method': flow.request.method, 'url': url(flow.request), 'http_version': flow.request.http_version,
               'req_headers': headers(flow.request)}
        with open('/tmp/xaudit/mitm/early.jsonl', 'a') as f: f.write(json.dumps(rec) + '\n')
    if 'agent.v1' in flow.request.path:
        flow.request.stream = True
def responseheaders(flow: http.HTTPFlow):
    if 'agent.v1' in flow.request.path:
        flow.response.stream = True
        with open('/tmp/xaudit/mitm/early.jsonl', 'a') as f: f.write(json.dumps({'phase':'responseheaders','url':flow.request.pretty_url,'status':flow.response.status_code,'resp_headers':headers(flow.response)}) + '\n')
