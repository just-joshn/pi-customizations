# Host computer-use and enterprise edges

Disposition class: environment-bound.

## cursor-cli-host → cursor-self-hosted-computer-use

docSha256: `a9ceb020282d7c61ad99ccd13de0c8831dd57499ac32af31b5f4afc9e9e186d0`

Public docs only (computer-use.md). Closing this edge requires exercising macOS Cursor Computer Use helper identity (co.anysphere.cursor-computer-use / Team ID DCNK4UB866), Accessibility and Screen Recording grants, Linux X11/desktop packages, and desktop-sharing transport. This worker must not fabricate those runtime observations.

## cursor-cli-host → cursor-enterprise-integration-policy

docSha256: `2606b4bd74d43bd579c59945506ab691cd49de8da3386556e265c854f6c9d205`

Public docs only (model-management.md). Closing this edge requires observing live Enterprise team/org model access, MCP allowlist enforcement, and CLI applicability. Standing orders forbid broad allowlist or authorization changes.

Journey edges cursor-pstack → cursor-team-kit and cursor-pstack → cursor-cli-host stay unverified (paired runtime evidence missing).
