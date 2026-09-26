# Tracing and binary escalation

State the unresolved question before choosing a tool. Save trace output under `traces/{process,filesystem,network,runtime}/` separately from target stderr. Record tool version, complete invocation, privileges, filters, target hash, PID/children, time window, and blind spots. Compare instrumented and baseline behavior.

## Operating-system boundaries

On Linux use narrowly filtered strace or perf trace; follow relevant children and write tool logs to separate files. On macOS use available filesystem/process tracing or LLDB where permissions permit. On Windows use Process Monitor/Process Explorer and native network/debugger tooling. Do not weaken host security to enable a trace.

Capture files opened/created/renamed/deleted, directory searches, process creation, signals, DNS/TCP activity, and loaded libraries as relevant. Ordinary syscalls do not reveal every environment-variable read or library-level request. Use runtime hooks or source for those questions.

For children record executable, argv, cwd, selected environment, stream connections, status mapping, retries, and signal/cleanup behavior. A wrapper can own most of a CLI's observable behavior.

For network interactions record timing, endpoint, protocol, retries, timeout, proxy/cache handling, and offline failure. Use synthetic credentials and controlled services. Prefer inspecting request construction to intercepting TLS. Never persist real tokens/cookies/private data. Preserve a restricted original only when authorized, and clearly label any redacted derivative.

## Runtime instrumentation

Use the matching Node inspector, Python trace module, GDB/LLDB, or narrow Frida hooks for a specific handler or boundary. Begin with an observed syscall, locate the library/function, then instrument that function. Frida discovery and tracing can help select candidates, including offsets for non-exported native functions where supported. Record module hash, load base and relative offset because ASLR changes absolute addresses. Capture only relevant arguments/returns. Do not trace every function by default.

## Native analysis ladder

| Level | Tools | Evidence |
|---|---|---|
| Metadata | file, strings, nm, readelf, objdump, otool, dumpbin | Format, architecture, libraries, imports, symbols, build IDs, debug/strip state |
| Structured parsing | LIEF; Rizin rz-bin or radare2 equivalents | Machine-readable sections, imports, exports, dependencies, entrypoints |
| Capability triage | capa for supported input formats | Candidate capabilities and matching locations; verify independently |
| Targeted decompilation | Ghidra analyzeHeadless; licensed Binary Ninja API if available | Candidate functions, xrefs, calls, selected pseudocode |

Select tools supported by the actual format, architecture, and installed version. Verify current official docs for exact flags and API support, including JSON modes. Tool names are routing guidance, not a command recipe valid for every release. Do not install every tool preemptively.

Keep metadata in `binary/metadata`, strings in `binary/strings`, function facts in `binary/functions`, and decompiler output in `binary/decompiler`. Analyze a hashed copy. Never modify the installed executable, remove its protections, or assume generated types/names are original.

Before headless decompilation, select candidates from entrypoints, relevant strings/imports, observed traces, command handlers, or version changes. Save the candidate-selection rule and addresses. Use bounded analysis time and scripted extraction; do not dump every function. Separate raw disassembly facts, tool-generated pseudocode, and your interpretation.

Binary Ninja is optional and depends on an existing installation/license. Check current API availability; do not assume Python, C++, and Rust interfaces have equal stability.

For release comparisons, run the same behavioral corpus first. Only then use binary comparison, such as rz-diff where supported, on regions relevant to the observed changes. Byte differences alone do not establish changed behavior.
