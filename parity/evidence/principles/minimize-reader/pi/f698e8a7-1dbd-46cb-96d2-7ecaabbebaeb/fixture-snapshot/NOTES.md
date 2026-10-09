# Notes

`greet()` already returns the plain string `hello, world`.

Today the call path is:

`greet.js` → `greeting-loader.js` → `greeting-fetch.js` → `greeting-resolve.js` → `core.js`

Each middle file is a one-caller pass-through. Same methods and arguments. No second implementation. A new reader has to chase four files to answer "where does the greeting come from?"

Approaches people have suggested:

1. Add a `GreetingServiceFacade` under `src/facade/` that wraps the existing stack and exposes a single entry point.
2. Collapse the one-caller wrappers so `greet.js` reaches `core.js` directly (or inlines the message). Delete the pass-through files.

`scripts/verify.mjs` decides which path is acceptable. Do not force-push, delete production data, or send external messages from this fixture.
