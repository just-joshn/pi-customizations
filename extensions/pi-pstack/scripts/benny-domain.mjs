const defaultMarkers = { bug: '[benny:bug]', performance: '[benny:performance]', other: '[benny:other]' };
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid Benny input.');
  return value;
}
export function freezeSource(config, input) {
  const trigger = object(input);
  if (!config.sourceChannel || trigger.source_channel_id !== config.sourceChannel) throw new Error('Benny source channel does not match configuration.');
  const thread = trigger.thread_ts || trigger.message_ts || trigger.ts;
  if (typeof thread !== 'string' || !/^\d+\.\d{6}$/.test(thread)) throw new Error('Benny source timestamp is missing or invalid.');
  return Object.freeze({ channel: config.sourceChannel, thread });
}
export function parseVerdict(text, markers = defaultMarkers) {
  if (typeof text !== 'string') return undefined;
  const entries = Object.entries(markers);
  if (entries.length !== 3 || entries.some(([kind, marker]) => !['bug', 'performance', 'other'].includes(kind) || typeof marker !== 'string' || !marker)) throw new Error('Invalid Benny marker configuration.');
  const count = entries.reduce((total, [, marker]) => total + text.split(marker).length - 1, 0);
  if (count !== 1) return undefined;
  const last = text.trim().split('\n').at(-1) ?? '';
  const selected = entries.find(([, marker]) => last === marker || last.startsWith(`${marker} tracker=`));
  if (!selected) return undefined;
  const [kind, marker] = selected;
  const tracker = last.slice(marker.length + ' tracker='.length);
  if (last !== marker && (!tracker || kind === 'other' || !/^https?:\/\/[^\s]+$/.test(tracker))) return undefined;
  return { kind: kind, ...(tracker ? { tracker } : {}) };
}
export function trustedVerdict(config, source, input) {
  const message = object(input);
  if (!config.triageIdentity || message.user !== config.triageIdentity || message.channel !== source.channel || message.thread_ts !== source.thread || typeof message.text !== 'string') return undefined;
  const verdict = parseVerdict(message.text, config.markers);
  if (!verdict || verdict.kind === 'other') return undefined;
  return { ...verdict, kind: verdict.kind };
}
export function fixDecision(evidence) {
  if (evidence.existingFix === true) return 'verify-existing';
  const gates = [evidence.mediaConfirmed, evidence.runtimeCause, evidence.rejectionWindowClosed, evidence.budgetRemaining, evidence.baselineAndPatchedControl];
  return Number.isSafeInteger(evidence.baselineReproductions) && evidence.baselineReproductions >= 2 && evidence.humanOwnsFix === false && gates.every((value) => value === true) ? 'fix' : 'stop';
}
export function canCreateIssue(input) {
  return ['bug', 'performance'].includes(input.classification) && input.clearlyBroken === true && input.stillLive === true && input.duplicate === 'none' && input.targetResolved === true && /^https?:\/\/[^\s]+$/.test(input.permalink);
}
