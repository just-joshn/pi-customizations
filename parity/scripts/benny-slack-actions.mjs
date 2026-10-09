#!/usr/bin/env node
/**
 * Host-neutral Slack actions for Benny parity harness.
 * Uses BENNY_SLACK_BOT_TOKEN / SLACK_BOT_TOKEN. Never prints the token.
 *
 * Usage:
 *   node parity/scripts/benny-slack-actions.mjs read <channel> <thread_ts>
 *   node parity/scripts/benny-slack-actions.mjs reply <channel> <thread_ts> <text...>
 *   node parity/scripts/benny-slack-actions.mjs root-count <channel> <since_ts>
 */
import { writeFileSync } from 'node:fs';

function token() {
  const t = process.env.BENNY_SLACK_BOT_TOKEN || process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error('missing BENNY_SLACK_BOT_TOKEN or SLACK_BOT_TOKEN');
  return t;
}

async function api(method, params = {}) {
  const body = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) body.set(k, String(v));
  }
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token()}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  return res.json();
}

const [cmd, channel, a, ...rest] = process.argv.slice(2);
if (!cmd || !channel) {
  console.error('usage: read|reply|root-count …');
  process.exit(2);
}

if (cmd === 'read') {
  const threadTs = a;
  if (!threadTs) process.exit(2);
  const r = await api('conversations.replies', { channel, ts: threadTs, limit: 200 });
  if (!r.ok) {
    console.error(JSON.stringify({ ok: false, error: r.error }));
    process.exit(1);
  }
  const out = {
    ok: true,
    channel,
    thread_ts: threadTs,
    messages: (r.messages || []).map((m) => ({
      ts: m.ts,
      user: m.user || null,
      bot_id: m.bot_id || null,
      text: m.text || '',
      thread_ts: m.thread_ts || null,
    })),
  };
  process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
  process.exit(0);
}

if (cmd === 'reply') {
  const threadTs = a;
  const text = rest.join(' ').trim();
  if (!threadTs || !text) process.exit(2);
  const r = await api('chat.postMessage', { channel, thread_ts: threadTs, text });
  if (!r.ok) {
    console.error(JSON.stringify({ ok: false, error: r.error }));
    process.exit(1);
  }
  process.stdout.write(`${JSON.stringify({ ok: true, ts: r.ts, channel, thread_ts: threadTs })}\n`);
  process.exit(0);
}

if (cmd === 'root-count') {
  const sinceTs = a;
  const r = await api('conversations.history', { channel, oldest: sinceTs || '0', limit: 50 });
  if (!r.ok) {
    console.error(JSON.stringify({ ok: false, error: r.error }));
    process.exit(1);
  }
  const roots = (r.messages || []).filter((m) => !m.thread_ts || m.thread_ts === m.ts);
  process.stdout.write(`${JSON.stringify({ ok: true, rootMessages: roots.length })}\n`);
  process.exit(0);
}

console.error('unknown cmd');
process.exit(2);
