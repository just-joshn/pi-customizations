import json, re, time
from mitmproxy import http
OUT = '/tmp/xaudit/mitm/flows.jsonl'
JWT = re.compile(r'eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}')
def red(v):
    v = JWT.sub('<JWT>', v)
    return re.sub(r'(?i)^(bearer\s+).*', r'\1<redacted len=%d>' % len(v), v)
def body(m):
    try:
        raw = m.get_content(strict=False) or b''
    except Exception as e:
        raw = m.raw_content or b''
    ct = m.headers.get('content-type','')
    if 'json' in ct or 'x-www-form' in ct or (raw[:1] in (b'{', b'[')):
        t = raw.decode('utf8','replace')
        t = JWT.sub('<JWT>', t)
        t = re.sub(r'("(?:access_token|refresh_token|id_token|accessToken|refreshToken|code|code_verifier|device_code)"\s*:\s*")[^"]*', r'\1<redacted>', t)
        t = re.sub(r'((?:refresh_token|code|code_verifier|device_code)=)[^&]*', r'\1<redacted>', t)
        return t[:200000]
    return {'bytes': len(raw), 'head_hex': raw[:64].hex()}
def response(flow: http.HTTPFlow):
    rec = {'t': time.time(), 'method': flow.request.method, 'url': flow.request.pretty_url, 'http_version': flow.request.http_version,
           'req_headers': [[k, red(v)] for k, v in flow.request.headers.items(multi=True)],
           'req_body': body(flow.request),
           'status': flow.response.status_code if flow.response else None,
           'resp_headers': [[k, red(v)] for k, v in flow.response.headers.items(multi=True)] if flow.response else None,
           'resp_body': body(flow.response) if flow.response and 'event-stream' not in flow.response.headers.get('content-type','') else 'sse'}
    with open(OUT, 'a') as f: f.write(json.dumps(rec) + '\n')

def requestheaders(flow: http.HTTPFlow):
    if 'cursor.sh' in flow.request.pretty_host and ('Agent' in flow.request.path or 'agent.v1' in flow.request.path):
        rec = {'t': time.time(), 'phase': 'requestheaders', 'method': flow.request.method, 'url': flow.request.pretty_url, 'http_version': flow.request.http_version,
               'req_headers': [[k, red(v)] for k, v in flow.request.headers.items(multi=True)]}
        with open('/tmp/xaudit/mitm/early.jsonl', 'a') as f: f.write(json.dumps(rec) + '\n')
    if 'agent.v1' in flow.request.path:
        flow.request.stream = True
def responseheaders(flow: http.HTTPFlow):
    if 'agent.v1' in flow.request.path:
        flow.response.stream = True
        with open('/tmp/xaudit/mitm/early.jsonl', 'a') as f: f.write(json.dumps({'phase':'responseheaders','url':flow.request.pretty_url,'status':flow.response.status_code,'resp_headers':[[k, red(v)] for k, v in flow.response.headers.items(multi=True)]}) + '\n')
