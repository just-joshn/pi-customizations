# Cloud Agents API v0 (legacy)

This page documents the **legacy v0 API**. New integrations should use the current [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints.md), which reorganizes resources around a durable agent and per-prompt runs. v0 remains available during the migration window.

The Cloud Agents API lets you programmatically launch and manage cloud agents that work on your repositories.

- The v0 Cloud Agents API uses [Basic Authentication](https://cursor.com/docs/api.md#authentication). Generate a user API key from [Cursor Dashboard → API Keys](https://cursor.com/dashboard/api), or use a [service account API key](https://cursor.com/docs/account/enterprise/service-accounts.md).
- For details on authentication methods, rate limits, and best practices, see the [API Overview](https://cursor.com/docs/api.md).
- View the full [v0 OpenAPI specification](/docs-static/cloud-agents-openapi-v0.yaml) for detailed schemas and examples.
- MCP (Model Context Protocol) is not yet supported by the Cloud Agents API.

## Endpoints

### List Agents

GET

`/v0/agents`

List all cloud agents for the authenticated user.

#### Query Parameters

`limit` number (optional)

Number of cloud agents to return. Default: 20, Max: 100

`cursor` string (optional)

Pagination cursor from the previous response

`prUrl` string (optional)

Filter agents by pull request URL

```bash
curl --request GET \
  --url https://api.cursor.com/v0/agents \
  -u YOUR_API_KEY:
```

**Response:**

```json
{
  "agents": [
    {
      "id": "bc_abc123",
      "name": "Add README Documentation",
      "status": "FINISHED",
      "source": {
        "repository": "https://github.com/your-org/your-repo",
        "ref": "main"
      },
      "target": {
        "branchName": "cursor/add-readme-1234",
        "url": "https://cursor.com/agents?id=bc_abc123",
        "prUrl": "https://github.com/your-org/your-repo/pull/1234",
        "autoCreatePr": false,
        "openAsCursorGithubApp": false,
        "skipReviewerRequest": false
      },
      "summary": "Added README.md with installation instructions and usage examples",
      "createdAt": "2024-01-15T10:30:00Z"
    },
    {
      "id": "bc_def456",
      "name": "Fix authentication bug",
      "status": "RUNNING",
      "source": {
        "repository": "https://github.com/your-org/your-repo",
        "ref": "main"
      },
      "target": {
        "branchName": "cursor/fix-auth-5678",
        "url": "https://cursor.com/agents?id=bc_def456",
        "autoCreatePr": true,
        "openAsCursorGithubApp": true,
        "skipReviewerRequest": false
      },
      "createdAt": "2024-01-15T11:45:00Z"
    }
  ],
  "nextCursor": "bc_ghi789"
}
```

### Agent Status

GET

`/v0/agents/{id}`

Retrieve the current status and results of a cloud agent.

#### Path Parameters

`id` string

Unique identifier for the cloud agent (e.g., bc\_abc123)

```bash
curl --request GET \
  --url https://api.cursor.com/v0/agents/bc_abc123 \
  -u YOUR_API_KEY:
```

**Response:**

```json
{
  "id": "bc_abc123",
  "name": "Add README Documentation",
  "status": "FINISHED",
  "source": {
    "repository": "https://github.com/your-org/your-repo",
    "ref": "main"
  },
  "target": {
    "branchName": "cursor/add-readme-1234",
    "url": "https://cursor.com/agents?id=bc_abc123",
    "prUrl": "https://github.com/your-org/your-repo/pull/1234",
    "autoCreatePr": false,
    "openAsCursorGithubApp": false,
    "skipReviewerRequest": false
  },
  "summary": "Added README.md with installation instructions and usage examples",
  "createdAt": "2024-01-15T10:30:00Z"
}
```

`repoUrl` omits embedded credentials when the original repository URL includes userinfo.

### Agent Conversation

GET

`/v0/agents/{id}/conversation`

Retrieve the conversation history of a cloud agent, including all user prompts and assistant responses.

If the cloud agent has been deleted, you cannot access the conversation.

#### Path Parameters

`id` string

Unique identifier for the cloud agent (e.g., `bc_abc123`)

```bash
curl --request GET \
  --url https://api.cursor.com/v0/agents/bc_abc123/conversation \
  -u YOUR_API_KEY:
```

**Response:**

```json
{
  "id": "bc_abc123",
  "messages": [
    {
      "id": "msg_001",
      "type": "user_message",
      "text": "Add a README.md file with installation instructions"
    },
    {
      "id": "msg_002",
      "type": "assistant_message",
      "text": "I'll help you create a comprehensive README.md file with installation instructions. Let me start by analyzing your project structure..."
    },
    {
      "id": "msg_003",
      "type": "assistant_message",
      "text": "I've created a README.md file with the following sections:\n- Project overview\n- Installation instructions\n- Usage examples\n- Configuration options"
    },
    {
      "id": "msg_004",
      "type": "user_message",
      "text": "Also add a section about troubleshooting"
    },
    {
      "id": "msg_005",
      "type": "assistant_message",
      "text": "I've added a troubleshooting section to the README with common issues and solutions."
    }
  ]
}
```

### Agent Artifacts

GET

`/v0/agents/{id}/artifacts`

List artifacts generated by a cloud agent created within the last 6 months. Each artifact includes an `absolutePath` that points to the file's location on the agent's filesystem. To download an artifact, pass this path to the download endpoint.

#### Path Parameters

`id` string

Unique identifier for the cloud agent (e.g., `bc-00000000-0000-0000-0000-000000000001`)

The `absolutePath` in the response is a filesystem path, not a URL. Use the [download endpoint](https://cursor.com/docs/cloud-agent/api/v0.md#download-an-artifact) with this path to get a presigned download URL.

This endpoint returns at most 100 artifacts. If the agent is older than 6 months, the request returns a `400` error.

This endpoint is rate limited to **300 requests per minute** and **6000 requests per hour**.

```bash
curl --request GET \
  --url https://api.cursor.com/v0/agents/bc-00000000-0000-0000-0000-000000000001/artifacts \
  -u YOUR_API_KEY:
```

**Response:**

```json
{
  "artifacts": [
    {
      "absolutePath": "/opt/cursor/artifacts/screenshot.png",
      "sizeBytes": 12345,
      "updatedAt": "2024-01-15T11:02:00.000Z"
    },
    {
      "absolutePath": "/opt/cursor/artifacts/demo.mp4",
      "sizeBytes": 67890,
      "updatedAt": "2024-01-15T11:03:10.000Z"
    }
  ]
}
```

### Download an Artifact

GET

`/v0/agents/{id}/artifacts/download`

Retrieve a temporary 15-minute presigned S3 URL for a specific artifact from an agent created within the last 6 months.

#### Path Parameters

`id` string

Unique identifier for the cloud agent (e.g., `bc-00000000-0000-0000-0000-000000000001`)

#### Query Parameters

`path` string

Absolute artifact path from the list artifacts response (for example, `/opt/cursor/artifacts/screenshot.png`)

Use the `absolutePath` value returned by the list artifacts endpoint as the `path` query parameter. The response includes the presigned `url` and an `expiresAt` timestamp. `expiresAt` is when the URL expires.

If the agent is older than 6 months, this endpoint returns a `400` error.

This endpoint is rate limited to **300 requests per minute** and **6000 requests per hour**.

```bash
curl --request GET \
  --url "https://api.cursor.com/v0/agents/bc-00000000-0000-0000-0000-000000000001/artifacts/download?path=/opt/cursor/artifacts/screenshot.png" \
  -u YOUR_API_KEY:
```

**Response:**

```json
{
  "url": "https://cloud-agent-artifacts.s3.us-east-1.amazonaws.com/...",
  "expiresAt": "2026-03-04T22:30:00.000Z"
}
```

### Launch an Agent

POST

`/v0/agents`

Start a new cloud agent to work on your repository.

#### Request Body

`prompt` object (required)

The task prompt for the agent, including optional images

`prompt.text` string (required)

The instruction text for the agent

`prompt.images` array (optional)

Array of image objects with base64 data and dimensions (max 5)

`model` string (optional)

Set this to an explicit model ID (for example, `claude-4-sonnet`), or use `"default"` to use the configured default model. When omitted, Cursor uses your user default model, then your team default model, then a system default.

`source` object (required)

Repository source information

`source.repository` string (required unless prUrl is provided)

GitHub repository URL (e.g., [https://github.com/your-org/your-repo](https://github.com/your-org/your-repo))

`source.ref` string (optional)

Git ref (branch name or commit SHA) to use as the base branch

`source.prUrl` string (optional)

GitHub pull request URL. When provided, the agent works on this PR's repository and branches. If set, repository and ref are ignored.

`target` object (optional)

Target configuration for the agent

`target.autoCreatePr` boolean (optional)

Whether to automatically create a pull request when the agent completes. Default: false

`target.openAsCursorGithubApp` boolean (optional)

Whether to open the pull request as the Cursor GitHub App instead of as the user. Only applies if autoCreatePr is true. Default: false

`target.skipReviewerRequest` boolean (optional)

Whether to skip adding the user as a reviewer to the pull request. Only applies if autoCreatePr is true and the PR is opened as the Cursor GitHub App. Default: false

`target.branchName` string (optional)

Custom branch name for the agent to create

`target.autoBranch` boolean (optional, default: true)

Whether to create a new branch (true) or push to the PR's existing head branch (false). Only applies when source.prUrl is provided.

`webhook` object (optional)

[Webhook](https://cursor.com/docs/cloud-agent/api/webhooks.md) configuration for status change notifications

`webhook.url` string (required if webhook provided)

URL to receive [webhook](https://cursor.com/docs/cloud-agent/api/webhooks.md) notifications about agent status changes

`webhook.secret` string (optional)

Secret key for [webhook](https://cursor.com/docs/cloud-agent/api/webhooks.md) payload verification (minimum 32 characters)

```bash
curl --request POST \
  --url https://api.cursor.com/v0/agents \
  -u YOUR_API_KEY: \
  --header 'Content-Type: application/json' \
  --data '{
  "prompt": {
    "text": "Add a README.md file with installation instructions",
    "images": [
      {
        "data": "iVBORw0KGgoAAAANSUhEUgAA...",
        "dimension": {
          "width": 1024,
          "height": 768
        }
      }
    ]
  },
  "model": "claude-4.5-sonnet-thinking",
  "source": {
    "repository": "https://github.com/your-org/your-repo",
    "ref": "main"
  },
  "target": {
    "autoCreatePr": true,
    "branchName": "feature/add-readme"
  }
}'
```

**Default model example (`model: "default"`):**

```bash
curl --request POST \
  --url https://api.cursor.com/v0/agents \
  -u YOUR_API_KEY: \
  --header 'Content-Type: application/json' \
  --data '{
  "prompt": {
    "text": "Summarize open pull requests and suggest next steps"
  },
  "model": "default",
  "source": {
    "repository": "https://github.com/your-org/your-repo"
  }
}'
```

**Response:**

```json
{
  "id": "bc_abc123",
  "name": "Add README Documentation",
  "status": "CREATING",
  "source": {
    "repository": "https://github.com/your-org/your-repo",
    "ref": "main"
  },
  "target": {
    "branchName": "feature/add-readme",
    "url": "https://cursor.com/agents?id=bc_abc123",
    "prUrl": "https://github.com/your-org/your-repo/pull/123",
    "autoCreatePr": true,
    "openAsCursorGithubApp": false,
    "skipReviewerRequest": false
  },
  "createdAt": "2024-01-15T10:30:00Z"
}
```

### Add Follow-up

POST

`/v0/agents/{id}/followup`

Add a follow-up instruction to an existing cloud agent.

#### Path Parameters

`id` string

Unique identifier for the cloud agent (e.g., bc\_abc123)

#### Request Body

`prompt` object (required)

The follow-up prompt for the agent, including optional images

`prompt.text` string (required)

The follow-up instruction text for the agent

`prompt.images` array (optional)

Array of image objects with base64 data and dimensions (max 5)

```bash
curl --request POST \
  --url https://api.cursor.com/v0/agents/bc_abc123/followup \
  -u YOUR_API_KEY: \
  --header 'Content-Type: application/json' \
  --data '{
  "prompt": {
    "text": "Also add a section about troubleshooting",
    "images": [
      {
        "data": "iVBORw0KGgoAAAANSUhEUgAA...",
        "dimension": {
          "width": 1024,
          "height": 768
        }
      }
    ]
  }
}'
```

**Response:**

```json
{
  "id": "bc_abc123"
}
```

### Stop an Agent

POST

`/v0/agents/{id}/stop`

Stop a running cloud agent. This pauses the agent's execution without deleting it.

You can only stop agents that are currently running. If you send a follow-up prompt to a stopped agent, it will start running again.

#### Path Parameters

`id` string

Unique identifier for the cloud agent (e.g., `bc_abc123`)

```bash
curl --request POST \
  --url https://api.cursor.com/v0/agents/bc_abc123/stop \
  -u YOUR_API_KEY:
```

**Response:**

```json
{
  "id": "bc_abc123"
}
```

### Delete an Agent

DELETE

`/v0/agents/{id}`

Delete a cloud agent. This action is permanent and cannot be undone.

#### Path Parameters

`id` string

Unique identifier for the cloud agent (e.g., `bc_abc123`)

```bash
curl --request DELETE \
  --url https://api.cursor.com/v0/agents/bc_abc123 \
  -u YOUR_API_KEY:
```

**Response:**

```json
{
  "id": "bc_abc123"
}
```

### List Pending Pool Requests

GET

`/v0/private-workers/pending-requests`

List Team Pool requests that have not been assigned to a self-hosted worker yet. Use this endpoint to scale worker capacity when users are waiting for an available pool worker.

This endpoint requires a service account API key. It returns requests for the key's team and excludes My Machines requests. If the key is scoped to specific repositories, pass `repository`; the repository must be in the key's allowed scope.

#### Query Parameters

`limit` number (optional)

Number of pending requests to return. Default: 50, Max: 100

`pageToken` string (optional)

Pagination cursor from the previous response

`repository` string (optional)

Filter by repository URL. Required for repo-scoped service account API keys.

`pool` string (optional)

Filter by pool name. Exact, case-sensitive match against the request's `pool` label. Omit to list requests for every pool on the team.

#### Response Fields

`requests` array

Pending requests with `id`, `userId`, optional `userEmail` / `serviceAccountId` / repo fields, `labels`, and `createdAtMs`.

`nextPageToken` string (optional)

Pagination cursor. Omitted when there are no more pages.

`streamCursor` string

Opaque resume position for the SSE watch endpoint, [Watch Pending Pool Requests](https://cursor.com/docs/cloud-agent/api/endpoints.md#watch-pending-pool-requests). Expires five minutes after the list that issued it.

Worker and pool endpoints beyond pending requests (list/get workers, pools, the SSE watch, claim, release) live on the current [Cloud Agents API](https://cursor.com/docs/cloud-agent/api/endpoints.md#workers-and-pools) reference.

```bash
curl --request GET \
  --url "https://api.cursor.com/v0/private-workers/pending-requests?limit=50&repository=https%3A%2F%2Fgithub.com%2Facme%2Fpayments-service" \
  -u YOUR_SERVICE_ACCOUNT_API_KEY:
```

**Response:**

```json
{
  "requests": [
    {
      "id": "bc-00000000-0000-0000-0000-000000000002",
      "userId": 321,
      "userEmail": "owner@acme.example",
      "serviceAccountId": "sa_abc123",
      "repoOwner": "acme",
      "repoName": "payments-service",
      "repoUrl": "https://github.com/acme/payments-service",
      "labels": [
        { "key": "repo", "value": "acme/payments-service" },
        { "key": "pool", "value": "gpu" },
        { "key": "env", "value": "production" }
      ],
      "createdAtMs": 1737306880000
    }
  ],
  "nextPageToken": "eyJjcmVhdGVkQXRNcyI6MTczNzMwNjg4MDAwMH0=",
  "streamCursor": "djQuZXhhbXBsZS1vcGFxdWUtY3Vyc29y"
}
```

`repoUrl` omits embedded credentials when the original repository URL includes userinfo.

### API Key Info

GET

`/v0/me`

Retrieve information about the API key being used for authentication.

```bash
curl --request GET \
  --url https://api.cursor.com/v0/me \
  -u YOUR_API_KEY:
```

**Response:**

```json
{
  "apiKeyName": "Production API Key",
  "createdAt": "2024-01-15T10:30:00Z",
  "userEmail": "developer@example.com"
}
```

### List Models

GET

`/v0/models`

Returns a recommended set of explicit model IDs you can pass to the launch endpoint's `model` field. This list does not include `"default"`.

To use the configured default model, send `model` as `"default"` or omit `model`. When `model` is omitted, Cursor resolves your user default model, then your team default model, then a system default.

```bash
curl --request GET \
  --url https://api.cursor.com/v0/models \
  -u YOUR_API_KEY:
```

**Response:**

```json
{
  "models": [
    "claude-4-sonnet-thinking",
    "gpt-5.2",
    "claude-4.5-sonnet-thinking"
  ]
}
```

### List GitHub Repositories

GET

`/v0/repositories`

Retrieve a list of GitHub repositories accessible to the authenticated user.

**This endpoint has very strict rate limits.**

Limit requests to **1 / user / minute**, and **30 / user / hour.**

This request can take tens of seconds to respond for users with access to many repositories.

Make sure to handle this information not being available gracefully.

```bash
curl --request GET \
  --url https://api.cursor.com/v0/repositories \
  -u YOUR_API_KEY:
```

**Response:**

```json
{
  "repositories": [
    {
      "owner": "your-org",
      "name": "your-repo",
      "repository": "https://github.com/your-org/your-repo"
    },
    {
      "owner": "your-org",
      "name": "another-repo",
      "repository": "https://github.com/your-org/another-repo"
    },
    {
      "owner": "your-username",
      "name": "personal-project",
      "repository": "https://github.com/your-username/personal-project"
    }
  ]
}
```


---

## Sitemap

[Overview of all docs pages](/llms.txt)
