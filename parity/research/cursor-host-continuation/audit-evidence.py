import hashlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parent
sources = json.loads((root / 'source-catalogue.json').read_text())
receipts = json.loads((root / 'read-receipts.json').read_text())['receipts']
graph = json.loads((root / 'dependency-proposals.json').read_text())
recovery = json.loads((root / 'prior-source-recovery.json').read_text())
prior = json.loads((root / 'prior-mcp-proposals.json').read_text())
if '--tamper-quote' in sys.argv:
    graph = {**graph, 'edges': [{**graph['edges'][0], 'verbatim_quote': 'deliberately wrong quotation'}, *graph['edges'][1:]]}
errors = []
source_by_id = {source['id']: source for source in sources}
for source in sources:
    body = (root / source['preserved_path']).read_bytes()
    if hashlib.sha256(body).hexdigest() != source['sha256']:
        errors.append(source['id'] + ' source hash mismatch')
    retrieval = source['retrieval']
    if retrieval.get('bodySha256') and retrieval['bodySha256'] != source['sha256']:
        errors.append(source['id'] + ' retrieval hash mismatch')
for receipt in receipts:
    source = source_by_id[receipt['source_id']]
    count = source['newline_delimited_line_count']
    covered = set()
    for start, end in receipt['inclusive_ranges']:
        if not 1 <= start <= end <= count:
            errors.append(source['id'] + ' invalid read range')
        covered.update(range(start, end + 1))
    if receipt['sha256'] != source['sha256'] or receipt['complete'] != (len(covered) == count):
        errors.append(source['id'] + ' inconsistent receipt')
node_ids = {node['id'] for node in graph['nodes']}
for edge in graph['edges']:
    body = (root / edge['source_file']).read_bytes()
    lines = body.decode().split('\n')
    start, end = edge['line_span']
    if hashlib.sha256(body).hexdigest() != edge['source_sha256']:
        errors.append(edge['id'] + ' quotation source hash mismatch')
    if '\n'.join(lines[start - 1:end]) != edge['verbatim_quote']:
        errors.append(edge['id'] + ' quotation span mismatch')
    if edge['to'] not in node_ids or edge['from'] not in source_by_id:
        errors.append(edge['id'] + ' dangling graph endpoint')
for item in prior:
    edge = item['edge']
    source = recovery[edge['source_file']]
    body = (root / source['preserved_path']).read_bytes()
    start, end = edge['line_span']
    if hashlib.sha256(body).hexdigest() != edge['source_sha256']:
        errors.append(edge['id'] + ' prior source hash mismatch')
    if '\n'.join(body.decode().split('\n')[start - 1:end]) != edge['verbatim_quote']:
        errors.append(edge['id'] + ' prior quotation span mismatch')
for source in json.loads((root / 'input-read-receipts.json').read_text()):
    body = (root / source['source_file']).read_bytes()
    if hashlib.sha256(body).hexdigest() != source['source_sha256']:
        errors.append(source['source_file'] + ' input hash mismatch')
for directory in ['retrievals', 'preserved']:
    for path in (root / directory).glob('*.metadata.json'):
        metadata = json.loads(path.read_text())
        stem = path.name.removesuffix('.metadata.json')
        bodies = [path.parent / stem, path.parent / (stem + '.md')]
        headers = [path.parent / (stem + '.headers'), path.parent / (stem.removesuffix('.md') + '.headers')]
        body = next(p for p in bodies if p.is_file())
        header = next(p for p in headers if p.is_file())
        if hashlib.sha256(body.read_bytes()).hexdigest() != metadata.get('bodySha256', metadata.get('sha256')):
            errors.append(path.name + ' response body mismatch')
        if metadata.get('headersSha256') and hashlib.sha256(header.read_bytes()).hexdigest() != metadata['headersSha256']:
            errors.append(path.name + ' response headers mismatch')
for record in json.loads((root / 'unresolved-hypotheses.json').read_text()):
    if not set(record['evidence']).issubset(node_ids):
        errors.append(record['id'] + ' unknown hypothesis evidence')
scenarios = json.loads((root / 'candidate-scenarios.json').read_text())['scenarios']
for record in scenarios:
    if not set(record['sources']).issubset(node_ids):
        errors.append(record['id'] + ' unknown scenario source')
result = {'scope': 'Structural source, quotation, graph and receipt integrity only. Not semantic audit, runtime proof, closure or acceptance.', 'sources_checked': len(sources), 'quotation_edges_checked': len(graph['edges']), 'prior_edges_checked': len(prior), 'errors': errors}
print(json.dumps(result, indent=2))
sys.exit(1 if errors else 0)
