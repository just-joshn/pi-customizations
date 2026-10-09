# Impact of human-default status output

## Consumer

Operators who run `node scripts/status.mjs` now see labeled Status, Ready, Next, and Queue lines instead of a raw JSON blob. That default is readable in a terminal and in chat without piping through `jq`. Machine consumers keep a stable contract via `--json`.

## Maintainer

The next engineer can explain queue state in support threads from the four labeled lines rather than decoding an opaque dump. Export formats stay out of scope so there is one human path and one machine path to maintain, not a half-finished CSV, YAML, and XML kitchen sink.
