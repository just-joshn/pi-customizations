import hashlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
parity = root.parents[1]
out_path = parity / 'reviews' / 'host-continuation-import-audit.json'


def load(name):
    return json.loads((root / name).read_text())


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def span_text(path, start, end):
    return '\n'.join(path.read_bytes().decode('utf-8').split('\n')[start - 1:end])


catalogue = load('source-catalogue.json')
receipts = {r['source_id']: r for r in load('read-receipts.json')['receipts']}
graph = load('dependency-proposals.json')
prior = load('prior-mcp-proposals.json')
recovery = load('prior-source-recovery.json')
inputs = load('input-read-receipts.json')

covered_by_sha = {}
for source in catalogue:
    receipt = receipts.get(source['id'])
    lines = set()
    if receipt:
        for start, end in receipt['inclusive_ranges']:
            lines.update(range(start, end + 1))
    covered_by_sha[source['sha256']] = lines

sources = []
for source in catalogue:
    path = root / source['preserved_path']
    actual = sha(path)
    count = len(path.read_bytes().decode('utf-8').split('\n'))
    if path.read_bytes().endswith(b'\n'):
        count -= 1
    covered = covered_by_sha[source['sha256']]
    unread = sorted(set(range(1, count + 1)) - covered)
    ranges = []
    for n in unread:
        if ranges and ranges[-1][1] == n - 1:
            ranges[-1][1] = n
        else:
            ranges.append([n, n])
    retrieval_hash = source['retrieval'].get('bodySha256')
    sources.append({
        'id': source['id'],
        'path': source['preserved_path'],
        'sha256_recorded': source['sha256'],
        'sha256_actual': actual,
        'hash': 'match' if actual == source['sha256'] else 'mismatch',
        'retrieval_hash': 'not-recorded' if not retrieval_hash else ('match' if retrieval_hash == actual else 'mismatch'),
        'line_count_recorded': source['newline_delimited_line_count'],
        'line_count_actual': count,
        'line_count': 'match' if count == source['newline_delimited_line_count'] else 'mismatch',
        'read_status': 'unread' if not covered else ('read-complete' if not unread else 'read-partial'),
        'unread_ranges_by_receipt': ranges,
    })


def audit_edge(edge, path, receipt_lines_known):
    start, end = edge['line_span']
    actual = sha(path)
    body = span_text(path, start, end)
    covered = covered_by_sha.get(actual)
    if covered is None:
        read = 'unread-no-receipt-for-source'
    elif set(range(start, end + 1)) <= covered:
        read = 'span-within-receipted-read'
    else:
        read = 'span-outside-receipted-read'
    return {
        'edge_id': edge['id'],
        'source': str(path.relative_to(root)),
        'line_span': [start, end],
        'source_hash': 'match' if actual == edge['source_sha256'] else 'mismatch',
        'quote_span': 'match' if body == edge['verbatim_quote'] else 'mismatch',
        'read_status': read,
    }


edges = [audit_edge(e, root / e['source_file'], True) for e in graph['edges']]
prior_edges = [
    audit_edge(item['edge'], root / recovery[item['edge']['source_file']]['preserved_path'], True)
    for item in prior
]

input_receipts = []
for item in inputs:
    path = root / item['source_file']
    input_receipts.append({
        'source': item['source_file'],
        'hash': 'match' if sha(path) == item['source_sha256'] else 'mismatch',
        'receipt_complete': item['complete'],
    })


def tally(rows, key):
    result = {}
    for row in rows:
        result[row[key]] = result.get(row[key], 0) + 1
    return result


def quote_has(edge_id, needle):
    edge = next(e for e in graph['edges'] if e['id'] == edge_id)
    return needle in edge['verbatim_quote']


transport_edges = {
    'general-mcp': ('preserved/snapshot-mcp.md', [19, 25], 'Streamable HTTP'),
    'saved-cloud-mcp': ('preserved/docs_cloud-agent_capabilities.md', [37, 39], 'SSE and `mcp-remote` are not supported'),
    'v1-inline-prose': ('preserved/docs_cloud-agent_api_endpoints.md', [123, 125], '`http`, `sse`, or `stdio`'),
    'v1-schema': ('preserved/docs-static_cloud-agents-openapi.yaml', [212, 242], "'sse'"),
    'self-hosted-routing': ('preserved/pool.md', [387, 396], 'HTTP / SSE'),
    'legacy-v0': ('retrievals/api-v0.md', [1, 10], 'not yet supported'),
}
conflict_rows = []
for name, (rel, (start, end), needle) in transport_edges.items():
    text = span_text(root / rel, start, end)
    covered = covered_by_sha.get(sha(root / rel), set())
    conflict_rows.append({
        'context': name,
        'pointer': f'{rel}:{start}-{end}',
        'sha256': sha(root / rel),
        'phrase_checked': needle,
        'phrase_present_in_span': needle in text,
        'span_within_receipted_read': set(range(start, end + 1)) <= covered,
    })

result = {
    'scope': 'Independent structural re-verification of imported host-continuation research. Hash, quote-span and receipt-consistency only. Not semantic audit, runtime proof, definition freeze or parity pass.',
    'import_root': 'parity/research/cursor-host-continuation',
    'method': 'Recomputed SHA-256 over preserved bytes; recomputed LF-delimited inclusive spans and compared to verbatim_quote; derived read coverage from receipt ranges. Does not call audit-evidence.py.',
    'sources': sources,
    'source_summary': {
        'hash': tally(sources, 'hash'),
        'retrieval_hash': tally(sources, 'retrieval_hash'),
        'line_count': tally(sources, 'line_count'),
        'read_status': tally(sources, 'read_status'),
    },
    'quote_edges': {
        'proposal_edges': edges,
        'prior_edges': prior_edges,
        'summary': {
            'source_hash': tally(edges + prior_edges, 'source_hash'),
            'quote_span': tally(edges + prior_edges, 'quote_span'),
            'read_status': tally(edges + prior_edges, 'read_status'),
            'proposal_edge_count': len(edges),
            'prior_edge_count': len(prior_edges),
        },
    },
    'input_receipts': input_receipts,
    'transport_scope_conflicts': {
        'status': 'unresolved; no hypothesis selected',
        'evidence': conflict_rows,
        'prior_hook_edges': [e['edge_id'] + ' ' + e['source'] + ':' + str(e['line_span']) for e in prior_edges if 'hooks' in e['source']],
        'hypotheses_pointer': 'unresolved-hypotheses.json#transport-scope',
        'candidate_pointer': 'candidate-scenarios.json MCP-01',
        'additional_conflicts': [
            {'id': 'v1-agent-status', 'prose': 'preserved/docs_cloud-agent_api_endpoints.md:365-371 (ACTIVE, IDLE, ARCHIVED)', 'schema': 'preserved/docs-static_cloud-agents-openapi.yaml:267-270 (ACTIVE, ARCHIVED)'},
            {'id': 'subagent-model-oneOf-overlap', 'schema': 'preserved/docs-static_cloud-agents-openapi.yaml:507-517'},
        ],
    },
}

out_path.parent.mkdir(exist_ok=True)
out_path.write_text(json.dumps(result, indent=2) + '\n')
failures = (
    result['source_summary']['hash'].get('mismatch', 0)
    + result['quote_edges']['summary']['source_hash'].get('mismatch', 0)
    + result['quote_edges']['summary']['quote_span'].get('mismatch', 0)
)
print(json.dumps({k: result[k] for k in ('source_summary',)}, indent=1))
print(json.dumps(result['quote_edges']['summary'], indent=1))
print(json.dumps(conflict_rows, indent=1))
sys.exit(1 if failures else 0)
