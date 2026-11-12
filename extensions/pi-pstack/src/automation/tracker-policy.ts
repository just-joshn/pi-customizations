// The trusted tracker-policy reader: the parent's own eligibility check before any tracker write, built from the
// triage pack's "Decide whether to create" and "Dedupe" rules. It reads the source thread and the tracker itself.
// Nothing here takes a fact from the worker's result except the worker's own request and its verdict marker.
//
// Enforced in code, from independent reads:
//   - the verdict marker classifies the report; only bug and performance may touch the tracker (rules 1)
//   - the source root exists in the Slack thread at the frozen coordinates (rule 5)
//   - the configured label for the classification and the intake label resolve; an update or comment target exists,
//     is an issue (not a pull request), and is open (rule 6, and "live" for a target)
//   - this source permalink is not already linked to an issue: no second ticket, no repeated recurrence note
//   - a create finds no open issue with the same title; a duplicate update names an open issue the worker chose
//   - the adapter offers a compensation action (rule 7): `close`
// A tracker reached through a project-owned adapter skill has no reader here, because the parent cannot search it. Its
// tracker-side checks (source already linked, same-title issue, target open) are the first step of that worker's brief,
// which searches before it writes. The Slack-side checks above still hold, and the worker may only name the target the
// worker that triaged chose.
// Judged by the worker, accepted when it asks for the write (the parent cannot read the product):
//   - clearly broken rather than a feature request, and not known to be fixed (rules 2 and 3)
//   - whether two reports share a signature, area, trigger, and symptom; the parent only verifies the target it names
//   - cause tracing, routing, and the wording of the issue
// Not performed by the parent: compensation. The outbox retries a verdict post until it lands, so a created issue is
// closed by an operator through the tracker's `close`, not automatically.
import type { AutomationEvent, TrackerConfig, TrackerEligibility, TrackerIntent } from './model.ts';
import { classificationOf, sourceUrlOf } from './model.ts';
import type { ThreadDestination } from './outbox.ts';
import type { TrackerReader } from './tracker-github.ts';

export interface TrackerPolicyOptions {
  tracker: TrackerConfig;
  /** Absent for a tracker the parent cannot read itself. */
  reader?: TrackerReader;
  destination: ThreadDestination;
  canCompensate: boolean;
}

export function createTrackerPolicy(options: TrackerPolicyOptions): (event: AutomationEvent, intent: TrackerIntent, reply: string) => Promise<TrackerEligibility> {
  const { tracker, reader, destination } = options;
  return async (event, intent, reply) => {
    const classification = classificationOf(reply);
    const sourceVerified = (await destination.readThread(event.channel, event.rootTs).catch(() => [])).some((message) => message.ts === event.rootTs);
    const linked = reader === undefined ? [] : await reader.findBySource(sourceUrlOf(event));
    const labelsResolved = classification !== 'other' && tracker.labels[classification].trim() !== '' && tracker.labels.intake.trim() !== '';
    const base = { classification, sourceVerified, canCompensate: options.canCompensate };
    if (intent.operation === 'create') {
      const duplicate = linked.length > 0 ? 'already-linked' : reader === undefined ? 'none' : (await reader.findOpenByTitle(intent.title ?? '')).length > 0 ? 'possible' : 'none';
      return { ...base, clearlyBroken: true, live: true, duplicate, targetResolved: labelsResolved };
    }
    if (reader === undefined) return { ...base, clearlyBroken: true, live: true, duplicate: intent.targetId === undefined ? 'none' : 'confident', ...(intent.targetId === undefined ? {} : { duplicateId: intent.targetId }), targetResolved: intent.targetId !== undefined };
    const target = intent.targetId === undefined ? undefined : await reader.read(intent.targetId);
    const duplicate = linked.length > 0 ? 'already-linked' : target === undefined ? 'none' : target.state === 'open' ? 'confident' : 'weak';
    return { ...base, clearlyBroken: true, live: target?.state === 'open', duplicate, ...(duplicate === 'confident' && target !== undefined ? { duplicateId: target.id } : {}), targetResolved: target !== undefined };
  };
}
