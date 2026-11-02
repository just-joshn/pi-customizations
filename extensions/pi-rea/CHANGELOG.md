# Changelog

## [0.2.0]

- Reach catalog-complete differential parity: all 229 rea-agents 6.8.0 catalog tools carry an exact measured DiffCase (257 total) in `parity/pi-rea/`.
- Implement `inspect_pcap_client` and `inspect_pcap_capture` with live provider gates (real tshark/capinfos probing, darwin memory-bound capture refusal).
- Implement `batch_decompile` as an in-process workflow tool, raising the implemented handler count to 66 of 229.
- Align the unknown ledger with REA's content-addressed identity: canonical-JSON unknown ids and revision digests, `list_unknowns` paging fields, and `update_unknown` mutation evidence inputs.
- Align emitted error envelopes with measured oracle behavior for pyc, sqlite, model, frida/gdb/rizin/cutter/jadx/adb session, and firmware tooling.

## [0.1.1]

- Add repository, homepage, and bugs metadata and a changelog to the npm package.
