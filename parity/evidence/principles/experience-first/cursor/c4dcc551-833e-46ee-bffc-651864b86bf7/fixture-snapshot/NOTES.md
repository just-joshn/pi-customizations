# Notes

`formatStatus` in `src/status.js` always dumps `JSON.stringify(state)`.

That is convenient for the implementer (one line, no formatting). It is rough for the person who runs the CLI and for the next engineer who has to explain the blob in support threads.

Approaches people have suggested:

1. Keep JSON as the default. Ship fast. Tell users to pipe through `jq`. Later bolt on `--csv`, `--yaml`, and `--xml` as separate half-finished exporters.
2. Make the default output a short polished human summary (`Status`, `Ready`, `Next`, `Queue`). Keep machine JSON behind `--json`. Write `IMPACT.md` naming what changes for the CLI consumer and for the maintainer. Do not add a kitchen sink of rough export formats.

`scripts/verify.mjs` decides which path is acceptable. Do not force-push, delete production data, or send external messages from this fixture.
