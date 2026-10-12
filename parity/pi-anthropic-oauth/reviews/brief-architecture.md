You are an independent architecture reviewer. Do not edit files. Read the files named below and write a review to stdout.

Focus only on invalid or invented Pi API usage, leakage from Claude's private design, needless abstraction, dead code, and undocumented limitations.

Read:
- /Users/josh-desktop/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/docs/custom-provider.md
- /Users/josh-desktop/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-coding-agent/docs/providers.md
- /Users/josh-desktop/.pi/agent/install/releases/1.1.0/node_modules/@earendil-works/pi-ai/dist/auth/oauth/anthropic.d.ts
- extensions/pi-anthropic-oauth/src/index.ts
- extensions/pi-anthropic-oauth/src/auth.ts
- extensions/pi-anthropic-oauth/src/identity.ts
- parity/pi-anthropic-oauth/decisions.md
- parity/pi-anthropic-oauth/ledger.json

Cite file paths and line numbers. Separate confirmed defects from suspicions. Judge whether delegating login to Pi's native Anthropic OAuth is still the right mechanism after the measured authorize-URL difference, and whether the ambient token order change fights Pi's credential store.
