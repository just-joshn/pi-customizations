# pi-spacex-oauth-v2

Use your X subscription in Pi. The extension signs in the way Grok Build and the Cursor CLI do, so Pi can run Grok models and Cursor models against the plan included with your X subscription. It is for people who already pay for X and want those models in Pi.

## Install

```sh
pi install npm:@justjoshn/pi-spacex-oauth-v2
```

Built and tested against Pi 1.5.2.

## Sign in

1. Start Pi and run `/login`.
2. Choose **Grok Build (X subscription)** or **Cursor (X subscription)** and complete the prompts. Grok Build shows a code to confirm in the browser. Cursor opens a sign-in page.
3. Run `/model` and pick a `spacex-grok` model if you signed in to Grok Build, or a `spacex-cursor` model if you signed in to Cursor.

Run `/login` again to add the other provider. Until the first refresh after sign-in, Pi lists `grok-4.7`, `grok-4.7-build-fast`, `grok-4.6`, and `grok-4.5` for Grok Build, and `composer-2.5` and `composer-2.5-fast` for Cursor. After that, each list comes from the service and is saved for offline starts.

## Commands

`/spacex-usage` shows plan usage for the accounts you signed in to:

- **Cursor.** The percent of included usage used and its reset time. Cursor reports this for the whole subscription.
- **Grok Build.** The credits used this billing period, plus the remaining requests and tokens from the rate-limit headers of your latest Grok Build response.

While a `spacex-grok` or `spacex-cursor` model is selected, Pi also shows the Cursor percent, or the remaining Grok Build requests, in the status line.

## Notes

- **Undocumented endpoints.** The extension calls endpoints that Grok Build and Cursor do not document, and it identifies itself as their clients. A change to an endpoint, a client requirement, or account access can break sign-in or requests.
- **Your accounts only.** Use accounts you own.
- **Cost.** Subscription usage is not metered per token, so Pi shows no price.

## Replaces `@justjoshn/pi-x-subscription-oauth`

```sh
pi install npm:@justjoshn/pi-spacex-oauth-v2
pi remove npm:@justjoshn/pi-x-subscription-oauth
```

Then run `/login` again.

## Develop

```sh
bun run --filter @justjoshn/pi-spacex-oauth-v2 test
```
