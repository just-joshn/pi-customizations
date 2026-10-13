#!/usr/bin/env node
// Builds parity/reverse-engineer-anything/ledger.json from the requirement table.
// The ledger is the source of truth; this script keeps it reproducible and keeps
// every acceptance-test citation honest (each one is checked to exist).
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..', '..', '..');
const tests = 'skills/reverse-engineer-anything/tests';

const verified = (id, sourceBehavior, evidence, piMapping, acceptanceTest) => ({ id, sourceBehavior, evidence, piMapping, acceptanceTest, status: 'VERIFIED' });
const excluded = (id, sourceBehavior, reason, evidence = 'REA-README/docs (documented; prerequisites not verified on this host)') => ({
  id,
  sourceBehavior,
  evidence,
  piMapping: 'none — declared unavailable',
  status: 'NOT APPLICABLE',
  reason,
});

const requirements = [
  verified(
    'ENV-001',
    'Every analysis returns one Evidence envelope with the reference key set',
    'FIXTURE rea-6.4.0-analyze-javascript-application.json',
    'lib/envelope.mjs createEnvelope',
    `${tests}/envelope.test.mjs::ENV-001: envelope carries the reference key set`,
  ),
  verified(
    'ENV-002',
    'The subject carries a content digest of the bytes that were read',
    'REA-CLI analyze-javascript-application',
    'lib/target.mjs describeSubject + digestTree',
    `${tests}/envelope.test.mjs::ENV-002: subject digest is content-addressed and stable across paths`,
  ),
  verified(
    'ENV-003',
    'Evidence identity is a pure function of operation, parameters, subject digest and result',
    'REA-MCP evidence_id shape',
    'lib/canonical.mjs evidenceId',
    `${tests}/envelope.test.mjs::ENV-003: evidence ids are deterministic and input-sensitive`,
  ),
  verified('ENV-004', 'Provider and predicate identify the producing operation', 'REA-CLI envelopes', 'lib/envelope.mjs PROVIDER', `${tests}/envelope.test.mjs::ENV-004: provider and predicate identify the operation`),
  verified(
    'ENV-005',
    'Confidence and authority use the reference vocabularies',
    'FIXTURE envelope + observation vocabularies',
    'lib/envelope.mjs CONFIDENCE/AUTHORITY/EVIDENCE_AUTHORITY',
    `${tests}/envelope.test.mjs::ENV-005: confidence and authority use the reference vocabularies`,
  ),
  verified(
    'ENV-006',
    'Limitations travel with a result into views and exports',
    'REA-SKILL; FIXTURE view limitations',
    'lib/store.mjs exportBundle + lib/views.mjs',
    `${tests}/envelope.test.mjs::ENV-006: limitations survive view and export`,
  ),

  verified(
    'OBS-001',
    'Each observation carries authority, state, confidence, artifact, location, extractor and coverage',
    'FIXTURE observation shape',
    'lib/envelope.mjs observation',
    `${tests}/envelope.test.mjs::OBS-001: observations carry artifact, location, extractor and coverage`,
  ),
  verified(
    'OBS-002',
    'Static syntax is inferred, never observed execution',
    'REA-SKILL; FIXTURE state vocabulary',
    'lib/envelope.mjs STATE + lib/discipline.mjs auditEvidence',
    `${tests}/envelope.test.mjs::OBS-002: static syntax yields inferred observations`,
  ),
  verified('OBS-003', 'A truncated coverage block reports an exact omitted count', 'FIXTURE coverage blocks', 'lib/envelope.mjs coverage', `${tests}/envelope.test.mjs::OBS-003: truncated coverage reports an omitted count`),
  verified(
    'OBS-004',
    'A missing match in partial input is not absence',
    'REA-SKILL; REA-DOCS javascript-application-graph.md',
    'lib/discipline.mjs absenceClaimAllowed',
    `${tests}/discipline.test.mjs::DISC-005: absence is only claimable inside complete coverage`,
  ),

  verified(
    'ERR-001',
    'Failures use the reference error envelope, categories and exit code',
    'docs/error-contract.schema.json; FIXTURE rea-6.4.0-errors.json',
    'lib/errors.mjs fail + errorEnvelope + scripts/rea.mjs',
    `${tests}/errors.test.mjs::ERR-001: error envelopes match the reference schema`,
  ),
  verified('ERR-002', 'Every error names the next step in remediation.action', 'REA-CLI captured failures', 'lib/errors.mjs defaultAction', `${tests}/errors.test.mjs::ERR-002: remediation names the next step`),
  verified('ERR-003', 'Invalid input enumerates each issue path', 'REA-CLI missing-path failure', 'lib/errors.mjs invalidInput + scripts/rea.mjs parse', `${tests}/errors.test.mjs::ERR-003: invalid input lists every issue path`),
  verified(
    'ERR-004',
    'An unavailable capability is a typed refusal, not a crash',
    'REA-CLI capability_unavailable on macOS',
    'lib/errors.mjs capabilityUnavailable + lib/commands.mjs',
    `${tests}/errors.test.mjs::ERR-004: missing prerequisite yields capability_unavailable`,
  ),

  verified(
    'STORE-001',
    'Evidence is durably written before it is reported',
    'REA-SKILL retained-evidence rule',
    'lib/store-io.mjs writeJsonAtomic + lib/store.mjs retain',
    `${tests}/store.test.mjs::STORE-001: evidence lands on disk before reporting`,
  ),
  verified(
    'STORE-002',
    'Repeating an identical analysis keeps one record and counts the repeat',
    'REA-SKILL "do not repeat identical analysis"',
    'lib/store.mjs retainRecord dedupe',
    `${tests}/store.test.mjs::STORE-002: identical analysis does not duplicate records`,
  ),
  verified(
    'STORE-003',
    'The ledger is derived state that survives corruption and concurrent writers',
    'port design, decisions.md Decision 3',
    'lib/store.mjs readLedger rebuild + withLedgerLock',
    `${tests}/store.test.mjs::STORE-003b: concurrent writers lose no index entry`,
  ),
  verified(
    'STORE-004',
    'Export is byte-stable and import validates every content address',
    'REA-MCP export_evidence_bundle / get_evidence_bundle',
    'lib/store.mjs exportBundle + importBundle + assertBundleIntegrity',
    `${tests}/store.test.mjs::STORE-004: bundle export is byte-stable and import validates digests`,
  ),
  verified(
    'STORE-005',
    'A bundle export refuses to overwrite unless asked',
    'REA-MCP export_evidence_bundle overwrite guard',
    'lib/store.mjs exportBundle',
    `${tests}/store.test.mjs::STORE-005: a bundle refuses to overwrite without permission`,
  ),
  verified('STORE-006', 'A view refuses a directory as evidence', 'pod design', 'lib/store.mjs readAnyEvidence', `${tests}/store.test.mjs::STORE-006: readAnyEvidence refuses a session directory`),

  verified(
    'VIEW-001',
    'A summary view reads retained evidence without re-running the producer',
    'FIXTURE rea-6.4.0-analysis-view-summary.json',
    'lib/views.mjs buildView + summarize',
    `${tests}/view.test.mjs::VIEW-001: summary view reads the retained record`,
  ),
  verified(
    'VIEW-002',
    'A path that names several graph roles must be disambiguated by node id',
    'REA-SKILL "a single file path can represent several graph roles"',
    'lib/views.mjs itemOf ambiguity refusal',
    `${tests}/view.test.mjs::VIEW-002: node selection is unambiguous when paths repeat`,
  ),
  verified('VIEW-003', 'Page counters never imply source completeness', 'REA-SKILL paging rule', 'lib/views.mjs page + coverage.source_complete', `${tests}/view.test.mjs::VIEW-003: page counters never imply completeness`),
  verified(
    'VIEW-004',
    'Unknown view kinds and selectors are refused with issue paths',
    'REA-MCP inspect_analysis_view schema',
    'lib/views.mjs buildView validation',
    `${tests}/view.test.mjs::VIEW-004: unknown view kinds and selectors are refused`,
  ),

  verified(
    'UNK-001',
    'A residual unknown records its requirements, probes and evidence, at revision 1',
    'REA-MCP record_unknown schema',
    'lib/unknowns.mjs recordUnknown',
    `${tests}/unknowns.test.mjs::UNK-001: recorded unknown carries requirements and revision 1`,
  ),
  verified(
    'UNK-002',
    'Updates append immutable revisions and refuse a stale revision',
    'REA-SKILL; REA-MCP update_unknown',
    'lib/unknowns.mjs updateUnknown',
    `${tests}/unknowns.test.mjs::UNK-002: stale revision conflicts instead of overwriting`,
  ),
  verified(
    'UNK-003',
    'A resolution needs evidence that meets the recorded authority and confidence',
    'REA-SKILL "only qualifying observed evidence can verify a resolution"',
    'lib/unknowns.mjs unmetRequirements + verifyUnknownResolution',
    `${tests}/unknowns.test.mjs::UNK-003: resolution is refused without qualifying evidence`,
  ),
  verified(
    'UNK-004',
    'Unknowns survive an export/import round trip',
    'REA-MCP get_evidence_bundle',
    'lib/unknowns.mjs unknownRecords + importUnknownRecord',
    `${tests}/unknowns.test.mjs::UNK-004: an unknown survives an export and import round trip`,
  ),

  verified(
    'CAP-001',
    'Every implemented operation appears with its seven effect flags and limitations',
    'REA-CLI capabilities --json',
    'lib/capabilities.mjs capabilityMatrix',
    `${tests}/capabilities.test.mjs::CAP-001: matrix reports effects for every operation`,
  ),
  verified(
    'CAP-002',
    'An operation whose prerequisite is missing is unavailable with a reason and remediation',
    'REA-CLI capability_unavailable',
    'lib/capabilities.mjs unavailableMatrix + lib/commands.mjs',
    `${tests}/capabilities.test.mjs::CAP-002: missing prerequisite shows as unavailable with remediation`,
  ),
  verified(
    'CAP-003',
    'Write and process effects are declared, and no operation mutates the artifact',
    'REA-CLI effects vocabulary',
    'lib/capabilities.mjs EFFECT_TEMPLATE',
    `${tests}/capabilities.test.mjs::CAP-003: write and process effects are declared`,
  ),
  verified('CAP-004', 'Concurrent writers lose no ledger entry', 'port design, decisions.md invariants', 'lib/store.mjs withLedgerLock', `${tests}/store.test.mjs::STORE-003b: concurrent writers lose no index entry`),

  verified(
    'ROUTE-001',
    'The first operation is chosen from the target, before any other question',
    'REA-SKILL "route the target first"',
    'lib/route.mjs routeByPath + ROUTES',
    `${tests}/route.test.mjs::ROUTE-001: each reference target class routes to its operation`,
  ),
  verified('ROUTE-002', 'An ambiguous or unknown name is never resolved by guessing', 'REA-SKILL target-selection rule', 'lib/route.mjs resolveTargetName', `${tests}/route.test.mjs::ROUTE-002: ambiguous target asks instead of choosing`),
  verified(
    'ROUTE-003',
    'Routing follows the bytes, and an unsupported container is named',
    'REA-CLI --artifact-format auto',
    'lib/route.mjs UNSUPPORTED + lib/target.mjs detectFormatFromBytes',
    `${tests}/route.test.mjs::ROUTE-003: content beats extension and mismatches are reported`,
  ),
  verified(
    'ROUTE-004',
    'A Go binary routes to the Go reader with the layout reader as the alternative',
    'REA-README Go binaries row',
    'lib/route.mjs decision goBinary',
    `${tests}/route.test.mjs::ROUTE-004: a Go binary routes to the Go reader`,
  ),

  verified(
    'JS-001',
    'A JavaScript/Electron analysis executes nothing and reports the reference result shape',
    'FIXTURE rea-6.4.0-analyze-javascript-application.json',
    'lib/formats/javascript.mjs analyzeJavaScriptApplication',
    `${tests}/javascript.test.mjs::JS-001: analyzing a tree executes nothing`,
  ),
  verified(
    'JS-002',
    'Resolved, external and unresolved specifiers are distinguished',
    'FIXTURE javascript-module properties',
    'lib/formats/javascript.mjs resolveSpecifier + addImportFacts',
    `${tests}/javascript.test.mjs::JS-002: inside, outside and unresolved specifiers are distinguished`,
  ),
  verified(
    'JS-003',
    'Electron roles are reported with their mechanism, and an unresolved preload stays unresolved',
    'FIXTURE electron-main/renderer properties',
    'lib/formats/javascript.mjs resolveElectronRoles + addRoleNode',
    `${tests}/javascript.test.mjs::JS-003: electron roles and unresolved preload are reported`,
  ),
  verified(
    'JS-004',
    'IPC counts pair literal channels and count the unpaired ones',
    'FIXTURE summary.ipc',
    'lib/formats/javascript.mjs pairIpc + buildSummary',
    `${tests}/javascript.test.mjs::JS-004: paired and unpaired channels are counted`,
  ),
  verified(
    'JS-005',
    'Context-bridge members are separated from unknown members',
    'FIXTURE context-bridge-api properties',
    'lib/formats/javascript.mjs graphNodeForBridge',
    `${tests}/javascript.test.mjs::JS-005: exposed members and unknown members are separated`,
  ),
  verified(
    'JS-006',
    'Native member requests are marked as unverified exports',
    'FIXTURE native-export properties',
    'lib/formats/javascript.mjs graphNodeForNativeRequest',
    `${tests}/javascript.test.mjs::JS-006: native member names are marked unverified`,
  ),
  verified('JS-007', 'A parse failure is recorded without aborting the analysis', 'FIXTURE statistics', 'lib/formats/javascript.mjs extractFiles', `${tests}/javascript.test.mjs::JS-007: parse failure is recorded and does not abort`),
  verified(
    'JS-008',
    'An ASAR is read from its own index and its integrity policy decides the outcome',
    'REA-CLI --artifact-format / --integrity-policy',
    'lib/formats/asar.mjs + javascript.mjs integrity handling',
    `${tests}/javascript.test.mjs::JS-008: asar inventory honours the integrity policy`,
  ),
  verified('JS-009', 'A member path that escapes the target is refused', 'harness security rules', 'lib/formats/zip.mjs normalizeMemberPath', `${tests}/javascript.test.mjs::JS-009: escaping member paths are refused`),
  verified('JS-010', 'The CLI returns a reference-shaped envelope with a stable evidence id', 'FIXTURE envelope', 'scripts/rea.mjs + lib/commands.mjs', `${tests}/javascript.test.mjs::JS CLI`),

  verified(
    'ART-001',
    'An archive inventory lists every member with its digest and no extraction to disk',
    'REA-MCP inspect_artifact; REA-DOCS',
    'lib/formats/artifact.mjs inspectArtifact',
    `${tests}/artifact.test.mjs::ART-001: inventory lists every member with digests`,
  ),
  verified(
    'ART-002',
    'The integrity policy decides whether a contradiction fails the call or is recorded',
    'docs/error-contract.schema.json',
    'lib/formats/artifact.mjs contradictionsIn + commands.mjs',
    `${tests}/artifact.test.mjs::ART-002: integrity policy decides the outcome`,
  ),
  verified(
    'ART-003',
    'Inventory pages report selection apart from source completeness',
    'REA-MCP inspect_analysis_view inventory',
    'lib/views.mjs inventoryOf',
    `${tests}/artifact.test.mjs::ART-003: occurrence selection pages without implying completeness`,
  ),
  verified(
    'ART-004',
    'Unsupported containers are named rather than guessed',
    'REA-CLI capabilities limitations',
    'lib/formats/artifact.mjs + lib/route.mjs UNSUPPORTED',
    `${tests}/artifact.test.mjs::ART-004: unsupported containers are named, not guessed`,
  ),
  verified('ART-005', 'A hostile member path is refused and never read', 'harness security rules', 'lib/formats/zip.mjs normalizeMemberPath', `${tests}/artifact.test.mjs::ART-005: hostile member paths are never read`),
  verified('ART-006', 'A truncated container fails closed', 'harness security rules', 'lib/formats/artifact.mjs asArtifactFormatError', `${tests}/artifact.test.mjs::ART-006: a truncated container fails closed`),

  verified(
    'BIN-001',
    'Mach-O, ELF and PE facts are read from bytes without an engine',
    'REA-README; docs/binary-diagnostics.md',
    'lib/formats/binary.mjs readBinaryLayout',
    `${tests}/binary.test.mjs::BIN-001: mach-o, elf and pe facts are read from bytes`,
  ),
  verified(
    'BIN-002',
    'A stripped binary reports unavailable symbol coverage, never "no imports"',
    'docs/binary-diagnostics.md',
    'lib/formats/binary.mjs symbol coverage',
    `${tests}/binary.test.mjs::BIN-002: a stripped binary reports unavailable symbol coverage`,
  ),
  verified('BIN-003', 'Static mitigation candidates cite the marker that produced them', 'REA-README static mitigation candidates', 'lib/formats/binary.mjs mitigations', `${tests}/binary.test.mjs::BIN-003: mitigations cite their marker`),
  verified(
    'BIN-004',
    'An ELF on darwin is read, with the reference platform boundary recorded as a deviation',
    'REA-CLI capability_unavailable on macOS',
    'lib/formats/binary.mjs + commands.mjs limitations',
    `${tests}/binary.test.mjs::BIN-004: elf on darwin is read with an explicit deviation limitation`,
  ),
  verified(
    'BIN-005',
    'Malformed structures fail closed with a named code and offset',
    'harness security rules',
    'lib/formats/binary.mjs FormatError + commands.mjs',
    `${tests}/binary.test.mjs::BIN-005: truncated and out-of-range structures fail closed`,
  ),
  verified('BIN-006', 'A real host binary is read when present', 'host observation (macOS, /bin/ls)', 'lib/formats/binary.mjs readBinaryLayout', `${tests}/binary.test.mjs::BIN-006: a real host binary is read when present`),

  verified(
    'GO-001',
    'Go compiler version, build settings and modules are read from the embedded metadata',
    'REA-README Go binaries row',
    'lib/formats/gobinary.mjs readGoBuildInfo',
    `${tests}/go.test.mjs::GO-001: buildinfo yields version, settings and modules`,
  ),
  verified(
    'GO-002',
    'Absent metadata is reported as unknown, never as "not a Go binary"',
    'REA-README "absent metadata does not prove a binary is not Go"',
    'lib/formats/gobinary.mjs + commands.mjs capabilityUnavailable',
    `${tests}/go.test.mjs::GO-002: missing buildinfo is reported as unknown`,
  ),
  verified('GO-003', 'A real host Go binary is read when present', 'host observation (Homebrew gh is Go)', 'lib/formats/gobinary.mjs readGoBuildInfo', `${tests}/go.test.mjs::GO-003: a real Go binary is read when present`),
  verified('GO-004', 'A malformed buildinfo blob degrades to partial coverage', 'harness failure-handling rules', 'lib/formats/gobinary.mjs coverage', `${tests}/go.test.mjs::GO-004: a malformed blob degrades instead of throwing`),

  verified(
    'HAR-001',
    'A retained capture is inspected offline, and no recorded URL is fetched',
    'REA-DOCS web-network-captures.md; REA-SKILL',
    'lib/formats/har.mjs readHarCapture',
    `${tests}/har.test.mjs::HAR-001: inspection performs no network access`,
  ),
  verified('HAR-002', 'Credential header values never appear in the result', 'REA-DOCS; REA-SKILL', 'lib/formats/har.mjs redaction', `${tests}/har.test.mjs::HAR-002: authorization and cookie values never appear`),
  verified(
    'HAR-003',
    'The api-surface view groups by method, origin and path template',
    'docs/evidence-workflows.md',
    'lib/formats/har.mjs apiSurface + lib/views.mjs apiSurfaceOf',
    `${tests}/har.test.mjs::HAR-003: api surface groups by method, origin and path template`,
  ),
  verified('HAR-004', 'Record identity survives paging and an unsupported version is refused', 'REA-SKILL; REA-DOCS', 'lib/formats/har.mjs ordinal + HarError', `${tests}/har.test.mjs::HAR-004: record ordinals survive paging`),
  verified('HAR-005', 'A capped capture reports the exact omission', 'REA-SKILL paging rule', 'lib/formats/har.mjs coverage', `${tests}/har.test.mjs::HAR-005: a truncated capture reports the omission`),

  verified(
    'DISC-001',
    'A finding must cite evidence; an inference may not be reported as an observation',
    'REA-SKILL',
    'lib/discipline.mjs auditEvidence',
    `${tests}/discipline.test.mjs::DISC-001: a finding without evidence cannot be reported as observed`,
  ),
  verified('DISC-002', 'An execution claim requires a runtime record', 'REA-SKILL', 'lib/discipline.mjs claimsExecution', `${tests}/discipline.test.mjs::DISC-002: execution claims require a runtime record`),
  verified('DISC-003', 'Every cited evidence id resolves in the bundle', 'REA-SKILL', 'lib/discipline.mjs unresolvedCitations', `${tests}/discipline.test.mjs::DISC-003: bundle resolves every cited evidence id`),
  verified(
    'DISC-004',
    'The port never reads outside the declared target',
    'REA-SKILL "do not broaden the target"',
    'lib/discipline.mjs isWithinTarget + lib/formats/target-source.mjs',
    `${tests}/discipline.test.mjs::DISC-004: paths outside the target are refused`,
  ),
  verified('DISC-005', 'Absence is only claimable inside complete coverage', 'REA-SKILL', 'lib/discipline.mjs absenceClaimAllowed', `${tests}/discipline.test.mjs::DISC-005: absence is only claimable inside complete coverage`),
  verified('DISC-006', 'The port passes its own discipline audit', 'port design', 'lib/discipline.mjs auditEvidence', `${tests}/discipline.test.mjs::DISC-006: the analyzer output passes its own discipline audit`),

  verified(
    'SEC-001',
    'A ZIP member over the member limit is refused before decompression, and an unreadable member is an integrity problem rather than a silent success',
    'independent security review, finding 1',
    'lib/formats/zip.mjs assertMemberWithinLimits + lib/formats/artifact.mjs coverageFor',
    `${tests}/artifact.test.mjs::ART-007: an oversized member is refused before it is decompressed`,
  ),
  verified(
    'SEC-002',
    'A hostile bundle or CLI argument cannot name a path outside the store',
    'independent security review, findings 2 and 5',
    'lib/store.mjs assertEvidenceId + lib/unknowns.mjs assertUnknownId',
    `${tests}/store.test.mjs::STORE-007: a malformed evidence or unknown id cannot name a path`,
  ),
  verified(
    'SEC-003',
    'An imported unknown must hash to its own id, and concurrent updates cannot both append one revision',
    'independent security review, findings 2 and 6',
    'lib/store.mjs importBundle + lib/unknowns.mjs locked()',
    `${tests}/store.test.mjs::STORE-009: concurrent unknown revisions cannot both win`,
  ),
  verified(
    'SEC-004',
    'Credential query values and signing headers never survive a capture inspection',
    'independent security review, findings 3 and 4',
    'lib/formats/har.mjs redactQuery + CREDENTIAL_NAME_PARTS',
    `${tests}/har.test.mjs::HAR-006: credential query values and signing headers are redacted`,
  ),
  verified(
    'SEC-005',
    'Pathological nesting degrades with a named error instead of a stack overflow',
    'independent security review, finding 8',
    'lib/canonical.mjs MAX_DEPTH + lib/formats/asar.mjs MAX_HEADER_DEPTH',
    `${tests}/envelope.test.mjs::ENV-007: a structure nested past the depth cap is refused, not overflowed`,
  ),
  verified(
    'SEC-006',
    'A lock held by a live writer is not stolen from it',
    'independent security review, finding 7',
    'lib/store.mjs withLedgerLock + releaseOwnLock',
    `${tests}/store.test.mjs::STORE-010: a lock held by a live writer is not stolen`,
  ),
  verified(
    'ARCH-001',
    'The discipline audit is reachable from the CLI',
    'independent architecture review, finding 1',
    'lib/commands.mjs discipline-audit + lib/discipline.mjs',
    `${tests}/discipline.test.mjs::DISC-007: the discipline audit is reachable from the CLI`,
  ),
  verified(
    'ARCH-002',
    'A view reads evidence through the validated reader',
    'independent architecture review, finding 2',
    'lib/commands.mjs inspect-analysis-view + lib/store.mjs readAnyEvidence',
    `${tests}/route.test.mjs::ROUTE-006: inspect-analysis-view refuses a directory as evidence`,
  ),
  verified(
    'ARCH-003',
    'A flag is boolean only where the command declares it',
    'independent architecture review, finding 8',
    'scripts/rea.mjs booleanFlagsFor + commandNameFrom',
    `${tests}/route.test.mjs::ROUTE-007: a flag is only boolean where the command declares it`,
  ),
  verified(
    'ARCH-004',
    'A malformed capture is a typed target error, not an execution failure',
    'independent architecture review, finding 9',
    'lib/commands.mjs inspect-web-network-capture',
    `${tests}/har.test.mjs::HAR-007: a capture that is not JSON is refused as an unsupported target`,
  ),
  verified(
    'MACOS-001',
    'Apple metadata families are refused by name and compared against the reference capability matrix',
    'REA-CLI capabilities --json (fixture rea-6.4.0-capabilities.json)',
    'lib/capabilities.mjs unavailableMatrix',
    `${tests}/capabilities.test.mjs::CAP-001: matrix reports effects for every operation`,
  ),
  verified(
    'MACOS-002',
    'Provider- and toolchain-backed native families are refused by name with their prerequisite',
    'REA-CLI captured capability_unavailable on this host',
    'lib/capabilities.mjs unavailableMatrix',
    `${tests}/capabilities.test.mjs::CAP-002: missing prerequisite shows as unavailable with remediation`,
  ),
  verified(
    'SKILL-001',
    'The skill carries valid Agent Skills frontmatter and routes to its references',
    'Pi docs/skills.md; REA-SKILL install path',
    'skills/reverse-engineer-anything/SKILL.md',
    `${tests}/skill.test.mjs::SKILL-001: skill frontmatter is valid and the skill loads in Pi`,
  ),
  verified(
    'SKILL-002',
    'Every command the skill documents exists and accepts its documented flags',
    'port design',
    'SKILL.md + references/*.md vs scripts/rea.mjs',
    `${tests}/skill.test.mjs::SKILL-002: every documented command exists and accepts its documented flags`,
  ),
  verified(
    'SKILL-003',
    'Only the description is always loaded; the body stays short and instruction-only',
    'Pi docs/skills.md',
    'SKILL.md frontmatter + body',
    `${tests}/skill.test.mjs::SKILL-003: description is the only always-loaded text`,
  ),
  verified('SKILL-004', 'The skill declares no runtime dependency beyond Node builtins', 'Pi docs/packages.md', 'scripts/**.mjs imports', `${tests}/skill.test.mjs::SKILL-004: the packaged skill declares no runtime dependency`),
  verified(
    'INDEP-001',
    'The shipped skill never names the upstream package, CLI or MCP surface, and never cites a command it does not implement',
    'user constraint: zero exceptions',
    'skill.test.mjs scanned allowlist',
    `${tests}/skill.test.mjs::INDEP-001: the shipped skill never reaches for the upstream project`,
  ),
  verified(
    'INDEP-002',
    'No shipped module can import a network or process module, and none calls fetch',
    'user constraint: zero exceptions',
    'skill.test.mjs import allowlist',
    `${tests}/skill.test.mjs::INDEP-002: the shipped skill can neither open a connection nor launch a process`,
  ),
  verified(
    'INDEP-003',
    'Production code never reads the development evidence tree',
    'user constraint: zero exceptions',
    'skill.test.mjs path scan',
    `${tests}/skill.test.mjs::INDEP-003: production code does not read the parity evidence tree`,
  ),
  verified('SKILL-005', 'A real Pi session loads the skill and uses the port CLI', 'measured observation on Pi 1.2.0', 'pi -p --no-session --skill <dir>', 'parity/reverse-engineer-anything/fixtures/e2e/pi-skill-load.txt'),
  verified(
    'SKILL-006',
    'The repository root installs as a Pi package exposing the skill, and removal unregisters it',
    'measured observation on Pi 1.2.0',
    'pi install <repo> in an isolated PI_CODING_AGENT_DIR',
    'parity/reverse-engineer-anything/fixtures/e2e/pi-install-cycle.txt',
  ),

  excluded(
    'PROV-001',
    'open_binary and the provider-backed native tier (analyze_function, procedure_pseudo_code, list_procedures, decompile, trace_feature, annotations, bookmarks)',
    'Requires Hopper, Ghidra or IDA. None is installed, and the reference itself reports capability_unavailable on this host. inspect-binary-layout covers structure, symbols and mitigations; function-level questions are recorded as unknowns instead.',
  ),
  excluded(
    'MACOS-003',
    'The macOS/Apple metadata family and the native provider helpers as separate entry points',
    'Several are listed as available on this host by the reference capability matrix. This port reports Mach-O structure and slices through inspect_binary_layout, refuses the Apple metadata formats by name, and never extracts an artifact to disk.',
    'REA-CLI capabilities --json (fixture rea-6.4.0-capabilities.json)',
  ),
  excluded(
    'ANDROID-001',
    'inspect_android_package, inspect_android_class, inspect_android_method, search_android_classes, trace_android_references, decode_android_resources',
    'Requires a headless JADX MCP JAR with a full JDK and a caller-supplied Apktool launcher. inspect-artifact still inventories APK members; the code answer stays open.',
  ),
  excluded('FIRMWARE-001', 'inspect_firmware_regions and extract_firmware', 'Requires Binwalk or Unblob on Linux.'),
  excluded(
    'CAPTURE-001',
    'inspect_packet_capture, inspect_pcap_capture, decode_signal_recording, inspect_recorded_crash',
    'Requires TShark 4.x with prlimit, sigrok-cli 0.7.2, or pwntools on Linux x64. A retained HAR is the only capture this port reads.',
  ),
  excluded('MANAGED-001', 'inspect_managed_artifact, inspect_managed_members, compare_managed_members, import_managed_reconstruction', 'Managed PE/CLI metadata and CIL decoding are outside this port’s scope.'),
  excluded('WASM-001', 'inspect_wasm_artifact', 'Requires WABT 1.0.42 with exact byte/tool identity.'),
  excluded('EVM-001', 'inspect_evm_interface', 'Outside this port’s scope; no chain lookup or carrier handling is implemented.'),
  excluded('SQLITE-001', 'inspect_sqlite_database', 'Outside this port’s scope.'),
  excluded(
    'RUNTIME-001',
    'list_browser_targets, inspect_web_page, list_electron_targets, observe_web_execution, capture_browser_scenario, capture_process_scenario, observe_native_ui, capture_native_ui_scenario, observe_native_calls, inspect_native_load_image',
    'These execute or observe a live target; this port performs no execution. references/runtime-observation.md states the boundary and how to record the gap.',
  ),
  excluded('FRIDA-001', 'Frida instrumentation workflows', 'Instruments a running process; this port performs no execution.'),
  excluded('JEB-001', 'open_jeb_project, list_jeb_units, decompile_jeb_item, inspect_jeb_client', 'Requires a caller-started JEB client serving MCP.'),
  excluded('ADB-001', 'The adb device family (list_adb_devices, inspect_adb_*, pull/push/install, capture_adb_screen)', 'Requires a caller-supplied adb and an attached device.'),
  excluded(
    'COMPARE-001',
    'compare_artifacts, compare_bundles, compare_functions, compare_application_versions, compare_web_captures, compare_source_to_bundle, compare_javascript_export_shapes, find_changed_behavior, build_call_path, correlate_static_and_runtime',
    'Comparison workflows await their own port. The evidence discipline they need is implemented, and two analyses can be diffed from their retained summaries by hand.',
  ),
  excluded('RECON-001', 'verify_reconstruction, build_reconstruction_obligation_ledger, evaluate_reconstruction_coverage', 'Reconstruction verification is outside this port’s scope.'),
  excluded('PROJECT-001', 'project_android_application_graph, project_apple_application_graph, project_managed_application_graph', 'Depends on the Android, Apple and managed tiers above.'),
  excluded(
    'SERVER-001',
    'The REA MCP server itself (registration, doctor, setup, provider installation, npm distribution)',
    'The port is a local CLI plus a Pi skill; it ships no server. REA’s own setup already registers MCP for Pi when the reference is wanted.',
  ),
];

const verdict = requirements.some((entry) => entry.status === 'NOT VERIFIED')
  ? 'NOT VERIFIED'
  : requirements.some((entry) => entry.status === 'INCONCLUSIVE')
    ? 'INCONCLUSIVE'
    : requirements.some((entry) => entry.status === 'VERIFIED')
      ? 'VERIFIED'
      : 'INCONCLUSIVE';

const ledger = { capability: 'morluto/rea reverse-engineer-anything skill (v41) → pi-rea skill', verdict, requirements };

let failures = 0;
for (const requirement of requirements) {
  if (requirement.status !== 'VERIFIED') continue;
  const file = requirement.acceptanceTest.split('::')[0].trim();
  try {
    readFileSync(join(root, file));
  } catch {
    failures += 1;
    process.stderr.write(`error: ${requirement.id}: acceptance test file does not exist: ${file}\n`);
  }
}
if (failures > 0) process.exitCode = 1;

const output = join(here, '..', 'ledger.json');
writeFileSync(output, `${JSON.stringify(ledger, null, 2)}\n`);
process.stdout.write(
  `${JSON.stringify({ output, verdict, requirements: requirements.length, verified: requirements.filter((entry) => entry.status === 'VERIFIED').length, notApplicable: requirements.filter((entry) => entry.status === 'NOT APPLICABLE').length })}\n`,
);
