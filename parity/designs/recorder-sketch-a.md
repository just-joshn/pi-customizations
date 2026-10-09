# PTY recorder sketch A: event-log-first

Structural constraint: one append-only JSONL event stream is the sole source of truth. Attempt identity is a separate immutable record. Every other view (outcome, byte streams, screen text) is derived by a pure fold over the log.

Structural thesis: the recorder only appends facts in the order it observes them, and everything a reader wants (outcome, transcript, "was it interrupted") is computed from the log, never stored.

## Problem

Consumers need reproducible recordings of real terminal processes and literal user controls. The existing evidence (`parity/evidence/cursor-first-run/`, `control-pi` RPC over pipes, `routine-secret-pty.py`) lacks per-action timestamps, ordered raw bytes, fixture digests and a deployment binding. Constraints from the frame and grounding docs that the design honors.

- Real PTY with all three standard streams on the slave, rows/cols set before exec.
- Dispatch intent, actual start, output, write acknowledgement and exit are different facts.
- Invalid UTF-8, split multibyte output and terminal-generated replies must survive. Decoded or rendered text is never the only copy.
- One attempt, one directory, one stream, one writer. A crash leaves an unsealed log that is retained, not repaired.
- No credentials, no parity verdict, no acceptance or comparator output. Pi owns its UI and agent loop. The recorder does not reimplement either.
- Existing preliminary evidence is never overwritten and no timestamps are retrofitted.

## Usage (caller's view)

```ts
import { startAttempt, readAttempt, outcomeOf, outputBytes } from "./recorder";

// 1. Fixture exercise: real non-model program in an owned fixture.
const attempt = await startAttempt({
  root: "/tmp/rec-attempts",          // parent dir, must exist, must not be a symlink
  side: "pi",
  scenarioRef: "fixture:isatty-resize",
  fixtureRef: { path: fixtureDir, digest: "sha256:..." },
  launch: { argv: [fixtureBin, "--probe"], cwd: fixtureDir, env: { TERM: "xterm-256color" } },
  geometry: { rows: 24, cols: 80 },
});

attempt.input(Buffer.from("hello\r"), "literal_user");
attempt.resize({ rows: 40, cols: 100 });
const sealed = await attempt.done();   // resolves after exit + final drain + seal
console.log(sealed.dir, sealed.outcome.kind);

// 2. Any later reader, including after a crash.
const log = await readAttempt(sealed.dir);        // identity + parsed events
const out = outputBytes(log.events);              // Buffer, exact bytes, ordered
const outcome = outcomeOf(log.events);            // exited | signaled | launch_failed | cancelled | interrupted

// 3. Cancel.
const a2 = await startAttempt({ ...spec, root });
await a2.cancel();                                // SIGTERM tree, escalate to SIGKILL, drain, seal
```

Callers make one call to start, use three verbs while running (`input`, `resize`, `cancel`), await one promise, then read with pure functions. The caller never sequences launch, start, drain and seal.

## Shape

### Data shape

Two records plus a derived family.

**AttemptIdentity.** Written once as `identity.json` by `startAttempt` before launch, then never modified. Contains `attemptId`, `side`, `scenarioRef`, `fixtureRef` (path and digest), `geometry` at launch, public launch parameters (`argv`, `cwd`, allowlisted `env` names and values), resolved executable path and sha256, installed-artifact fingerprint (caller supplied path list hashed by the recorder), observed environment subset (platform, node version, `TERM`), and recorder schema version. Public env is an explicit allowlist input. Anything not allowlisted is not recorded, which is how credentials stay out.

**AttemptEvent.** One line of `events.jsonl`. Discriminated union keyed by `kind`. Every event carries `seq` (dense from 0), `monoNs` (bigint as decimal string) and `utc` (ISO 8601).

| kind | extra fields | meaning |
| --- | --- | --- |
| `launch_intent` | none | recorder is about to spawn. First event. |
| `spawn_failed` | `errno`, `message` | exec or fork failed. No `process_started` follows. |
| `process_started` | `pid` | spawn returned a live child. Observed fact, distinct from intent. |
| `output` | `dataB64` | bytes read from the PTY master, as read, unsplit by decoding. |
| `input_dispatched` | `dataB64`, `origin` | recorder accepted the bytes for writing. `origin` is `literal_user` or `terminal_reply`. |
| `input_written` | `inputSeq`, `bytesWritten` | write to master completed. Partial writes yield partial counts. |
| `resize` | `rows`, `cols` | geometry change applied. |
| `cancel_requested` | `escalation` (`term` or `kill`) | signal sent to the process group. |
| `error` | `where`, `message` | recorder-side fault that does not end the attempt. |
| `exited` | `exitCode` or `signal` | actual process exit observed. |
| `drained` | none | master read returned EOF after exit. |
| `sealed` | `eventCount` | last event. Written by the recorder on a clean close. |

Dispatch versus write versus start versus exit are separate events, so requested execution and observed liveness never collapse into one boolean.

**Derived views** (pure functions, never persisted as source of truth).

- `outcomeOf(events): AttemptOutcome`. `launch_failed` if `spawn_failed`. `cancelled` if `cancel_requested` precedes `exited`. `exited` or `signaled` from the exit event. `interrupted` if the log has no `sealed` event. Interrupted is a property of the log's shape, so a crashed recorder needs no cleanup write and the retained directory stays immutable.
- `outputBytes(events): Buffer`, `inputBytes(events, origin?)`: concatenations in `seq` order.
- `transcript(events)`: ordered `{seq, monoNs, direction, bytes}` for human review. Optional text rendering is a separate function and lossy by contract.

No outcome carries a verdict. No field anywhere says pass, fail, match or parity.

### Ownership

- `startAttempt` owns directory allocation, identity write, the PTY, the child process group, the single append handle, and the seal. One writer per stream, enforced by the handle being private to the attempt closure.
- Allocation is `mkdir` of `<root>/<attemptId>` (non-recursive, fails on exists) after `lstat` confirms `root` is a real directory and not a symlink. Files open with `O_CREAT|O_EXCL|O_NOFOLLOW`. A reused directory is a hard error.
- The attempt owns only its process group. `cancel()` signals the group, waits a bounded grace period, escalates to kill, and is idempotent. A second call returns the same promise.
- Readers own nothing. `readAttempt` opens read-only and never repairs, truncates or seals.

### Invariants in types

- `AttemptEvent` is a discriminated union, so `pid` exists only on `process_started` and `exitCode` only on `exited`. No optional-field completion booleans.
- `AttemptId`, `Sha256`, `Seq` are branded.
- `AttemptOutcome` is a closed union of five kinds with kind-specific payloads.
- `AttemptDir` is a branded string produced only by `startAttempt` or validated by `readAttempt`.

### Public API (signatures, not implemented)

```ts
export type AttemptId = string & { readonly __brand: "AttemptId" };
export type Sha256 = string & { readonly __brand: "Sha256" };
export type AttemptDir = string & { readonly __brand: "AttemptDir" };

export interface Geometry { readonly rows: number; readonly cols: number }
export interface FileBinding { readonly path: string; readonly digest: Sha256 }

export interface AttemptSpec {
  readonly root: string;
  readonly side: "cursor" | "pi";
  readonly scenarioRef: string;
  readonly fixtureRef: FileBinding | null;
  readonly artifactPaths: readonly string[];
  readonly launch: {
    readonly argv: readonly [string, ...string[]];
    readonly cwd: string;
    readonly env: Readonly<Record<string, string>>;
  };
  readonly geometry: Geometry;
  readonly timeouts?: { readonly graceMs: number };
}

export interface AttemptIdentity {
  readonly schema: 1;
  readonly attemptId: AttemptId;
  readonly side: "cursor" | "pi";
  readonly scenarioRef: string;
  readonly fixtureRef: FileBinding | null;
  readonly executable: FileBinding | null;
  readonly artifacts: readonly FileBinding[];
  readonly launch: AttemptSpec["launch"];
  readonly geometry: Geometry;
  readonly observedEnv: Readonly<Record<string, string>>;
}

export type InputOrigin = "literal_user" | "terminal_reply";

interface EventBase { readonly seq: number; readonly monoNs: string; readonly utc: string }
export type AttemptEvent =
  | (EventBase & { kind: "launch_intent" })
  | (EventBase & { kind: "spawn_failed"; errno: string; message: string })
  | (EventBase & { kind: "process_started"; pid: number })
  | (EventBase & { kind: "output"; dataB64: string })
  | (EventBase & { kind: "input_dispatched"; dataB64: string; origin: InputOrigin })
  | (EventBase & { kind: "input_written"; inputSeq: number; bytesWritten: number })
  | (EventBase & { kind: "resize"; rows: number; cols: number })
  | (EventBase & { kind: "cancel_requested"; escalation: "term" | "kill" })
  | (EventBase & { kind: "error"; where: string; message: string })
  | (EventBase & { kind: "exited"; exitCode: number | null; signal: string | null })
  | (EventBase & { kind: "drained" })
  | (EventBase & { kind: "sealed"; eventCount: number });

export type AttemptOutcome =
  | { kind: "exited"; exitCode: number }
  | { kind: "signaled"; signal: string }
  | { kind: "launch_failed"; errno: string }
  | { kind: "cancelled"; exit: { exitCode: number | null; signal: string | null } }
  | { kind: "interrupted"; lastSeq: number };

export interface AttemptLog {
  readonly dir: AttemptDir;
  readonly identity: AttemptIdentity;
  readonly events: readonly AttemptEvent[];
}

export interface Attempt {
  readonly dir: AttemptDir;
  readonly id: AttemptId;
  input(data: Uint8Array, origin: InputOrigin): void;
  resize(geometry: Geometry): void;
  cancel(): Promise<void>;
  done(): Promise<AttemptLog>;
}

export function startAttempt(spec: AttemptSpec): Promise<Attempt>;
export function readAttempt(dir: string): Promise<AttemptLog>;

export function outcomeOf(events: readonly AttemptEvent[]): AttemptOutcome;
export function outputBytes(events: readonly AttemptEvent[]): Uint8Array;
export function inputBytes(events: readonly AttemptEvent[], origin?: InputOrigin): Uint8Array;
export function transcript(events: readonly AttemptEvent[]): readonly TranscriptEntry[];
export interface TranscriptEntry {
  readonly seq: number;
  readonly monoNs: string;
  readonly direction: "in" | "out";
  readonly bytes: Uint8Array;
}
```

Internal modules (not exported): `alloc` (safe directory and file creation), `log` (single append writer that assigns `seq` and timestamps), `pty` (spawn, master reads, group signal), `fingerprint` (sha256 of files). Public exports are two functions, the pure folds, and types. No transport types leak: the PTY library's handle never appears in a signature.

### Interface depth

The surface is two entry points, three runtime verbs and four pure readers. Behind `startAttempt` sit directory safety, ordering, timestamping, partial-write accounting, exit-then-drain sequencing, group cancellation and sealing. The caller coordinates nothing. Readers need only the event table.

Per principle-model-the-domain: the closed event union and closed outcome union replace booleans and scattered conditionals. Per principle-type-system-discipline: brands and kind-specific payloads make illegal states unrepresentable. Per principle-boundary-discipline: the allowlisted env and the PTY handle are the only system boundaries, both inside `startAttempt`. Per principle-make-operations-idempotent: `cancel` and seal are safe to repeat, and `readAttempt` is side-effect free. Per principle-separate-before-serializing-shared-state: one attempt, one directory, one writer, so no locking exists.

### Platform support

POSIX only (macOS and Linux). Group signaling and `O_NOFOLLOW` assume POSIX. Windows ConPTY is unmet and stays open, not exempted.

## Synthesis decision

Not applicable to this sketch. Arena fills this after both sketches complete.

## Tradeoffs accepted

- We accept base64 bytes in JSONL (about 33% growth, no direct `cat`) in exchange for an exact, line-addressable, append-safe record of invalid UTF-8 and split multibyte output.
- We accept that `interrupted` is derived from a missing `sealed` event, in exchange for an immutable directory that never needs a post-crash write or repair step.
- We accept no persisted summary file in exchange for one source of truth. Readers pay a fold on every read. Attempt logs are small, so this is cheap.
- We accept `input_dispatched` then `input_written` as two events per write in exchange for separating intent from OS acknowledgement.
- We accept that `origin: "terminal_reply"` is caller-asserted. The recorder cannot tell a reply from a literal key on the master. The caller that runs a terminal emulator knows.
- We accept a single global event order over input and output (one `seq`), which serializes appends through one handle, in exchange for exact interleaving.
- We accept an explicit env allowlist, which makes callers enumerate public variables, in exchange for credentials never entering the log by omission.

## Alternatives considered

- **Mutable summary plus raw sidecar files** (`output.bin`, `input.bin`, `summary.json` updated at exit). Rejected. Interleaving order is lost, the summary is a second writer to keep consistent, and a crash leaves it stale. This is also the shape the grounding doc faults in the preliminary logs.
- **Separate per-stream logs** (`out.jsonl`, `in.jsonl`). Rejected. Cross-stream ordering would need timestamp merging, and monotonic ties break it.
- **Persisted derived views** (cached transcript, outcome file). Rejected. Introduces a second source of truth and staleness for no capability. Caching can be added by a reader later without touching the format.
- **Exposing stage methods** (`launch()`, `awaitStart()`, `drain()`, `seal()`). Rejected as shallow and temporally decomposed. Callers would coordinate four calls to do one operation.

## Open questions and risks

- Which PTY mechanism: a native binding (for example node-pty) or a small POSIX helper process? Native bindings add an install-time dependency. A helper adds a second process whose own failure modes need events. Which dependency budget applies?
- Does `startAttempt` hash `artifactPaths` itself, or should the caller supply digests? Hashing large installed payloads can be slow. Hashing inside is the safer binding and is the current choice.
- How is "final drainage" bounded if a descendant keeps the slave open after the leader exits? Is a drain timeout with an `error` event acceptable?
- How should cancellation treat a descendant that changes its process group (`setsid`)? The group signal would miss it. Is a best-effort tree walk needed, and on which platforms?
- Does the single-handle append stay correct under heavy output (back-pressure on reads while the log write awaits)? Needs a measured check, not an assumption.
- Is `origin: "terminal_reply"` enough, or should replies also be tagged with the query that caused them?
- Windows ConPTY remains unbuilt. Parity journeys that need Windows stay unsatisfied until it is.
- Retention of an unsealed log relies on the filesystem. Nothing here protects against a deleted directory. External custody is a separate obligation.

## First slice: non-model fixture exercise

Fixture program: a small deterministic script owned in a resettable fixture directory. It prints `isatty` for fd 0, 1 and 2, prints initial rows and cols, emits a fixed invalid-UTF-8 byte string and a multibyte character split across two writes, echoes input bytes, prints new geometry on SIGWINCH, and exits with a code taken from argv. Expected values are literals in the test, not computed by the code under test.

Tests run against the real PTY with no mocks of `startAttempt`.

1. **TTY and geometry.** Start with 24x80. Assert `outputBytes` contains literal `tty:0=1 1=1 2=1` and `size:24x80`.
2. **Exact bytes.** Assert output contains the literal bytes `ff fe 41` from the invalid sequence unchanged, and the split multibyte character reassembles to the exact three bytes across `output` events.
3. **Input and order.** `input("hello\r", "literal_user")`. Assert one `input_dispatched` with that base64 and a following `input_written` with `bytesWritten: 6`. Assert dispatched precedes the echoed `output` by `seq`.
4. **Resize.** `resize({rows:40, cols:100})`. Assert a `resize` event and later output `size:40x100`.
5. **Real exit.** Assert event order `launch_intent`, `process_started`, ..., `exited{exitCode:7}`, `drained`, `sealed`, and `outcomeOf` is `{kind:"exited", exitCode:7}`. Assert `seq` is dense and `monoNs` is non-decreasing.
6. **Immediate exit.** Fixture exits 0 with no output. Assert final output drainage still captures any bytes and the log is sealed.
7. **Missing executable.** Assert `spawn_failed` with an `ENOENT`-class errno, no `process_started`, outcome `launch_failed`, and `launch_intent` retained.
8. **Cancellation.** Fixture spawns a descendant and sleeps. `cancel()` twice. Assert the group is gone (pid probe), one logical cancel sequence, outcome `cancelled`, and the second call resolves without new events.
9. **Interruption.** Truncate a copy of a sealed log before `sealed`, and separately kill a recorder subprocess mid-attempt. Assert `outcomeOf` is `interrupted`, the dispatch records are intact, and `readAttempt` does not modify the directory (mtime and bytes unchanged).
10. **Second run isolation.** Two attempts from one root get different directories. Assert the first directory's bytes are unchanged after the second runs.
11. **Safety.** A symlink as `root` or as a pre-created attempt path is rejected. Reusing an attempt directory is rejected. A non-allowlisted env variable set in the parent does not appear in `identity.json` or the log.
12. **API boundary.** A type-level test that no exported name or field contains `verdict`, `pass`, `parity` or `accept`.

After the fixture passes, the same `startAttempt` records installed Cursor and Pi non-model discovery controls (for example `--version` and `--help`). Neither exercise authorizes parity.

## Red-flag screen (design-red-flags.md)

- **Shallow module: pass.** Two entry points hide allocation, ordering, timestamps, partial writes, drain, group cancel and seal. Callers use no stage methods. Residual note: `AttemptSpec` is wide, but every field is caller-owned data, not an internal stage choice.
- **Information leakage: pass.** The JSONL schema is owned by `log` and the fold functions, and readers go through `readAttempt`. The PTY library handle never appears in a signature. Caution: the event union is public, so the schema is a deliberate contract, not an accident. Changes require a `schema` bump.
- **Temporal decomposition: pass.** No load, validate, transform, save stages. The module is split by knowledge: `alloc` owns path safety, `log` owns ordering and time, `pty` owns the process, folds own interpretation. No stage is exposed.
- **Pass-through method: pass.** `Attempt.input` and `resize` add policy (dispatch and ack events, timestamping, `seq`). `inputBytes` and `outputBytes` are folds with filtering, not forwards. `readAttempt` parses and validates. Watch item: `done()` is a thin await over the seal and returns the log read back, so it adds the read-back and validation, not a bare forward.

## Next implementation step

Write the failing real-PTY fixture test for the TTY, geometry and exact-bytes cases (tests 1 and 2), then implement `alloc`, `log` and the minimal `pty` spawn to make them pass.

## Synthesis decision (coordinator, 2026-10-08)

Selected A (event-log-first). Against the frame rubric, A wins fidelity and lifecycle: one global order over input and output survives a crash, while B's `unindexedTail` loses ordering after a crash. B's one idea kept: callers sequence only `start`, `input`, `resize`, `cancel`, `done`. PTY mechanism: `@lydell/node-pty` (prebuilt, probed on Node 24 and macOS), a parity-only dev dependency outside the runtime payload. POSIX only. Windows ConPTY remains open. Self-judged by the coordinator; the rubric allows an independent re-judge before the first consumer relies on the format.
