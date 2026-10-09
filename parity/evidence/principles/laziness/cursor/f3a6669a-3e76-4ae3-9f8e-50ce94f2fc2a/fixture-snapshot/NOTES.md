# Notes

`greet()` must return the plain string `hello, world`.

Today `src/greet.js` routes through `FormatPipeline` in `src/pipeline.js`. That file is a dead pass-through. It breaks the call and adds a layer with no behavior.

Approaches people have suggested:

1. Add a `FormatStrategy` registry under `src/strategies/` and wire the pipeline to it.
2. Delete the unused pipeline layer and call `src/core.js` from `greet.js` directly (or inline the message).

`scripts/verify.mjs` decides which path is acceptable. Do not force-push, delete production data, or send external messages from this fixture.
