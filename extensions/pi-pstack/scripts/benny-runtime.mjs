import { canCreateIssue, parseVerdict } from './benny-domain.mjs';

async function preflight(source, adapter) {
  if (!source?.channel || !/^\d+\.\d{6}$/.test(source.thread)) throw new Error('Benny source parent coordinates are missing.');
  const parent = await adapter.parent(source);
  if (!parent?.exists || parent.channel !== source.channel || parent.thread !== source.thread) throw new Error('Benny source parent preflight failed. No fallback post is allowed.');
  return parent;
}

async function compensate(adapter, issue) {
  if (!issue) return 'no issue was created';
  try {
    await adapter.compensate(issue);
    return (await adapter.verifyCompensation(issue)) ? 'created issue compensated' : 'compensation is unverified; inspect the run output';
  } catch {
    return 'compensation failed; inspect the run output';
  }
}

export async function deliverVerdict(coordinates, adapter, text, issueDraft) {
  const source = Object.freeze({ channel: coordinates.channel, thread: coordinates.thread });
  if (!parseVerdict(text, adapter.verdictMarkers)) throw new Error('Benny verdict requires exactly one marker.');
  const parent = await preflight(source, adapter);
  if (parent.verdictExists) return { kind: 'already-triaged' };
  if (issueDraft && (!canCreateIssue(issueDraft.eligibility) || typeof adapter.compensate !== 'function' || typeof adapter.verifyCompensation !== 'function')) throw new Error('Benny issue creation gate failed.');
  let state = { kind: 'not-attempted' };
  try {
    if (issueDraft) {
      state = { kind: 'creating' };
      const created = await adapter.createIssue(issueDraft);
      if (typeof created !== 'string' || !created) throw new Error('Issue creation returned no identity.');
      state = { kind: 'created', issue: created };
    }
    const issue = state.issue;
    if ((await preflight(source, adapter)).verdictExists) throw new Error('The source was triaged during preparation.');
    const reply = await adapter.reply(source, text, issue);
    if (typeof reply !== 'string' || !reply || !(await adapter.verifyReply(source, reply))) throw new Error('Verdict reply was not verified.');
    return { kind: 'delivered', reply, ...(issue ? { issue } : {}) };
  } catch {
    const outcome = state.kind === 'creating' ? 'issue creation is ambiguous; reconcile its source permalink before retrying' : await compensate(adapter, state.issue);
    throw new Error(`Benny thread handoff failed; ${outcome}. No source root retry was made.`);
  }
}
