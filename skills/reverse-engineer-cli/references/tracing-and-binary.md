# OS tracing, native binaries, and dynamic analysis

Use these only when the CLI surface and source cannot confidently explain a behavior. Write every trace to files under `re/40_traces/`, never to the CLI's own stderr, and binary facts to `re/60_binary/`.

## Phase H: OS interactions

**Linux.** Start with strace, filtered to the subsystem in question and writing to files:

```bash
strace -ff -ttt -T -yy -s 256 -e trace=%file,%process,%network -o re/40_traces/run <cli> ...
```

Look for `open`/`openat`, `stat`/`access`, `execve`, `clone`/`fork`, `connect`, `socket`, `read`/`write`, `rename`, `unlink`, `mkdir`, and `flock`/`fcntl`. Narrow the filter once the relevant subsystem is known. Use bpftrace for lower-overhead or highly targeted kernel or user-space tracing, and only when it answers the question better than strace.

**Windows.** Process Monitor covers filesystem, Registry, process/thread, and DLL activity. Filter to the target process and its descendants. Process Explorer shows loaded DLLs, mapped files, and open handles.

**macOS.** Use `fs_usage` and DTrace-derived tools where permissions allow. If permissions block visibility, use a disposable VM or runtime instrumentation.

## Phase I: child processes

Many CLIs are mostly orchestration. For each child, record the executable, argv, cwd, selected environment, how stdin, stdout, and stderr are connected, exit-status handling, and retries. Find out whether the parent streams or buffers output, rewrites errors, maps exit codes, retries, kills descendants, or passes signals through. For a CLI that wraps git, docker, compilers, package managers, or a service, this boundary alone can explain most of its behavior.

## Phase J: network

First confirm that networking happens at all. Then record DNS lookups, destination host and port, protocol, request timing, retry policy, timeouts, proxy handling, and offline behavior. Prefer synthetic or test endpoints. Redact Authorization headers, cookies, API keys, session tokens, private key material, and user data, and never persist real auth material. If TLS hides payloads, inspect the source or client-library boundary before reaching for interception.

## Phase K: native binary triage

Do this before opening a decompiler. Collect format, architecture, endianness, compiler clues, debug info, sections, imports, exports, symbols, dynamic libraries, embedded strings, build IDs, and signatures.

- Baseline tools are `file`, `readelf`/`llvm-readelf`, `nm`/`llvm-nm`, `objdump`/`llvm-objdump`, `otool` (macOS), `dumpbin` (Windows), and `strings`.
- LIEF gives one Python or Rust API across ELF, Mach-O, and PE for headers, sections, symbols, relocations, imports, and functions.
- Rizin: `rz-bin -I <binary>` (info), `rz-bin -s <binary>` (symbols), plus imports, exports, libraries, and sections.

Strings generate hypotheses, not conclusions.

## Phase L: stripped versus symbol-rich

With useful symbols, map command-related names and dependency names, find likely main and dispatch functions, and mark runtime and library boundaries. Demangle first, which Rust symbols need. Release builds may be stripped or shaped by LTO, inlining, monomorphization, and the panic strategy. With a heavily stripped binary, lean on imports, strings, cross-references, runtime traces, and behavioral probes before naming functions by hand.

## Phase M: Ghidra headless

Use it only for native-code questions that are still open. `analyzeHeadless` creates projects, imports, runs analysis, processes directories, runs pre/post scripts, operates read-only, and applies analysis timeouts. PyGhidra automates it from CPython. Extract machine-readable facts with scripts: the function list, entrypoints, imports, exports, strings, string cross-references, call relationships, functions that reference given strings or call given imports, and decompiled bodies for selected functions only. Start from functions tied to already-observed behavior.

## Phase N: Frida

Use Frida when traces show what happened but not why. Point `frida-trace` include/exclude patterns at the function boundaries behind one concrete question: configuration loading, serialization, filesystem abstraction, process launch, network request construction, or crypto library calls. Capture only the arguments and return values that answer it. Tracing everything adds noise and perturbs timing.

## Phase O: debugger

Use GDB on Linux, LLDB on macOS, and WinDbg on Windows, and only after narrowing the region. Break on interesting imports, suspect handlers, config reads, serialization boundaries, child-process calls, and the sites of specific error messages. Do not single-step from process start unless the binary is tiny.

## Phase P: rr record/replay (Linux)

Use rr only when timing, concurrency, races, one-time failures, or complex execution history block diagnosis, and only once you have a minimal reproducer. Record once, replay under GDB as often as needed, tighten breakpoints each pass, and use reverse execution to walk back from the observed result.
