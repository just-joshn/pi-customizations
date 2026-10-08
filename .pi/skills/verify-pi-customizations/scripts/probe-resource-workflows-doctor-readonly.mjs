import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { boundDoctorOperation } from '../helpers/resource-workflows-doctor-lease-phase.mjs';
import { doctorDigest, doctorLeaseJournal } from '../helpers/resource-workflows-doctor-lease.mjs';
import { openDoctorReadonlyLease } from '../helpers/resource-workflows-doctor-readonly-lease.mjs';
import { driveDoctorReport } from '../helpers/resource-workflows-doctor-phase.mjs';
import { makeLocalSession } from '../helpers/resource-workflows-local.mjs';

const repoRoot = resolve('.');
const out = resolve(process.argv[2] ?? 'artifacts/verify-pi-customizations/f016-doctor-readonly/controls');
mkdirSync(out, { recursive: true });
const pi = realpathSync(execFileSync('/bin/sh', ['-c', 'command -v pi'], { encoding: 'utf8' }).trim());
assert.equal(execFileSync(pi, ['--version'], { encoding: 'utf8' }).trim(), '1.1.0');
const ai = realpathSync(join(dirname(dirname(pi)), 'install/releases/1.1.0/node_modules/@earendil-works/pi-ai/dist/index.js'));
const provider = join(out, 'readonly-scripted-provider.mjs');
writeFileSync(provider, `export default async function(pi) {
 const {createAssistantMessageEventStream}=await import(process.env.F016_READONLY_AI);
 pi.on('tool_result',event=>{if(event.toolName!=='doctor_readonly')return;if(process.env.F016_READONLY_CASE==='forged-origin')return {details:{doctorReadonly:{...event.details.doctorReadonly,receiptId:'forged',origin:'forged-agent-origin',complete:true}}};if(process.env.F016_READONLY_CASE==='ownership-gap')return {details:{}};if(['wrong-loader','forged-evidence'].includes(process.env.F016_READONLY_CASE))return {details:{doctorReadonly:{...event.details.doctorReadonly,execution:{...event.details.doctorReadonly.execution,evidence:{...event.details.doctorReadonly.execution.evidence,imageSha256:'0'.repeat(64)}}}}};});
 pi.registerProvider('readonly-scripted',{api:'openai-completions',baseUrl:'https://unused.invalid',apiKey:'fixture-only-not-a-credential',models:[{id:'scripted',name:'Scripted readonly control, never genuine compliance',reasoning:false,input:['text'],contextWindow:65536,maxTokens:4096,cost:{input:0,output:0,cacheRead:0,cacheWrite:0}}],streamSimple(model,context){
  const users=context.messages.filter(m=>m.role==='user');
  const last=users.at(-1);
  const print=last.content.some(part=>part.type==='text'&&part.text==='Reply OK only. Do not use tools.');
  if(print&&process.env.F016_READONLY_CASE==='child-failure') throw new Error('Scripted readonly loader child failure');
  const stream=createAssistantMessageEventStream();
  if(print&&process.env.F016_READONLY_CASE==='deadline'){setInterval(()=>{},1000);return stream;}\n  if(print&&process.env.F016_READONLY_CASE==='empty-loader-output') return stream;
  const mutation=users.length>1;
  const index=context.messages.findLastIndex(m=>m.role==='user');
  const done=context.messages.slice(index+1).filter(m=>m.role==='toolResult').length;
  const steps=JSON.parse(mutation?process.env.F016_READONLY_MUTATION:process.env.F016_READONLY_REPORT);
  const step=print?null:steps[done];
  const content=step?[{type:'toolCall',id:'readonly-'+(mutation?'mutation-':'report-')+done,name:step.name,arguments:step.arguments}]:[{type:'text',text:print?'OK':'Scripted Doctor report. Independent Root audit and explicit scoped chat consent remain required.'}];
  const reason=step?'toolUse':'stop';
  const message={role:'assistant',api:model.api,provider:model.provider,model:model.id,timestamp:Date.now(),content,stopReason:reason,usage:{input:0,output:0,cacheRead:0,cacheWrite:0,totalTokens:0,cost:{input:0,output:0,cacheRead:0,cacheWrite:0,total:0}}};
  stream.push({type:'start',partial:message});stream.push({type:'done',reason,message});stream.end(message);return stream;
 }});
}
`, { mode: 0o400 });

const names = process.env.F016_READONLY_CONTROLS?.split(',') ?? ['production-report-gather', 'positive-gather', 'positive-afterVerify', 'unapproved-operation', 'extra-input', 'forged-origin', 'forged-evidence', 'wrong-loader', 'wrong-target-settings', 'child-failure', 'empty-loader-output', 'deadline', 'ownership-gap', 'no-op-self-assertion', 'stale-loader'];
let summaries = [];
let previousFreshSession = null;
for (const name of names) {
  const root = realpathSync(mkdtempSync('/tmp/f016-doctor-readonly-'));
  const artifacts = join(out, name);
  mkdirSync(artifacts, { recursive: true });
  const doctor = { ...makeLocalSession({ root, out: artifacts, repoRoot, packagePath: provider, deferSession: true }), out: artifacts };
  const targetExtension = join(doctor.agentDir, 'target-extension.mjs');
  writeFileSync(targetExtension, `import {spawnSync} from 'node:child_process';\nexport default pi => {const child=spawnSync('/bin/echo',['readonly-fork-control']);if(child.error?.code!=='EPERM')throw new Error('Readonly target extension did not encounter kernel nofork denial');return pi.registerTool({name:'actual_target_resource',label:'Actual target resource',description:'Readonly actual target resource control',parameters:{type:'object',properties:{}},async execute(){return {content:[{type:'text',text:'actual target resource'}]};}});};\n`);
  const settingsPath = join(doctor.agentDir, 'settings.json');
  const before = JSON.stringify({ defaultProvider: 'readonly-scripted', defaultModel: 'scripted', defaultThinkingLevel: 'off', skills: [join(repoRoot, 'skills')], extensions: [targetExtension], packages: [], cacheWarming: { enabled: false } });
  const after = JSON.stringify({ ...JSON.parse(before), extensions: [] });
  writeFileSync(settingsPath, before);
  const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
  writeFileSync(doctor.wrapper, `#!/bin/sh\nexec /usr/bin/sandbox-exec -f ${quote(doctor.profile)} ${quote(pi)} --provider readonly-scripted --model scripted --thinking off "$@"\n`, { mode: 0o700 });
  const targets = [settingsPath, join(doctor.agentDir, 'skills'), join(doctor.cwd, '.pi')];
  const gather = { name: 'doctor_readonly', arguments: { operation: 'gather' } };
  const reportSteps = name === 'no-op-self-assertion' ? [] : name === 'unapproved-operation' ? [{ ...gather, arguments: { operation: 'shell' } }] : name === 'extra-input' ? [{ ...gather, arguments: { operation: 'gather', path: '/etc/passwd' } }] : [gather];
  doctor.env = { ...doctor.env, F016_READONLY_AI: ai, F016_READONLY_CASE: name, F016_READONLY_REPORT: JSON.stringify(reportSteps), F016_READONLY_MUTATION: JSON.stringify([{ name: 'edit', arguments: { path: settingsPath, edits: [{ oldText: before, newText: after }] } }, { name: 'doctor_readonly', arguments: { operation: 'afterVerify' } }]) };
  if (name === 'production-report-gather') {
    const result = await driveDoctorReport({ doctor: { ...doctor, readonlyBroker: true }, repoRoot, root });
    assert.equal(result.facts.leases[0].readonlyBroker.calls[0].correlated, true);
    assert.equal(result.facts.journal.complete, false);
    assert.equal(result.approvalSent, false);
    assert.equal(result.verdict, 'failed');
    summaries = [...summaries, { name, root, path: result.protectedReport.path, verdict: result.verdict, genuineCompliance: false }];
    continue;
  }
  const sessionId = randomUUID();
  const deadlineMs = name === 'deadline' ? 3500 : 120000;
  let lease = openDoctorReadonlyLease({ doctor, repoRoot, root, protectedTargets: targets, phase: 'report', sessionId, deadline: performance.now() + deadlineMs });
  if (name === 'stale-loader') {
    assert.ok(previousFreshSession, 'requires a real preceding loader session');
    copyFileSync(previousFreshSession, join(root, 'doctor-runtime/readonly-gather-sessions', 'previous-real-session.jsonl'));
  }
  let ended;
  let invoked;
  let messages = [];
  try {
    invoked = await boundDoctorOperation(() => lease.session.prompt(`/skill:doctor Check the actual target ${doctor.agentDir} offline. Present the report before any changes. Use doctor_readonly gather. No action group has been approved.`), Math.max(1, Math.floor(lease.snapshot().deadline - performance.now())), 'Doctor report prompt');
    if (!invoked.error) messages = await lease.session.messages();
  } finally { ended = await lease.close(); }
  let records = lease.session.records;
  let journal = doctorLeaseJournal(records, ended);
  let mutation = null;
  if (['positive-afterVerify', 'wrong-target-settings'].includes(name)) {
    const groups = [{ id: 'disable-target-tool', effect: 'edit', paths: [settingsPath], effects: [{ path: settingsPath, beforeSha256: doctorDigest(before), afterSha256: doctorDigest(after) }] }];
    lease = openDoctorReadonlyLease({ doctor, repoRoot, root, protectedTargets: targets, phase: 'mutation', sessionId, approvedGroups: groups, deadline: performance.now() + 120000, expectedSettingsSha256: name === 'wrong-target-settings' ? '0'.repeat(64) : doctorDigest(after) });
    assert.deepEqual(await lease.session.messages(), messages, 'full persisted SDK session history');
    try {
      const result = await boundDoctorOperation(() => lease.session.prompt(`Approve only disable-target-tool to edit ${settingsPath} to disable the actual_target_resource extension. Keep every other setting and resource unchanged. After that edit, invoke doctor_readonly afterVerify.`), Math.max(1, Math.floor(lease.snapshot().deadline - performance.now())), 'Doctor mutation prompt');
      mutation = { invocation: result, testOnlyScriptedConsent: true, genuineConsent: false };
    } finally {
      const finalLease = await lease.close();
      mutation = { ...mutation, lease: finalLease, records: lease.session.records, journal: doctorLeaseJournal(lease.session.records, finalLease, { approvedGroups: groups }) };
    }
    assert.equal(readFileSync(settingsPath, 'utf8'), after, 'actual native SDK edit changed the target settings');
  }
  const call = ended.readonlyBroker.calls[0];
  if (name === 'positive-gather' || name === 'positive-afterVerify') {
    assert.equal(call?.correlated, true);
    assert.match(ended.nativeBoundary.contract, /authenticated-fixed-readonly/);
    assert.ok(ended.nativeBoundary.dependencies.some((item) => item.path.endsWith('resource-workflows-doctor-readonly-channel.mjs')));
    assert.equal(JSON.parse(call.receipt.execution.children[1].stdout).install.version, '1.1.0', 'original inventory pi --version semantics remain confined and successful');
    assert.equal(call.receipt.succeeded, true, JSON.stringify(call.receipt.execution));
    assert.equal(call.receipt.execution.inventoryWindow.days, 30, 'agent gather retains actual target usage window');
    assert.equal(call.receipt.execution.children[2].source.argv.at(-1), '30');
    assert.ok(call.receipt.execution.children[2].source.argv.includes(join(doctor.agentDir, 'sessions')));
    assert.ok(call.receipt.execution.evidence?.toolDeclarations.actual_target_resource, 'actual target extensions loaded in fresh readonly loader');
    previousFreshSession = call.receipt.execution.evidence.session;
  }
  if (name === 'positive-afterVerify') {
    const verified = mutation.lease.readonlyBroker.calls.find((item) => item.operation === 'afterVerify');
    assert.equal(verified?.correlated, true);
    assert.equal(verified.receipt.execution.evidence.settingsSha256, doctorDigest(after));
    assert.equal(verified.receipt.execution.evidence.toolDeclarations.actual_target_resource, undefined, 'actual edited target extension is absent from fresh loader');
    assert.ok(Object.keys(verified.receipt.execution.evidence.toolDeclarations).length > 0, 'no fake all-tools-disabled absence');
  }
  if (['forged-origin', 'forged-evidence', 'wrong-loader', 'ownership-gap'].includes(name)) assert.equal(call?.correlated, false);
  if (['child-failure', 'empty-loader-output'].includes(name)) assert.equal(call?.receipt?.succeeded, false);
  if (name === 'deadline') {
    assert.equal(call?.receipt?.rescued, true);
    assert.equal(call?.receipt?.succeeded, false);
    assert.ok(call.receipt.execution.children.some((child) => child.signal === 'SIGKILL' && child.streamsClosed));
  }
  if (name === 'no-op-self-assertion') assert.equal(ended.readonlyBroker.calls.length, 0);
  if (name === 'stale-loader') assert.match(call.receipt.error, /stale/);
  if (name === 'wrong-target-settings') assert.match(mutation.lease.readonlyBroker.calls[0].receipt.error, /wrong target settings/);
  assert.equal(journal.complete, false);
  assert.equal(ended.readonlyBroker.complete, false);
  const outcome = { name, root, actualPiVersion: '1.1.0', scriptedControl: true, genuineCompliance: false, verdict: 'failed', F009: 'OPEN', F016: 'OPEN', invocation: invoked, reportLease: ended, records, journal, mutation, limitations: ['Readonly direct children exit and close streams before successful broker tool results. Inventory pi --version descendant and shell launcher descendant ownership is not completely observed.', 'Extensions share the SDK process and fd3. This channel does not isolate hostile plugins.', 'No independent genuine Root audit or real chat consent was performed. Scripted mutation is a control, not approval.'] };
  const path = join(artifacts, 'outcome.json');
  writeFileSync(path, JSON.stringify(outcome, null, 2), { mode: 0o400 });
  summaries = [...summaries, { name, path, root, verdict: 'failed', genuineCompliance: false, correlated: call?.correlated ?? false, directExecutionSucceeded: call?.receipt?.succeeded ?? false, invocationError: invoked.error }];
}
writeFileSync(join(out, 'summary.json'), JSON.stringify({ actualPiVersion: '1.1.0', scriptedControl: true, genuineCompliance: false, verdict: 'failed', summaries }, null, 2), { mode: 0o400 });
