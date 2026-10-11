# Security and failure handling

A Pi extension is executable code. It runs with every capability of the user's process. Check each boundary below.

| Boundary | Requirement | Test it with |
|---|---|---|
| Tool args, command args, config, files | Validate at entry, reject unknown or malformed input, and give a clear error | Malformed, empty, oversize, and wrong-type input |
| Filesystem | Resolve paths, then enforce the intended root, including symlinks and `..` | Paths that escape the root, symlinks, missing permissions |
| Processes | Pass argv arrays, avoid shell interpolation, set a timeout, honor `AbortSignal` | Metacharacters in args, a hung child, cancellation |
| Network | Set a timeout, cancel cleanly, return a clear error when offline | Unreachable host, slow response |
| Secrets | Keep them out of logs, prompts, fixtures, snapshots, and errors | Grep fixtures and outputs for key patterns |
| Persistent writes | Write atomically (temp file plus rename), recover from a partial state, make retries safe | Interrupt partway through, then rerun |
| Destructive actions | Require explicit user authorization | Run with the confirmation declined |

Fail clearly when a dependency is missing. **Never fall back silently to different semantics.** Never claim sandboxing or isolation that Pi doesn't provide. Document every boundary the port cannot enforce, for example "the extension cannot stop the model from running the same command through bash".
