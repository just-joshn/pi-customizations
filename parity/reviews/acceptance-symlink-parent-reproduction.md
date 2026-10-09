# Supporting verifier symlink write reproduction

The parent reproduced an unsafe filesystem boundary in the repaired draft verifier. This is a supporting-tool defect, not a production parity verdict.

The reproduction copied the owner's entire repaired acceptance directory into a new ignored fixture. A sibling disposable canary file was created with known text. The copied MANIFEST.sha256 was moved aside, then replaced with a symlink to that sibling canary. The original owner directory and definitions were not changed.

The original repaired verifier ran with --acceptance-root pointing to the copy and --write-hashes. It exited 0. The sibling canary's SHA-256 changed, proving a write outside the declared acceptance root. Its output still reported structural PASS and authorization NONE.

Evidence is in `../evidence/acceptance-symlink-write.json`, `acceptance-symlink-before.txt`, `acceptance-symlink-after.txt`, and `acceptance-symlink-fixture-path.txt`.

The cause is filesystem traversal using statSync in listFiles, followed by unrestricted writeFileSync to record-hashes.json and MANIFEST.sha256. An existing manifest symlink is excluded from hashing by its lexical name and then followed on write. No final-gate acceptance is implied, but the supporting rehash operation does not confine writes to its declared directory.

A repair should test manifest and hash-ledger output symlinks, linked input files/directories, cycles, and input errors. It should reject unsafe paths before any output mutation and preserve both outputs and external canaries on rejection. It must not change original expectations or configuration bytes, add transition authority, or claim external custody. Independent supporting-tool review is already in progress; no concurrent writer was launched against its live source directory.
