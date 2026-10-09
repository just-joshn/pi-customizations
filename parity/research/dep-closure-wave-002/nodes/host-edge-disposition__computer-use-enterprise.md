# host-edge-disposition:computer-use-enterprise

Previously incomplete: False

## Disposition

Public Markdown contracts for self-hosted computer-use and enterprise model/integration management were re-hashed. Runtime helpers, desktop services, sharing transport, and live policy enforcement are closed or environment-bound. Edges from cursor-cli-host stay unresolved.

proposeReadingComplete: False
proposeDependenciesEnumerated: False

## Sources

- `parity/research/continuation/computer-use.md` sha256=`a9ceb020282d7c61ad99ccd13de0c8831dd57499ac32af31b5f4afc9e9e186d0` bytes=15653
  - lines 1-8 (non-empty):
```
# Computer use and desktop sharing
Computer use lets an agent on a [Self-Hosted Machines](https://cursor.com/docs/cloud-agent/self-hosted.md) worker click, type, take screenshots, and drive applications with a UI. Agents can also drive a browser when the worker has Chrome or Chromium installed. It works on macOS and Linux workers, for both [My Machines](https://cursor.com/docs/cloud-agent/self-hosted/my-machines.md) and [Team Pools](https://cursor.com/docs/cloud-agent/self-hosted/pool.md). Desktop sharing lets authorized viewers watch or take control of a Linux agent desktop from Cursor. For the product behavior on managed Cloud Agents, see [Capabilities](https://cursor.com/docs/cloud-agent/capabilities.md).
Computer use and desktop sharing are new. Install or update to the latest
Cursor CLI before you follow this guide: run `agent update`, or reinstall
with the steps in [Install the CLI
```
- `parity/research/continuation/model-management.md` sha256=`2606b4bd74d43bd579c59945506ab691cd49de8da3386556e265c854f6c9d205` bytes=12119
  - lines 1-8 (non-empty):
```
# Model and Integration Management
Your team can access multiple AI models and integrate Cursor with various services. This documentation covers how to control which models are available, manage MCP server trust, and set up integrations with tools like Slack, GitHub, and Linear.
## Model access control
Enterprise teams can control which AI models team members can use, [contact sales](https://cursor.com/contact-sales?source=docs-model-controls) to get access. This helps manage costs, ensure appropriate usage, and comply with organizational policies.
Configure model access in two places:
1. **Team Settings → Models** in the [team dashboard](https://cursor.com/docs/account/teams/dashboard.md) (Enterprise only). From Team Settings, open the **Model Providers** section to manage providers, models, defaults, and personal API key (BYOK) controls. This is the team baseline.
2. **Organization → G
```
