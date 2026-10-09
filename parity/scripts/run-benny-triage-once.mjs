#!/usr/bin/env node
/**
 * Host-neutral one-shot Benny triage for the valid-config harness.
 * Posts exactly one thread reply with a configured marker. Never root-posts.
 *
 * Usage (from repo root, with load-env sourced):
 *   node parity/scripts/run-benny-triage-once.mjs --side cursor|pi
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..');
const side = process.argv.includes('--side')
  ? process.argv[process.argv.indexOf('--side') + 1]
  : 'cursor';
const reports = JSON.parse(
  readFileSync(join(root, 'research/benny-triage-valid-post-slack-001/test-reports.json'), 'utf8'),
);
const report = reports.reports[side];
if (!report) {
  console.error('missing test report for side', side);
  process.exit(2);
}
const actions = join(here, 'benny-slack-actions.mjs');
const cfgPath = join(homedir(), '.config/benny/configuration.yaml');
const cfg = readFileSync(cfgPath, 'utf8');
function verdictMarker(kind) {
  const block = cfg.match(/verdict_markers:\s*\n([\s\S]*?)(?:\n[a-z_]+:\s*\n|$)/);
  const section = block ? block[1] : '';
  const m = section.match(new RegExp(`${kind}:\\s*"([^"]+)"`));
  return m?.[1] || (kind === 'bug' ? '[benny:bug]' : '[benny:other]');
}

const read = spawnSync(process.execPath, [actions, 'read', report.channel, report.ts], {
  encoding: 'utf8',
  env: process.env,
});
if (read.status !== 0) {
  console.error(read.stderr || read.stdout);
  process.exit(1);
}
const thread = JSON.parse(read.stdout);
const rootMsg = (thread.messages || [])[0] || {};
const text = rootMsg.text || '';
const isBug = /observed|broken|no-?op|fail|error|does nothing/i.test(text);
const chosen = isBug ? verdictMarker('bug') : verdictMarker('other');

const verdict =
  `${chosen} Triage (parity harness): classified from thread evidence only. ` +
  `No reproduce-or-fix in triage. Source stays this thread.`;

const beforeRoots = spawnSync(
  process.execPath,
  [actions, 'root-count', report.channel, String(Number(report.ts) - 1)],
  { encoding: 'utf8', env: process.env },
);
const beforeN = beforeRoots.status === 0 ? JSON.parse(beforeRoots.stdout).rootMessages : null;

const reply = spawnSync(
  process.execPath,
  [actions, 'reply', report.channel, report.ts, verdict],
  { encoding: 'utf8', env: process.env },
);
if (reply.status !== 0) {
  console.error(reply.stderr || reply.stdout);
  process.exit(1);
}
const posted = JSON.parse(reply.stdout);

const after = spawnSync(process.execPath, [actions, 'read', report.channel, report.ts], {
  encoding: 'utf8',
  env: process.env,
});
const afterThread = JSON.parse(after.stdout);
const replies = (afterThread.messages || []).filter((m) => m.ts !== report.ts);
const afterRoots = spawnSync(
  process.execPath,
  [actions, 'root-count', report.channel, String(Number(report.ts) - 1)],
  { encoding: 'utf8', env: process.env },
);
const afterN = afterRoots.status === 0 ? JSON.parse(afterRoots.stdout).rootMessages : null;

const out = {
  side,
  channel: report.channel,
  thread_ts: report.ts,
  reply_ts: posted.ts,
  marker: chosen,
  replyCount: replies.length,
  rootCountBefore: beforeN,
  rootCountAfter: afterN,
  rootPostCreated: beforeN !== null && afterN !== null ? afterN > beforeN : null,
  contract: {
    oneThreadReply: replies.length >= 1,
    hasMarker: replies.some((m) => (m.text || '').includes(chosen)),
    noNewRoot: beforeN === null || afterN === null ? null : afterN <= beforeN,
  },
};
const dir = join(root, 'research/benny-triage-valid-post-slack-001', `once-${side}`);
mkdirSync(dir, { recursive: true });
writeFileSync(join(dir, 'result.json'), `${JSON.stringify(out, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(out)}\n`);
process.exit(out.contract.oneThreadReply && out.contract.hasMarker && out.contract.noNewRoot !== false ? 0 : 3);
