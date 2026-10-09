# Evidence index. Creation-boundary freeze prep 001

Requirement. `PSTACK-SETUP-BENNY-CREATION-BOUNDARY-001`

Hash tool. `shasum -a 256`

## Attempt IDs

| Label | Attempt ID | Paid |
| --- | --- | --- |
| Cursor list (Inactive benny-triage) | `e11d7225-4c8a-4c09-8f30-273e941a52d2` | yes |
| Cursor editor title | `475ab346-80a0-4d73-8ae1-d2b8042ee66f` | yes |
| Cursor editor title re-verify | `2c525e93-3392-4253-81ef-dd965fde2e7d` | yes |
| Fresh Pi PTY (env-blocked) | `f4c7eec5-6ac5-4431-b4b1-23c7e267dc96` | no |
| Prior Pi env note | `cd378e36-ef2e-4810-ae5d-74a5169f204c` | no (historical) |

ENV mismatch `SETUP-BENNY-CREATION-BOUNDARY-ENV` is `closed-env-resolved`. Pi probe `automationsEditorUiAvailableInPiPty=false` at `2026-10-09T08:24:22.570Z`.

## Key artifact digests

| SHA-256 | Path |
| --- | --- |
| `08b8b4439c783c789a1a5e4c0b2e5067897adb047fb1faa1074270821e744b4c` | `parity/evidence/setup-benny/creation-boundary/host-env-probe.json` |
| `bc2ece4440d6a65a2555bef5365c99d643a2ad7dd0a1f2072d6d630baabe022b` | `.../e11d7225-.../meta.json` |
| `7c016ac21bdcb85542dd6499ddc42a22ab86e69d6dc01a809db829cdfb8af719` | `.../e11d7225-.../screen-07-poll-28.png.ocr.txt` |
| `b795c06ae51c23b308c411df05dc4fda4b098f0f80d553327cf34454161a2d31` | `.../e11d7225-.../screen-08-final.png.ocr.txt` |
| `c1276b4ceb7b0c92d1c369865dfd7ef928013b8fe4eea8dc381dbd27910487b5` | `.../475ab346-.../disposition.json` |
| `864c7278677031ef9dba2958b8825f5dfceca2a47ec07ad0fcefc98c44728c0b` | `.../475ab346-.../h04-final.png` (same bytes under `2c525e93`) |
| `909c33249ba1dec8ad7909ef9fca0a772c2eb33b9a4dd3d6d9f50b1c5149904a` | `.../475ab346-.../h04-final.png.ocr-recheck.txt` |
| `0aaa1f0ab5bba5afdbb9dd9530aa7393a36a46471eb3c9572015ffd785dde2b3` | `.../2c525e93-.../editor-title-oracle.json` |
| `4b54646e6f8beaa1f288c4e1d18557a748d08e7f89cc40036c2b41e621cb997b` | `.../pi/f4c7eec5-.../identity.json` |
| `74534b0cb48f952c86c3258ea22489e76d268d6bb50cba26cb0f77bd866bee33` | `.../pi/f4c7eec5-.../events.jsonl` |
| `c33f6c14219b9d271ffa276be38bdf9d3daf1a57baf115d45ebe9a12727a86b1` | `.../pi/done-copy.txt` |
| `23ba7e785a7f9cd4cdc466315397031c1de9d8d23437f001b9d3d74ae66bce38` | `.../pi/screen-04-settled.txt` |
| `e2e1f2d3995b4ad9396cb383419f09d3eddc8633d6527b2d9307dc921c8fec6e` | `.../pi/observations.json` |
| `e6d7b9afe76c11d21847b438f97b6d8687aaf1f8958caf1f517bfc13c0826289` | `parity/research/setup-benny-creation-pi-001/disposition.json` |
| `e576101783702498af089397c1fea80b8b688fd303a3ec78f8df5e6e66a1afe5` | custody pack `definitions.json` |
| `9eea368548c2d990e426c6a8466a0a8d03e98bd8436e639eaefa6d838a8d8a4e` | custody pack `configurations.json` |

Machine-readable copy. `evidence-index.json`

Verify. `sh parity/research/acceptance-creation-boundary-freeze-prep-001/verify-evidence-index.sh`
