Exit status is not the contract. The contract is the HTTP request and the Pi assistant event stream.

Exact:
- authorization is Bearer for a subscription token
- x-api-key is absent
- anthropic-version is 2023-06-01
- accept and content-type are application/json
- user-agent is claude-cli/<version>, default 2.1.280
- x-app is cli
- anthropic-beta includes claude-code-20250219 and oauth-2025-04-20
- the first system block is the billing header `x-anthropic-billing-header: cc_version=2.1.280.3a6; cc_entrypoint=sdk-cli;`, captured live from Provider CLI 2.1.280 on 2026-09-27. The gateway uses it to attribute the request to the Provider CLI plan; without it requests bill against extra usage and fail with a misleading out-of-usage notice
- the second system block is the Provider CLI preamble
- a null caller header deletes the named header
- missing token throws before a stream returns
- overflow text from the server is preserved
- abort is stop reason aborted, not a generic error

Intentional differences from the SDK reference:
- no Anthropic/JS user-agent
- no x-stainless-* headers
- no client-side retry loop. Pi retries after the stream reports the error
- OAuth token URL is https://platform.claude.com/v1/oauth/token, matching Pi 0.87.1, not the older console.anthropic.com example

Do not normalize those differences away.
