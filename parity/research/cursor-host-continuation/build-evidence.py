import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parent
archive = root.parent / 'cursor-host'
sources = [
    ('api-v1', archive / 'services/retrievals/docs_cloud-agent_api_endpoints.md', [[1,400],[401,800],[801,1200],[1201,1600],[1601,2000],[2001,2400],[2401,2800],[2801,3011]]),
    ('openapi-v1', archive / 'services/retrievals/docs-static_cloud-agents-openapi.yaml', [[1,500],[501,1000],[1001,1500],[1501,2000],[2001,2500],[2501,2994]]),
    ('capabilities', archive / 'services/retrievals/docs_cloud-agent_capabilities.md', [[1,200]]),
    ('mcp', archive / 'customization/sources/snapshot-mcp.md', [[1,220],[221,410]]),
    ('pool', archive / 'cli/retrieved/pool.md', [[365,409]]),
    ('api-overview', root / 'retrievals/api-overview.md', [[1,349]]),
    ('api-v0', root / 'retrievals/api-v0.md', [[1,400],[401,722]]),
    ('self-hosted', root / 'retrievals/self-hosted.md', [[1,176]]),
]
(root / 'preserved').mkdir(exist_ok=True)
catalogue = []
texts = {}
receipts = []
for key, path, ranges in sources:
    body = path.read_bytes()
    digest = hashlib.sha256(body).hexdigest()
    lines = body.decode().split('\n')
    count = len(lines) - (1 if lines[-1] == '' else 0)
    destination = root / 'preserved' / path.name if archive in path.parents else path
    if destination != path:
        destination.write_bytes(body)
    record = {'id':key,'original_path':str(path.relative_to(root.parent.parent.parent)), 'preserved_path':str(destination.relative_to(root)), 'sha256':digest, 'newline_delimited_line_count':count}
    metadata_candidates = [path.with_suffix('.metadata.json'), Path(str(path)+'.metadata.json')]
    metadata_path = next((p for p in metadata_candidates if p.exists()), None)
    if metadata_path:
        metadata = json.loads(metadata_path.read_text())
        record['retrieval'] = {k:metadata.get(k) for k in ['requestedUrl','retrievalStartedAt','retrievalFinishedAt','curlExitCode','bodySha256','headersSha256']}
        record['retrieval']['retrievalStartedAt'] = metadata.get('retrievalStartedAt', metadata.get('start'))
        record['retrieval']['retrievalFinishedAt'] = metadata.get('retrievalFinishedAt', metadata.get('end'))
        record['retrieval']['curlExitCode'] = metadata.get('curlExitCode', metadata.get('curlExit'))
        record['retrieval']['bodySha256'] = metadata.get('bodySha256', metadata.get('sha256'))
        response = metadata.get('responseMetadata') or json.loads(metadata.get('curlResponse', '{}'))
        record['retrieval']['response'] = {k:response.get(k) for k in ['url_effective','http_code','content_type','num_redirects','ssl_verify_result']}
        if destination != path:
            (root/'preserved'/metadata_path.name).write_bytes(metadata_path.read_bytes())
            header_candidates = [path.with_suffix('.headers'),Path(str(path)+'.headers')]
            header = next(p for p in header_candidates if p.exists())
            (root/'preserved'/header.name).write_bytes(header.read_bytes())
    else:
        record['retrieval'] = {'limitation':'Old snapshot has no per-file authenticated network retrieval envelope. See prior source-catalogue.json. No time inferred from mtime.'}
    catalogue.append(record)
    texts[key] = lines
    bounded = [[a,min(b,count)] for a,b in ranges]
    covered = set(n for a,b in bounded for n in range(a,b+1))
    receipts.append({'source_id':key,'sha256':digest,'reader':'continuation-coordinator','method':'read tool, personally inspected returned text','inclusive_ranges':bounded,'complete':len(covered)==count,'covered_lines':len(covered),'total_lines':count,'read_time_limitation':'Tool events establish order. No independently authenticated read timestamps. Range receipts do not imply semantic audit or execution.'})
(root/'source-catalogue.json').write_text(json.dumps(catalogue,indent=2)+'\n')
(root/'read-receipts.json').write_text(json.dumps({'line_convention':'UTF-8 decoded text split on LF. A final newline does not create an additional source line.','receipts':receipts},indent=2)+'\n')

specs = [
    ('general-mcp-transports','mcp',19,25,'documented-general-host-contract','General Cursor transport vocabulary. No cloud-wide inference.'),
    ('cloud-mcp-personal-team-entry','capabilities',27,35,'documented-entry-path','Personal dropdown, shared team administration, per-user OAuth. UI context does not explicitly limit the subsequent transport prohibition.'),
    ('cloud-mcp-sse-prohibition','capabilities',37,39,'documented-prohibition','Custom cloud MCP prose excludes SSE and mcp-remote. Scope relative to v1 inline and pool configurations unresolved.'),
    ('cloud-mcp-sensitive-redaction','capabilities',41,46,'documented-security-contract','Saved cloud configuration redaction. Do not infer API retrieval of inline credentials.'),
    ('cloud-http-backend','capabilities',49,49,'documented-routing-contract','HTTP configuration is outside cloud VM. No universal inference for all SDK or API paths.'),
    ('cloud-stdio-vm','capabilities',50,52,'documented-routing-contract','Stdio exposes configuration and environment in VM. Launch needed to check operational success.'),
    ('api-beta','api-v1',3,6,'version-applicability','v1 public beta. No released backend revision identified.'),
    ('api-mcp-inline','api-v1',115,117,'documented-conditional-contract','Inline definitions, 50 limit, unique names, headers or OAuth, stdio environment.'),
    ('api-mcp-type-defaults','api-v1',123,125,'documented-conditional-contract','http/sse/stdio and prose-only defaults based on url or command.'),
    ('api-mcp-remote-url','api-v1',127,129,'documented-validation-contract','HTTP/HTTPS, no userinfo. Schema format uri is broader.'),
    ('api-mcp-stdio-command','api-v1',131,133,'documented-routing-contract','Cloud VM wording. Self-hosted applicability needs routing evidence.'),
    ('api-inline-followup','api-v1',434,436,'documented-conditional-contract','Replace create-time inline definitions for this run; omission keeps current configuration. Later-run persistence of a replacement remains a separate question.'),
    ('schema-stdio','openapi-v1',176,210,'published-schema-constraint','Stdio branch. Required name/command; optional type constrained to stdio; additionalProperties false. args/env not headers/auth.'),
    ('schema-remote','openapi-v1',212,242,'published-schema-constraint','Remote branch. Required name/url; optional type http or sse; additionalProperties false. headers/auth not command/args/env.'),
    ('schema-mcp-oneof','openapi-v1',244,247,'published-schema-constraint','Exactly one branch. Mixed command/url object cannot satisfy either closed branch.'),
    ('schema-oauth','openapi-v1',153,174,'published-schema-constraint','CLIENT_ID required and nonempty; CLIENT_SECRET/scopes optional; no extra auth fields.'),
    ('schema-create-mcp','openapi-v1',600,605,'published-schema-constraint','Create request references MCP union with maxItems 50. Name uniqueness is description, not uniqueItems.'),
    ('schema-run-mcp','openapi-v1',639,644,'published-schema-constraint','Follow-up request references same MCP union.'),
    ('pool-mcp-routing','pool',387,396,'documented-routing-contract','Self-hosted stdio runs on worker; HTTP/SSE URL runs on backend. This adds a cloud-context SSE claim, not a universal transport reconciliation.'),
    ('legacy-v0-mcp','api-v0',1,10,'version-scoped-prohibition','Legacy v0 explicitly says MCP not supported. Do not apply to v1.'),
    ('api-status-idle','api-v1',365,371,'documented-lifecycle-contract','ACTIVE/IDLE/ARCHIVED meanings for controllers. Conflicts same-v1 schema.'),
    ('schema-agent-status','openapi-v1',267,270,'published-schema-constraint','ACTIVE/ARCHIVED only. IDLE absent; no runtime decision.'),
    ('schema-custom-model','openapi-v1',507,517,'schema-overlap-hypothesis','inherit matches both string oneOf branches under standard oneOf semantics. Backend validation not observed.'),
    ('artifact-scope','api-v1',815,825,'documented-artifact-contract','Agent scoped, v1 relative paths, v0 absolute paths not accepted.'),
    ('artifact-download-expiry','api-v1',853,871,'documented-artifact-contract','15-minute presigned URL and required relative path under artifacts.'),
    ('archive-idempotent','api-v1',896,898,'documented-lifecycle-contract','Readable archive, no new runs, idempotent archive.'),
    ('unarchive-idempotent','api-v1',926,928,'documented-lifecycle-contract','Unarchive accepts runs and is idempotent.'),
    ('agent-delete-irreversible','api-v1',956,956,'documented-destructive-contract','No deletion authorized or executed.'),
    ('environment-create-conflict','api-v1',988,990,'documented-error-contract','201 create, duplicate owner-name 409 with optional existing environmentId.'),
    ('environment-create-repos','api-v1',1002,1004,'documented-validation-contract','Max 100, no-repo allowed, inaccessible repo 400 repository_access.'),
    ('environment-list-visibility','api-v1',1070,1072,'documented-authorization-contract','Team admin/service account and repository-limited visibility differ.'),
    ('environment-list-pagination','api-v1',1092,1098,'documented-pagination-contract','Short pages, omitted not null cursor, timed checks, mutation during walk.'),
    ('environment-update-atomic','api-v1',1187,1189,'documented-update-contract','Both changes apply together or neither does, 204 no body, name conflict 409.'),
    ('environment-update-replace','api-v1',1203,1205,'documented-update-contract','Whole environment configuration replacement, validation_error.'),
    ('environment-delete-irreversible','api-v1',1226,1226,'documented-destructive-contract','No deletion authorized or executed.'),
    ('build-status','api-v1',1442,1444,'documented-lifecycle-contract','Build lifecycle states including SKIPPED.'),
    ('build-draft','api-v1',1450,1452,'documented-activation-contract','Draft build not used until activated.'),
    ('worker-token-auth','api-v1',1534,1538,'documented-authorization-contract','Service-account key required, tokens cannot mint tokens, one-hour expiry and no self-refresh.'),
    ('secret-values-never-response','api-v1',1591,1591,'documented-security-contract','Public docs read only, no secret endpoint request executed.'),
    ('secret-precedence','api-v1',1621,1623,'documented-precedence-contract','Start values then environment then personal then team. Lower levels hidden by name.'),
    ('secret-change-visibility','api-v1',1625,1626,'documented-consistency-contract','Future agents, newer builds, read-after-write lag. No secret experiment authorized.'),
    ('secret-list-null-cursor','api-v1',1636,1643,'documented-authorization-pagination-contract','Secret-list pagination differs from environment-list omitted cursor.'),
    ('secret-put-version','api-v1',1713,1722,'documented-version-update-contract','Specific id, ambiguous names, no second version via PUT, omission preserves scope, build secret restriction.'),
    ('pool-auth','api-v1',2073,2077,'documented-authorization-contract','private-workers legacy name is current self-hosted contract, requires pool service-account key.'),
    ('pool-durability','api-v1',2213,2213,'documented-persistence-contract','Pool registration persists at zero workers.'),
    ('pool-register-timeout','api-v1',2309,2311,'documented-timeout-contract','Offline worker reconnect window, zero immediate reacquire, nonnegative integer.'),
    ('pool-deregister','api-v1',2347,2347,'documented-authorization-lifecycle-contract','Soft-delete picker entry, connected workers unaffected, owner/admin gate.'),
    ('pending-filter-cursor','api-v1',2399,2411,'documented-pagination-contract','Page tokens bound to filters, exact pool match.'),
    ('pending-stream-cursor','api-v1',2433,2435,'documented-stream-contract','Same cursor all pages, expires five minutes from listing.'),
    ('pending-sse-context','api-v1',2477,2479,'documented-stream-contract','Queue SSE is not MCP SSE. List-then-watch with bound filters.'),
    ('pending-resume-precedence','api-v1',2483,2485,'documented-stream-contract','Last-Event-ID takes precedence over cursor query.'),
    ('pending-expiry','api-v1',2505,2507,'documented-stream-contract','Five minutes from list, no extension, 410 requires relist.'),
    ('pending-best-effort','api-v1',2509,2513,'documented-delivery-contract','Hints not source of truth, rare drops, idempotent apply, no persisted cursors, max four streams.'),
    ('claim-atomic','api-v1',2553,2555,'documented-concurrency-contract','Claim before start, second live claim rejected.'),
    ('claim-session-token','api-v1',2569,2571,'documented-authorization-contract','Mint with claim; mint failure leaves request unclaimed.'),
    ('release-using-worker','api-v1',2704,2706,'documented-lifecycle-contract','Immediate release only no using turn; unknown connection treated connected; active 400 changes nothing.'),
    ('release-no-retry-404','api-v1',2743,2743,'documented-error-contract','No live claim, do not retry 404.'),
    ('fail-claim-race','api-v1',2751,2759,'documented-concurrency-contract','Waiting-only fail, discard if connection/claim changes before pickup; user-visible text and Try Again.'),
    ('fail-claim-message','api-v1',2771,2773,'documented-validation-contract','Trim/control-character filtering, 1-500 resulting characters, other fields rejected.'),
    ('self-hosted-execution','self-hosted',1,3,'documented-execution-boundary','Cursor loop/inference versus worker tools. Not independent model worker.'),
    ('self-hosted-environment-limits','self-hosted',73,87,'documented-context-contract','Environment settings and dashboard secrets vary by worker type.'),
]
by_id = {item['id']:item for item in catalogue}
edges = []
nodes = []
for key, source, start, end, kind, note in specs:
    assert 1 <= start <= end <= by_id[source]['newline_delimited_line_count'], key
    nodes.append({'id':key,'type':kind,'owned_behavior':note,'status':'proposal-unverified','dependencies':[source]})
    edges.append({'id':'evidence-'+key,'from':source,'to':key,'source_file':by_id[source]['preserved_path'],'source_sha256':by_id[source]['sha256'],'line_span':[start,end],'verbatim_quote':'\n'.join(texts[source][start-1:end]),'classification':kind,'scope_note':note,'version_applicability':'Preserved official documentation capture only. No verified mapping to locked CLI or backend deployment.','resolution':'Open for independent semantic audit and reference observation; no Pi binding or acceptance verdict.'})
(root/'dependency-proposals.json').write_text(json.dumps({'status':'discovery-only','sources':[{'id':x['id'],'type':'source-capture','immutable_hash':x['sha256']} for x in catalogue],'nodes':nodes,'edges':edges},indent=2)+'\n')
print(json.dumps({'sources':len(catalogue),'proposals':len(nodes),'quotation_edges':len(edges)}))
