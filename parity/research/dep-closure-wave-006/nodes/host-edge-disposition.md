# Host computer-use / enterprise edges (wave-006)

dispositionClass: `environment-bound`
capture: `parity/research/dep-closure-wave-006/host-edge-disposition.json` sha256=`633d051d9febc7e247a357c78811b6e01cd2465c989cf34a55755243d73885a9`

Wave-006 re-hashed public continuation docs. Hashes unchanged from wave-005. Edges remain environment-bound unresolved.

## Edges

- `cursor-cli-host` → `cursor-self-hosted-computer-use` status=`unresolved` docSha256=`a9ceb020282d7c61ad99ccd13de0c8831dd57499ac32af31b5f4afc9e9e186d0`
  Blocker: Public docs only (computer-use.md). Closing this edge requires exercising macOS Cursor Computer Use helper identity (co.anysphere.cursor-computer-use / Team ID DCNK4UB866), Accessibility and Screen Recording grants, Linux X11/desktop packages, and desktop-sharing transport. This worker must not fabricate those runtime observations.
- `cursor-cli-host` → `cursor-enterprise-integration-policy` status=`unresolved` docSha256=`2606b4bd74d43bd579c59945506ab691cd49de8da3386556e265c854f6c9d205`
  Blocker: Public docs only (model-management.md). Closing this edge requires observing live Enterprise team/org model access, MCP allowlist enforcement, and CLI applicability. Standing orders forbid broad allowlist or authorization changes.
