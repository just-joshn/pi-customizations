# Target routing

Choose the first tool from the target the user supplied.

| Target | First tool | Requirements |
| --- | --- | --- |
| Executable, library, analysis database | `open_binary`, then `inspect_binary_layout` / `inspect_go_binary` as needed | Identity and static layout are in-process; deep providers are not implemented |
| Archive or package (ZIP, APK, IPA, MSIX) | `open_binary`, then `inspect_artifact` | Inventory is implemented for ZIP-family containers |
| Extracted JavaScript or Electron tree, ASAR | `analyze_javascript_application` | Implemented in-process |
| Managed PE or assembly | `inspect_managed_artifact` | Not implemented |
| HAR network capture | `inspect_web_network_capture` | Implemented for `format: "har"`; mitmproxy fails closed |
| Packet capture or summary | `inspect_packet_capture`, `inspect_pcap_capture` | Linux and caller-supplied tshark; not implemented |
| Logic or signal recording | `decode_signal_recording` | Linux and caller-supplied sigrok-cli; not implemented |
| Firmware image | `inspect_firmware_regions`, `extract_firmware` | Caller-supplied Binwalk/Unblob; not implemented |
| Android package | `inspect_android_package` | JADX and a JDK; not implemented |
| Android device | `inspect_adb_client`, then the device tools | Caller-supplied adb; not implemented |
| Browser page already open | `list_browser_targets` | A Chrome-family browser; not implemented |
| Electron app already open | `list_electron_targets` | Not implemented |

`route` is a skill/CLI helper in the absorbed analysis modules. It is not a
6.8.0 oracle MCP tool and is not registered through `pi.registerTool`.

## What identity reports

`open_binary` returns `path` (resolved), `format`, `kind`, `sha256` and
`architecture` for Mach-O (thin and universal), ELF, PE and ZIP content, which
is the part of the target contract this port implements. A directory, an
unsupported format or a missing path is refused as `target_unavailable`.
JavaScript application directories go through `analyze_javascript_application`
directly.

## When a tool is not implemented

`binary_session` lists every advertised tool with `available`, `reason` and
`remediation`. A tool with `reason: "not_implemented"` answers
`capability_unavailable`; that is a coverage gap in this port, not a statement
about the target. Two tools whose source kind or status vocabulary you should
know: `inspect_analysis_view` takes `retained-evidence` or `inline`, and
`update_unknown` takes a status of `open`, `investigating`, `blocked`,
`contradicted` or `resolved`. Absorbed view kinds are `summary`, `section`,
`item`, `inventory`, and `api-surface`; other kinds fail closed.
