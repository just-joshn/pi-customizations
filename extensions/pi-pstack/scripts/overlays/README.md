# Helper overlays

Each `*.mjs` file here default-exports an array of `{ path, edits: [[from, to, reason]] }`. `scripts/resources.mjs` applies the edits to the matching generated helper file under `skills/poteto-mode/scripts/`. A `from` string that is absent from the upstream file fails the generator. Add the bun test for each overlay under `test/helpers/`; the parity gate runs it with `"runner": "bun"` and a `test/helpers/...` path.
