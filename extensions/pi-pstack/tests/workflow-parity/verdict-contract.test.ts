import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { expect, test } from 'vitest';
import { inheritedFailureOnly, testAt, verdictsOf } from './families/pr-shipping.ts';
import type { ForgeAction, ForgeState } from './fixtures/forge.ts';
import { bareOf } from './fixtures/forge.ts';
import type { RunView } from './lib/view.ts';

const head = 'a'.repeat(40);
const state = { prs: { 21: { author: 'owner' } } } as unknown as ForgeState;
const view = { sandbox: '/nonexistent', runs: [{ workers: [{ id: 'v', assignment: { workerId: 'v', role: 'verifier', workspace: { inputCommit: head } } }] }] } as unknown as RunView;
const action = (body: string, worker = 'v'): ForgeAction => ({ kind: 'comment', pr: 21, worker, body, run: 'r', actor: '', container: true });

test('a verifier can post the skill verdict without an invented comment protocol', () => {
  expect(verdictsOf(state, [action('PASS: the user behavior works.')], view)).toMatchObject([{ pr: 21, verdict: 'PASS', head, author: 'v', verifier: 'v' }]);
});
test.each([`# PR 21 verification: PASS\nVerified head ${head}`, `**FAIL** at ${head.slice(0, 7)}`])('verdict headings and Markdown preserve the verdict: %s', (body) => {
  expect(verdictsOf(state, [action(body)], view)).toMatchObject([{ verdict: body.includes('FAIL') ? 'FAIL' : 'PASS', head }]);
});

test('an explicit verdict for another PR or head is not silently assigned to this head', () => {
  expect(verdictsOf(state, [action('# PR 22 verification: PASS')], view)).toEqual([]);
  expect(verdictsOf(state, [action('PASS at bbbbbbb')], view)[0]?.head).not.toBe(head);
});

test.each(['ISSUES', 'BLOCKED'])('a swarm %s verdict is not a clean shipping verdict', (verdict) => {
  expect(verdictsOf(state, [action(`${verdict} at ${head}`)], view)).toMatchObject([{ verdict: 'FAIL', head }]);
});

test('a stray mention or an unidentified reviewer does not establish a verdict at a head', () => {
  expect(verdictsOf(state, [action('CI says PASS, not a user verdict')], view)).toEqual([]);
  expect(verdictsOf(state, [action('PASS: works', 'unknown')], view)).toEqual([]);
});

test('independent replay checks the full package suite when that is the verdict claim', () => {
  const sandbox = mkdtempSync(join(tmpdir(), 'verdict-suite-'));
  const repo = join(sandbox, 'repo');
  const git = (...args: string[]) => execFileSync('git', ['-C', repo, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  try {
    mkdirSync(join(repo, 'test'), { recursive: true });
    writeFileSync(join(repo, 'package.json'), JSON.stringify({ scripts: { test: 'node --test' } }));
    writeFileSync(join(repo, 'test/own.test.js'), "require('node:assert/strict').equal(3, 3);\n");
    git('init', '-b', 'main');
    git('config', 'user.email', 'checker@example.test');
    git('config', 'user.name', 'Checker');
    git('add', '.');
    git('commit', '-m', 'passing suite');
    mkdirSync(join(sandbox, 'forge'));
    execFileSync('git', ['clone', '--bare', repo, bareOf(sandbox)], { stdio: 'pipe' });
    expect(testAt({ sandbox }, git('rev-parse', 'HEAD'), undefined)).toBe(true);

    writeFileSync(join(repo, 'test/inherited.test.js'), "require('node:assert/strict').equal(3, 2);\n");
    git('add', '.');
    git('commit', '-m', 'inherited failure');
    git('push', bareOf(sandbox), 'HEAD:refs/heads/main');
    const failing = git('rev-parse', 'HEAD');
    expect(testAt({ sandbox }, failing, 'test/own.test.js')).toBe(true);
    expect(testAt({ sandbox }, failing, undefined)).toBe(false);
    writeFileSync(join(repo, 'test/own.test.js'), "require('node:assert/strict').equal(4, 4);\n");
    git('add', '.');
    git('commit', '-m', 'own change above inherited failure');
    git('push', bareOf(sandbox), 'HEAD:refs/heads/main');
    expect(inheritedFailureOnly({ sandbox }, failing, git('rev-parse', 'HEAD'))).toBe(true);
    writeFileSync(join(repo, 'test/new.test.js'), "require('node:assert/strict').equal(4, 3);\n");
    git('add', '.');
    git('commit', '-m', 'new regression');
    git('push', bareOf(sandbox), 'HEAD:refs/heads/main');
    expect(inheritedFailureOnly({ sandbox }, failing, git('rev-parse', 'HEAD'))).toBe(false);
  } finally {
    rmSync(sandbox, { recursive: true, force: true });
  }
});
