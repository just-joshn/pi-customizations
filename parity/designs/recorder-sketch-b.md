# PTY recorder sketch B: session-object-first

Structural thesis. One mutable `Session` owns the PTY, the process tree, the attempt directory and the in-memory record. Events are a read-only projection of that state. Disk is a snapshot serializer plus raw byte blobs, not the source of truth.

## Problem

Operators need reproducible recordings of real terminal programs driven by literal keys, resizes and cancellation. Maintainers need interrupted attempts retained and a boundary small enough to test with a real PTY. The frame (`pty-recorder-frame.md`) requires that dispatch intent, process start, output bytes and exit stay distinct, that raw bytes stay recoverable, and that no verdict leaks in.

Constraints from grounding (`pty-recorder-grounding.md`) that this design honors.

- `control-pi` uses pipes, not a PTY, and silently drops malformed JSON. The recorder must not inherit either behavior.
- `routine-secret-pty.py` holds bytes in memory and discards timing and order. The recorder must not be repurposed for credential capture.
- `check-preflight.mjs` owns BLOCKED and acceptance state. The recorder writes nothing it reads and exposes no verdict.
- `parity/evidence/cursor-first-run/` is preliminary evidence and is never touched.
- Pi and Cursor own their UI and agent loops. The recorder only attaches a slave terminal and observes.

Structural constraint for B. The session object owns lifecycle. Persistence serializes session state, with an optional event projection.

## Usage (caller's view)

```ts
import { openAttempt, loadAttempt } from "./recorder";

const session = await openAttempt({
  outDir: "/abs/evidence/attempt-0007",       // must not exist
  fixtureRoot: "/abs/fixtures/term-probe",     // owned, resettable
  side: "pi",
  command: { file: "/abs/bin/probe", args: ["--tty-report"] },
  geometry: { rows: 24, cols: 80 },
  publicEnv: { TERM: "xterm-256color" },       // allowlist only
  bindings: { executable: "/abs/bin/probe" },  // hashed by the recorder
});

await session.start();
await session.write(new Uint8Array([0x68, 0x69, 0x0d]));
await session.resize({ rows: 40, cols: 100 });
const outcome = await session.wait({ timeoutMs: 5000 });  // or session.cancel("test over")

const snap = session.snapshot();            // plain readonly data
const events = session.events();            // projection, ordered
const raw = await session.readOutput();     // exact bytes, no decoding
```

Recovering an interrupted attempt in a later process.

```ts
const prior = await loadAttempt("/abs/evidence/attempt-0007");
// prior.snapshot().outcome.kind === "interrupted" when never sealed
```

Edge calls the caller makes: missing executable is `start()` returning normally with a `launch-failed` outcome, not a throw. Immediate exit is an ordinary `exited` outcome after output drains. `cancel()` is idempotent.

## Shape

### Data shape

The central type is the session state, a single record that is replaced (not patched in place) on each transition. Mutation lives in the one `Session` class. The state value itself is immutable and every snapshot is a frozen copy.

```ts
type AttemptId = string & { readonly __brand: "AttemptId" };
type Side = "cursor" | "pi" | "fixture";

interface Geometry { readonly rows: number; readonly cols: number }

interface TimeStamp { readonly monoNs: bigint; readonly utc: string }

interface Identity {
  readonly attemptId: AttemptId;
  readonly side: Side;
  readonly fixtureRef: string;
  readonly geometry: Geometry;               // initial
  readonly command: { readonly file: string; readonly args: readonly string[] };
  readonly publicEnv: Readonly<Record<string, string>>;
  readonly executableSha256: string | null;  // null only when file is missing
  readonly bindings: Readonly<Record<string, string>>; // path -> sha256
  readonly platform: string;
}

// Raw bytes live in two append-only blobs. The table indexes them.
type Chunk =
  | { readonly seq: number; readonly dir: "output"; readonly offset: number; readonly length: number; readonly at: TimeStamp }
  | { readonly seq: number; readonly dir: "input";  readonly offset: number; readonly length: number; readonly at: TimeStamp; readonly ack: TimeStamp | null };

type Action =
  | { readonly seq: number; readonly kind: "resize"; readonly to: Geometry; readonly at: TimeStamp; readonly ack: TimeStamp | null }
  | { readonly seq: number; readonly kind: "cancel"; readonly reason: string; readonly at: TimeStamp };

type Phase =
  | { readonly tag: "opened"; readonly launchIntent: TimeStamp }
  | { readonly tag: "running"; readonly launchIntent: TimeStamp; readonly started: TimeStamp; readonly pid: number }
  | { readonly tag: "sealed"; readonly launchIntent: TimeStamp; readonly started: TimeStamp | null; readonly pid: number | null; readonly outcome: Outcome };

type Outcome =
  | { readonly kind: "exited"; readonly code: number; readonly at: TimeStamp }
  | { readonly kind: "signaled"; readonly signal: string; readonly at: TimeStamp }
  | { readonly kind: "launch-failed"; readonly errno: string; readonly at: TimeStamp }
  | { readonly kind: "cancelled"; readonly cause: Outcome & { kind: "exited" | "signaled" }; readonly at: TimeStamp }
  | { readonly kind: "interrupted" };  // synthesized only by loadAttempt

interface SessionState {
  readonly identity: Identity;
  readonly phase: Phase;
  readonly chunks: readonly Chunk[];
  readonly actions: readonly Action[];
  readonly errors: readonly { readonly seq: number; readonly at: TimeStamp; readonly message: string }[];
}
```

Invariants carried by types.

- `Phase` is a closed union. `launch-failed` is the only sealed form where `started` and `pid` are null, and it is the only place those nulls occur. There are no completion booleans.
- Terminal replies versus literal input: `input` chunks come only from `write()` calls. Bytes the child emits, including terminal queries, are `output`. A terminal reply the harness would synthesize is not generated at all. The recorder never answers queries, so no reply class exists to confuse.
- `interrupted` is never written by a live session. It is derived on load from a snapshot whose phase is not `sealed`.
- `seq` is one counter across chunks, actions and errors, so total order is recoverable from the state alone.
- No field carries a verdict, expected value or model identity.

### Ownership and lifecycle

`Session` is the only holder of the PTY master fd, the child pid, the process group, the open blob handles and the current `SessionState`.

- `openAttempt` creates `outDir` with `mkdir` (non-recursive, fails on existing), rejects symlinked `outDir` and any symlink ancestor under the declared evidence root, hashes bindings, writes the first snapshot containing `phase: opened`, then returns. Launch intent is durable before `start()` is called.
- `start()` forks the child onto a slave terminal with the declared geometry applied before exec, in its own process group. Missing executable becomes a `launch-failed` seal.
- Data from the master fd is appended to `output.bin` and indexed as a chunk in one step inside the session. Writes go to `input.bin` first, then the master, then the ack timestamp is set when the write call returns.
- `cancel()` records the action, signals the process group (TERM, then KILL after a grace period), and waits for descendants. Outcome is `cancelled` wrapping the real exit.
- `wait()` resolves only after the master fd reports EOF and both blobs are flushed, so final output drains before sealing. Seal writes the last snapshot atomically (temp file plus rename), fsyncs, and closes handles.
- `session.dispose()` is the only teardown path. It kills any remaining process group member and seals as cancelled if not already sealed.

### Persistence is a serializer

Layout of an attempt directory.

```
attempt-0007/
  session.json     # SessionState minus bytes, schemaVersion, atomically replaced
  output.bin       # raw child output, append-only
  input.bin        # raw literal input, append-only
```

`session.json` is rewritten on every transition, input write, resize, cancel and error, and on a coalesced timer (default 250 ms) for output chunks. Raw bytes are appended on arrival, never buffered past the read call. Recovery rule: bytes in `output.bin` beyond the last indexed chunk are exposed by `loadAttempt` as one `unindexedTail` range rather than discarded. Ordering within that tail is unknown and says so.

Serialization is `serialize(state): string` and `parse(text): SessionState`. Parse validates at this boundary and throws on malformed or unknown-schema input. Nothing downstream re-validates. Per principle-boundary-discipline.

### Event projection

`events()` is a pure function of `SessionState` returning ordered `RecorderEvent` values (launch-intent, process-start, output, input-dispatch, input-ack, resize, cancel-request, error, exit). It is optional. Nothing writes it back, and the snapshot never stores it. A caller wanting a JSONL export calls `events()` and serializes it themselves or uses `exportEventsJsonl(state)`.

### Public API surface

```ts
interface AttemptSpec {
  readonly outDir: string;
  readonly fixtureRoot: string;
  readonly side: Side;
  readonly command: { readonly file: string; readonly args: readonly string[] };
  readonly geometry: Geometry;
  readonly publicEnv: Readonly<Record<string, string>>;
  readonly bindings: Readonly<Record<string, string>>;
}

declare function openAttempt(spec: AttemptSpec): Promise<Session>;
declare function loadAttempt(outDir: string): Promise<LoadedAttempt>;

interface Session {
  start(): Promise<void>;
  write(bytes: Uint8Array): Promise<void>;
  resize(to: Geometry): Promise<void>;
  cancel(reason: string): Promise<void>;
  wait(opts: { timeoutMs: number }): Promise<Outcome>;
  snapshot(): SessionState;
  events(): readonly RecorderEvent[];
  readOutput(): Promise<Uint8Array>;
  dispose(): Promise<void>;
}

interface LoadedAttempt {
  snapshot(): SessionState;                       // outcome is "interrupted" when unsealed
  events(): readonly RecorderEvent[];
  readOutput(): Promise<Uint8Array>;
  readInput(): Promise<Uint8Array>;
  unindexedTail(): { readonly offset: number; readonly length: number } | null;
}

type RecorderEvent =
  | { readonly seq: number; readonly kind: "launch-intent"; readonly at: TimeStamp }
  | { readonly seq: number; readonly kind: "process-start"; readonly pid: number; readonly at: TimeStamp }
  | { readonly seq: number; readonly kind: "output"; readonly offset: number; readonly length: number; readonly at: TimeStamp }
  | { readonly seq: number; readonly kind: "input-dispatch"; readonly offset: number; readonly length: number; readonly at: TimeStamp }
  | { readonly seq: number; readonly kind: "input-ack"; readonly of: number; readonly at: TimeStamp }
  | { readonly seq: number; readonly kind: "resize"; readonly to: Geometry; readonly at: TimeStamp }
  | { readonly seq: number; readonly kind: "cancel-request"; readonly reason: string; readonly at: TimeStamp }
  | { readonly seq: number; readonly kind: "error"; readonly message: string; readonly at: TimeStamp }
  | { readonly seq: number; readonly kind: "exit"; readonly outcome: Outcome };
```

Two entry points and one object. No comparator, acceptance, verdict or parity API exists anywhere in the surface. The module imports nothing from `parity/scripts`.

Interface depth. The caller never sees fds, process groups, blob offsets, atomic rename, drain ordering, symlink checks or snapshot cadence. The public options are only what the caller declares about the attempt. The caller does coordinate `start`, `write` and `wait`, but that sequence is the real user journey, not an internal stage.

## How this differs from event-log-first

| Question | Event-log-first (A) | Session-first (B) |
| --- | --- | --- |
| Source of truth | Append-only event stream on disk. State is a fold over it. | In-memory `SessionState` owned by one `Session`. Disk mirrors it. |
| What a crash leaves | A valid prefix of events. | The last atomically written snapshot plus raw blobs, with an `unindexedTail` possible. |
| Who orders things | The writer appends, order is file order. | The session assigns `seq` inside one object, order is the counter. |
| Events | Primary record. | Derived view, optional, never stored. |
| Interrupted outcome | Absence of a terminal event. | Absence of a `sealed` phase, synthesized on load. |
| Lifecycle logic | Reducer over events decides legal states. | Class methods and the `Phase` union decide legal states. |
| Failure mode risk | Every consumer needs the fold. | Snapshot cadence can lag output chunks. |

The difference is structural. Remove the projection from B and the recorder still works. Remove the log from A and nothing exists.

## Red-flag screen

- Shallow module: **pass**. Two functions and one nine-method object hide PTY forking, group kill, drain ordering, hashing, symlink rejection and atomic persistence. One note: `write` then `wait` is caller-sequenced, but it mirrors the user journey. Watch `events()` plus `exportEventsJsonl` for creep.
- Information leakage: **pass with one watch item**. File layout and the `session.json` schema stay private behind `loadAttempt`. `RecorderEvent.offset` and `length` expose blob offsets to callers. Accepted because byte recoverability is a stated requirement. If consumers start slicing blobs themselves, move slicing into `readOutputRange`.
- Temporal decomposition: **pass**. No load, validate, transform and save stages. Parsing and serialization sit together in one persistence module and share the one `SessionState` type. The session class groups code by the knowledge it owns (process, bytes, state), not by run order.
- Pass-through method: **pass**. `wait` adds drain and timeout policy, `write` adds ordering and ack stamping, `snapshot` returns a frozen copy. `dispose` is the only close to a lifecycle owner. `exportEventsJsonl` is a thin serializer over `events()`. It adds a format, so it stays, but it is the first thing to delete if no caller uses it.
- Extra screen, mutable shared state: **fail by design, contained**. B has one mutable object, which the brief demands. Containment is single-owner (no other module holds the fd or state), immutable snapshots, and no shared stream across attempts. Concurrent `write` and `resize` calls serialize on an internal promise queue.

## Tradeoffs accepted

- We accept a snapshot that can lag output chunks in exchange for not rewriting a JSON file on every read. Raw bytes are never lagged, only their index.
- We accept `unindexedTail` as an explicit unknown rather than guessing order for post-crash bytes.
- We accept that events are not durable on their own in exchange for one place that decides ordering and legal states.
- We accept that `interrupted` is a load-time inference rather than a recorded fact, because a crashed process cannot write its own interruption.
- We accept rewriting `session.json` with growing chunk tables (quadratic in chunk count if uncoalesced). The coalescing timer bounds it. A very long session may need the table split into its own append-only file.
- We accept no terminal-reply synthesis. Programs that block on a terminal query (for example a cursor-position request) will stall until cancelled. That is the recorded truth, and a harness that answers would blur literal input with terminal replies.
- We accept env allowlisting by caller. Values not named in `publicEnv` are never recorded, even if inherited.

## Alternatives considered

- **Event-log-first (sketch A).** Loses here because the brief requires the structurally distinct shape, and for this problem it pushes a fold onto every consumer. It wins on crash prefix guarantees. Judged on depth it hides less (callers learn the event grammar).
- **Stateless functions over a directory** (`launch(dir)`, `append(dir, ...)`, `seal(dir)`). Rejected as temporal decomposition. Callers coordinate stages and several modules share the directory schema.
- **Python pty wrapper subprocess with JSON on stdout.** Rejected as the core. It adds a second language boundary and repeats the `routine-secret-pty.py` shape, which discards timing. Left open as an implementation choice for the fork step only.

## Open questions and risks

- Node has no built-in PTY. Which dependency owns forking and resize (`node-pty`, a small native helper, or Python `pty` behind a pipe)? Does it deliver exact bytes, process-group kill and EOF-after-drain on macOS and Linux?
- Windows ConPTY is unspecified. Should B declare Windows unsupported with an explicit `open-risk` marker in the snapshot, or block on an equivalent?
- Is a 250 ms output-index coalescing window acceptable, or should the index be a separate append-only file so a crash never leaves a tail?
- Does the process-group kill reliably catch daemonizing descendants? Should the session verify no group member remains before sealing?
- Does the frame's "refuse reuse of an attempt directory" cover a directory left by an interrupted run, or may a resume continue it? B assumes refusal, and resumption is not offered.
- Does hashing `bindings` of large installed payloads belong in `openAttempt`, or is it the caller's job to pass digests? B hashes, which makes the call slower and the guarantee stronger.
- Mutable session identity makes accidental reuse across tests easy. Does the real-PTY suite need a fixture that guarantees `dispose()`?

## First-slice fixture exercise (non-model)

A small fixture program, `probe`, in an owned and resettable fixture dir. It is a real compiled or scripted program that prints `isatty` for stdin/stdout/stderr, its rows and columns on start and on SIGWINCH, writes a literal invalid UTF-8 sequence and a split multibyte character, echoes input bytes in hex, and exits with a code given by an argument. Expected values below are literals written in the test, not derived from the recorder.

1. **tty and geometry.** Open with 24x80. Assert output bytes contain `isatty:1,1,1` and `size:24x80` exactly. Assert the snapshot has `launchIntent` before `started`, and the first output chunk after `started`.
2. **Raw bytes.** Probe emits `ff fe 41` and a three-byte character split across two writes. Assert `readOutput()` equals the literal byte array, and that the chunk table has no decoded text.
3. **Input.** `write([0x68,0x69,0x0d])`. Assert `input.bin` equals those bytes, one input chunk with `ack` set, and the echo `68 69 0d` appears in output after the input chunk in `seq` order.
4. **Resize.** `resize({rows:40, cols:100})`. Assert the resize action has `ack`, and output contains `size:40x100`.
5. **Real exit.** Probe exits 7. Assert outcome `{kind:"exited", code:7}` and final output drained before seal.
6. **Immediate exit.** Probe exits 0 with no output. Assert `exited` code 0, a launch-intent, a start and an exit, and an empty `output.bin`.
7. **Missing executable.** Assert `start()` resolves, outcome `launch-failed`, `started` null, and launch intent still on disk.
8. **Cancellation with descendant.** Probe spawns a sleeping child, test calls `cancel("t")`. Assert outcome `cancelled`, wrapping a real exit, the sleeping pid no longer exists, and the cancel action precedes exit in `seq`.
9. **Interruption.** Kill the test-owned recorder host process mid-run (fixture runs the recorder in a child node process). Assert `loadAttempt` reports `interrupted`, `launchIntent` and input chunk are intact, and a prior attempt directory is byte-identical.
10. **Separate directories.** A second `openAttempt` on the same `outDir` rejects. A second attempt in a new dir shares no files with the first. A symlinked `outDir` rejects.
11. **No secret capture.** Set a private env var `SECRET_TEST=sentinel`. Assert the string `sentinel` appears nowhere in `session.json`, `output.bin` or `input.bin` of a run that does not allowlist it.
12. **Projection.** Assert `events()` for run 3 equals a literal ordered kind list: `launch-intent, process-start, output..., input-dispatch, input-ack, output..., exit`.

Edge inputs for the persistence boundary: empty `session.json`, truncated JSON, unknown `schemaVersion`, and `output.bin` longer than the indexed total (expects `unindexedTail`). After this passes, the same recorder drives installed CLI non-model discovery controls. Neither exercise authorizes parity.

## Next implementation step

Write RED tests 1, 2 and 5 against the real PTY with the `probe` fixture, then implement `openAttempt`, `start`, `wait` and snapshot persistence for them.
