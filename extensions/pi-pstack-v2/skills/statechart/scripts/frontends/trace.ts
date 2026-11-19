import { EC, type Message, type Part, type Trace, type TraceState } from "../ir.ts";
import { actionOf, messageState, textOf } from "./messages.ts";

const isInitialViolation = (m: Message) =>
  m.code === EC.TLC_INVARIANT_VIOLATED_INITIAL || m.code === EC.TLC_PROPERTY_VIOLATED_INITIAL;

/** The state a TLC state-print or initial-violation message shows, if it shows one. */
export const stateOf = (m: Message): TraceState | undefined => {
  const action = m.code === EC.TLC_STATE_PRINT2 ? actionOf(m) : undefined;
  if (action !== undefined) return { action, vars: messageState(m) };
  return isInitialViolation(m) ? { action: "", vars: messageState(m) } : undefined;
};

const backTo = (m: Message) =>
  m.code === EC.TLC_BACK_TO_STATE && /^(\d+): Back to state: /.exec(textOf(m));

export function* traceStates(messages: Iterable<Part>) {
  for (const m of messages) {
    if (typeof m === "string") continue;
    if (m.code === EC.TLC_STATE_PRINT3 || backTo(m)) return m;
    const state = stateOf(m);
    if (state) yield state;
  }
  return undefined;
}

export function readTrace(messages: Iterable<Part>): Trace {
  let ender: Message | undefined;
  const seq: Trace["seq"] = Array.from(
    (function* () {
      ender = yield* traceStates(messages);
    })(),
  );
  const back = ender && backTo(ender);
  if (ender?.code === EC.TLC_STATE_PRINT3) return { seq, loop: seq.length - 1 };
  if (!back || !ender) return { seq, loop: undefined };
  const loop = Number(back[1]) - 1;
  return { seq: [...seq, { action: actionOf(ender) ?? "", vars: seq[loop]?.vars }], loop };
}
