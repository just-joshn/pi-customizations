import json, re, time
from mitmproxy import http
OUT = '/tmp/xaudit/mitm/flows.jsonl'
EARLY = '/tmp/xaudit/mitm/early.jsonl'
JWT = re.compile(r'eyJ[\w-]{5,}\.[\w-]{5,}\.[\w-]{5,}')
REDACTED_HEADERS = {'authorization', 'proxy-authorization', 'cookie', 'set-cookie', 'x-api-key', 'x-email', 'x-userid', 'x-teamid', 'x-grok-user-id', 'x-blob-encryption-key'}
SECRET_KEY = r'[\w-]*(?:token|secret|key|password|verifier|session|code|auth)[\w-]*'

def red(name, value):
    lower = name.lower()
    if lower in ('authorization', 'proxy-authorization') and ' ' in value:
        return f"{value.split(' ', 1)[0]} <redacted len={len(value)}>"
    if lower in REDACTED_HEADERS:
        return f'<redacted len={len(value)}>'
    return JWT.sub('<JWT>', value)

def url(request):
    base, _, query = request.pretty_url.partition('?')
    return base + ('?' + '&'.join(part.split('=', 1)[0] + '=<redacted>' for part in query.split('&')) if query else '')

def headers(m):
    return [[k, red(k, v)] for k, v in m.headers.items(multi=True)]

def body(m):
    raw = m.get_content(strict=False) or b''
    ct = m.headers.get('content-type', '')
    if 'json' in ct or 'x-www-form' in ct or (raw[:1] in (b'{', b'[')):
        t = JWT.sub('<JWT>', raw.decode('utf8', 'replace'))
        t = re.sub(r'(?i)("' + SECRET_KEY + r'"\s*:\s*")[^"]*', r'\1<redacted>', t)
        t = re.sub(r'(?i)((?:^|&)' + SECRET_KEY + r'=)[^&]*', r'\1<redacted>', t)
        return t[:200000]
    return {'bytes': len(raw), 'head_hex': raw[:64].hex()}

def append(path, record):
    with open(path, 'a') as f:
        f.write(json.dumps(record) + '\n')

def request_record(flow, phase):
    return {'t': time.time(), 'phase': phase, 'method': flow.request.method, 'url': url(flow.request), 'http_version': flow.request.http_version, 'req_headers': headers(flow.request)}

def is_agent_stream(flow):
    return 'agent.v1' in flow.request.path

def response(flow: http.HTTPFlow):
    streamed = 'event-stream' in flow.response.headers.get('content-type', '')
    append(OUT, {**request_record(flow, 'response'), 'req_body': body(flow.request), 'status': flow.response.status_code,
                 'resp_headers': headers(flow.response), 'resp_body': 'sse' if streamed else body(flow.response)})

def requestheaders(flow: http.HTTPFlow):
    if is_agent_stream(flow):
        append(EARLY, request_record(flow, 'requestheaders'))
        flow.request.stream = True

def responseheaders(flow: http.HTTPFlow):
    if is_agent_stream(flow):
        flow.response.stream = True
        append(EARLY, {**request_record(flow, 'responseheaders'), 'status': flow.response.status_code, 'resp_headers': headers(flow.response)})
