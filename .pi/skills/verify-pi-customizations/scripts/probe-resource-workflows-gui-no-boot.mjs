import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeLocalSession } from '../helpers/resource-workflows-local.mjs';
import { seedRecipe } from '../helpers/resource-workflows-recipes.mjs';
import { openGuiBridge } from '../helpers/resource-workflows-gui-bridge.mjs';
import { guiDigest } from '../helpers/resource-workflows-gui-lease.mjs';

const sdk = '/Users/josh-desktop/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/dist/index.js';
const sourceRoot = '/tmp/f016-fixed-eeb7e22f';
const quote = text => `'${text.replaceAll("'", "'\\''")}'`;

function runSandbox(fixture, script) {
  return new Promise((resolve, reject) => {
    const child = spawn('/usr/bin/sandbox-exec', ['-f', fixture.profile, process.execPath, script], { cwd: fixture.cwd, env: fixture.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('SDK no-boot deadline')); }, 15000);
    child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 65536) child.kill('SIGKILL'); });
    child.stderr.on('data', chunk => { stderr += chunk; if (stderr.length > 65536) child.kill('SIGKILL'); });
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('exit', code => { clearTimeout(timer); code === 0 ? resolve(JSON.parse(stdout)) : reject(new Error(`SDK no-boot exit ${code} ${stderr.slice(0, 4096)}`)); });
  });
}

function sdkRunner({ cwd, bridge, profile, secret, port }) {
  const raw = body => `const s=require('net').connect(${JSON.stringify(bridge.socket)});let r='';s.on('connect',()=>s.end(${JSON.stringify(body)}));s.on('data',c=>r+=c);s.on('end',()=>process.stdout.write(r));s.on('error',()=>process.exit(2));`;
  const requests = [
    ['missing-capability', { action: 'read' }, 'invalid GUI request'],
    ['wrong-capability', { capability: '0'.repeat(64), action: 'launch' }, 'GUI capability rejected'],
    ...['reply', 'window', 'path', 'png', 'success', 'selector', 'js'].map(key => [key, { capability: bridge.capability, action: 'read', [key]: '../forged' }, 'invalid GUI request']),
  ];
  const calls = [...requests.map(([name, body, expected]) => ({ name, command: `${quote(process.execPath)} -e ${quote(raw(JSON.stringify(body)))}`, expected })),
    ...[['malformed-json', '{', 'invalid GUI JSON'], ['oversized-request', 'x'.repeat(2048), 'GUI request cap']].map(([name, body, expected]) => ({ name, command: `${quote(process.execPath)} -e ${quote(raw(body))}`, expected }))];
  return `import { createBashTool, createWriteTool, createReadTool } from ${JSON.stringify(pathToFileURL(sdk).href)};
const bash = createBashTool(${JSON.stringify(cwd)}), write = createWriteTool(${JSON.stringify(cwd)}), read = createReadTool(${JSON.stringify(cwd)});
const records=[];
async function check(name, tool, params, expected) {
  let text=''; let rejected=false;
  try { const result=await tool.execute(name,params); text=result.content.filter(p=>p.type==='text').map(p=>p.text).join('\\n'); }
  catch(e) { text=e.message; rejected=true; }
  records.push({name,tool:tool.name,passed: expected===null ? rejected : text.includes(expected),result:text.slice(0,1024)});
}
for(const c of ${JSON.stringify(calls)}) await check(c.name,bash,{command:c.command,timeout:3},c.expected);
await check('held-launch',bash,{command:${JSON.stringify(`${quote(process.execPath)} ${quote(bridge.cli)} launch`)},timeout:3},'runtime release held');
await check('extra-arguments',bash,{command:${JSON.stringify(`${quote(process.execPath)} ${quote(bridge.cli)} read ../capture.png`)},timeout:3},'one finite GUI action required');
await check('protected-evidence-write',write,{path:${JSON.stringify(join(bridge.cli, '..', 'blocked.json'))},content:'forbidden'},null);
await check('protected-profile-write',write,{path:${JSON.stringify(profile)},content:${JSON.stringify(readFileSync(profile, 'utf8'))}},null);
await check('sealed-broker-write',write,{path:${JSON.stringify(join(sourceRoot, 'broker.py'))},content:${JSON.stringify(readFileSync(join(sourceRoot, 'broker.py'), 'utf8'))}},null);
await check('symlink-sealed-broker-write',write,{path:${JSON.stringify(join(cwd, 'sealed-broker-alias'))},content:${JSON.stringify(readFileSync(join(sourceRoot, 'broker.py'), 'utf8'))}},null);
for(const name of ['guest.js','Image','rootfs.ext4','initramfs-fixed.gz','vm-launcher']) {
  const code='require("fs").openSync('+JSON.stringify(${JSON.stringify(sourceRoot)}+'/'+name)+',"r+")';
  await check('sealed-open-'+name,bash,{command:${JSON.stringify(quote(process.execPath))}+' -e '+"'"+code.replaceAll("'","'\\\\''")+"'",timeout:3},'EPERM');
}
await check('host-secret-read',read,{path:${JSON.stringify(secret)}},null);
const network='const s=require("net").connect('+${port}+',"127.0.0.1");s.on("connect",()=>{process.stdout.write("UNEXPECTED");s.destroy()});s.on("error",e=>process.stdout.write(e.code));';
await check('non-owned-network',bash,{command:${JSON.stringify(quote(process.execPath))}+' -e '+"'"+network+"'",timeout:3},'EPERM');
process.stdout.write(JSON.stringify(records));
`;
}

export async function runGuiSdkNoBoot({ repoRoot, root, out }) {
  const fixture = makeLocalSession({ root, out, repoRoot, deferSession: true });
  seedRecipe('electron', fixture.cwd, 0, 'unused');
  symlinkSync(join(sourceRoot, 'broker.py'), join(fixture.cwd, 'sealed-broker-alias'));
  const profileBefore = guiDigest(readFileSync(fixture.profile));
  const secretRoot = mkdtempSync(join(homedir(), '.f016-owned-secret-'));
  const secret = join(secretRoot, 'sentinel');
  writeFileSync(secret, 'owned-no-boot-secret', { mode: 0o600 });
  const forbidden = createServer(client => client.destroy());
  await new Promise(done => forbidden.listen(0, '127.0.0.1', done));
  let bridge;
  try {
    bridge = await openGuiBridge({ kind: 'electron', root, out, cwd: fixture.cwd });
    const script = join(out, 'gui-sdk-no-boot.mjs');
    writeFileSync(script, sdkRunner({ cwd: fixture.cwd, bridge, profile: fixture.profile, secret, port: forbidden.address().port }), { mode: 0o400, flag: 'wx' });
    const sdkInvocations = await runSandbox(fixture, script);
    const report = { verdict: 'FAILED', noBoot: true, scope: 'actual native SDK tools under unchanged owned fixture Seatbelt, no model/session/prompt/VM constructor', profileBefore, profileAfter: guiDigest(readFileSync(fixture.profile)), sdkSha256: guiDigest(readFileSync(sdk)), sdkInvocations, lease: bridge.snapshot() };
    writeFileSync(join(out, 'gui-no-boot.json'), `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    return report;
  } finally {
    await bridge?.close();
    await new Promise(done => forbidden.close(done));
    rmSync(secretRoot, { recursive: true, force: true });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = mkdtempSync('/tmp/f016-gui-preparation-');
  const report = await runGuiSdkNoBoot({ repoRoot: process.cwd(), root, out: join(root, 'protected') });
  process.stdout.write(`${JSON.stringify({ root, ...report }, null, 2)}\n`);
  if (report.sdkInvocations.some(record => !record.passed) || report.profileBefore !== report.profileAfter) process.exitCode = 1;
}
