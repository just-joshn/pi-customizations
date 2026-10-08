# Cursor service and built-in contract discovery

## Overview

These artifacts propose host dependencies for later independent audit. They do not verify behavior or close the dependency graph. New retrievals use official Cursor Markdown endpoints. `retrievals/` preserves each response body, response headers, curl response metadata, source URL, local retrieval start and finish timestamps, and SHA-256 digests. The OpenAPI YAML is preserved but unread. The Cloud Agents API reference is only partially read. `read-receipts.json` names the exact ranges.

## Key concepts

Cloud agents, CLI local agents, Grok Bots, routines, and automations have different permission and persistence contracts. They cannot be merged into one generic background worker.

The Cloud Agents capabilities document describes conversation-owned subscriptions, coalesced bursts, follow-up wakes with context, a maximum lifetime of 180 days, and automatic unsubscription when the wait ends. GitHub CI waits for every check on the commit. Pending checks hold back delivery. See `retrievals/docs_cloud-agent_capabilities.md`, lines 118-159. The built-in `/subscribe` and `/loop` remain host dependencies. Their complete tool and instruction contracts are not supplied by this section.

Automations have scheduled, source-control, Slack, webhook, Linear, Sentry, and PagerDuty triggers. Every branch remains a proposal, including GitHub, GitLab, and Bitbucket differences, fork rejection and the merged-fork exception. An automation can have several triggers and runs when any fires. Tools include default PR creation, optional review approvals, reviewer requests, Slack read and write access, MCP, default memories, and computer use. No-repository, single-repository, and multi-repository runs differ. Run identity, billing identity, sharing controls, and personal versus service-account auth differ. See `retrievals/docs_cloud-agent_automations.md` and its section edges in `proposals.json`.

Grok Bot routines run with the laptop closed. Scheduled routines wait for the next scheduled time and do not run on creation. Test performs real work. Pause, resume, edit, and destructive deletion are separate controls. Webhook HTTP 200 means accepted and started, not completed. Bot UI's eight-second single-try sender and untrusted wake envelope come from pstack's `make-bot-ui/SKILL.md`, not the API status-change webhook. See `retrievals/help_grok-bot_routines.md`, lines 36-90, and the root pstack seed edges.

## How it works

Browser controls include navigation, click, typing, scrolling, screenshots, console, and network observation. Browser state persists per workspace. Manual approval, allowlisted actions, and auto-run are distinct branches. Enterprise origin policy blocks tool actions outside configured origins but admits documented link, redirect, and JavaScript navigation exceptions. The public page describes tools, not their complete argument schemas. See `retrievals/docs_agent_tools_browser.md`, lines 23-61 and 105-188.

Grok Bot secret values are write-only and never shown to the Bot, including through Shell. Secure secret cards exclude values from chat and the model. Public docs describe page filling and saved-name management. They do not resolve pstack's exact `SendToUser` secret-request schema or connector credential-file delivery. Treat that delivery path as unresolved rather than reading or logging a secret. See `retrievals/help_grok-bot_secrets.md`, lines 5-28, and `retrievals/docs_grok-bot_security.md`, lines 62-77.

Cloud API v1 separates durable agents and per-prompt runs. Only one run is active per agent. Cancellation is terminal for that run. Streaming reconnect uses opaque event IDs and a repeated framing status. Expired streams require reading terminal run state instead of retrying forever. Agent-level Git snapshots are not attributable to one run without more evidence. See `retrievals/docs_cloud-agent_api_endpoints.md`, lines 349-712. The API is beta. The public v0 status-change webhook is a separate contract and cannot be substituted for routine wake delivery.

Model identity is an observation problem. Cloud metadata's `turn/model` identifies the serving model when known, including Auto resolution. Metadata is unsigned and is not a credential. Signed OIDC has a different purpose. The local research runtime labels are in `../runtime-identity.json`. They are not physical-provider authentication. See `retrievals/docs_cloud-agent_metadata.md`, lines 89-147. Models and pricing do not establish live entitlement.

## Where things live

- `proposals.json` contains section-level nodes and evidence edges. Section grouping preserves branches but is not an independently falsifiable acceptance definition.
- `read-receipts.json` records personally inspected ranges and full-source hashes.
- `queue.json` records linked documents and unread API and OpenAPI ranges. Cross-partition reconciliation remains required.
- `retrievals/` contains immutable response captures with separate metadata files.

## Gotchas

The cloud capabilities page excludes SSE and `mcp-remote`, while API v1 create prose accepts `http`, `sse`, and `stdio`. Keep both source statements. Resolve their UI/API scope and schema compatibility before proposing one universal transport rule. See capabilities lines 33-55 and API lines 127-149.

The automation help page describes a team's shared service account, while the automation reference says each service-account automation gets a dedicated account and older shared accounts migrate on save. The statements are not reconciled. See automation reference lines 245-255 and help lines 92-96.

The routine panel navigation in pstack differs from the current help document. Pstack says Routines under the computer preview after opening the chat header. Help says choose Tasks and then Routines. This is a source discrepancy pending reference observation, not permission to change the UI expectation.

The secret delivery path also needs reconciliation. Public write-only secret behavior cannot justify exposing a value to the model to satisfy the plugin's credential-file instruction.

Missing public schemas, an untested or inaccessible working service, and a correct unavailable-service response are different states. The parent progress records a Cursor usage-limit failure. This task did not reproduce it and did not run successful service journeys. That historical observation cannot close any working-service branch.

## Remaining prerequisites and exact next step

Read `retrievals/docs_cloud-agent_api_endpoints.md` lines 801-2879 in chunks of at most 400 lines. Read `retrievals/docs-static_cloud-agents-openapi.yaml` completely in bounded chunks. Reconcile MCP transport statements against the actual schema before adding a resolved transport edge. Then retrieve the queued built-in, machine, identity, integration, and security contracts with the same response envelope. Runtime captures require separate authorization and working reference access. No automation, routine, browser session, publication, deployment, spending change, or communication occurred.
