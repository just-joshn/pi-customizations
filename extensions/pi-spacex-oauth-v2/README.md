# pi-spacex-oauth-v2

Use your X subscription in Pi through Grok Build and Cursor sign-ins. This extension needs Pi 1.5.2 or later.

## Install

Install it with:

```sh
pi install npm:@justjoshn/pi-spacex-oauth-v2
```

To try it from this checkout, use `pi -e extensions/pi-spacex-oauth-v2`.

## Sign in and pick a model

1. Start Pi and run `/login`.
2. Choose **Grok Build (X subscription)** or **Cursor (X subscription)** and complete the sign-in prompts.
3. Run `/model` and pick a `spacex-grok` or `spacex-cursor` model for the account you signed in with.

Run `/login` again to sign in to the other provider if you use both. Run `/spacex-usage` to check the signed-in accounts' plan usage and the Grok Build rate limits returned by requests.

## Access risks

The extension uses undocumented Grok Build and Cursor endpoints and identifies requests as their clients. Vendor changes to those endpoints, client requirements, or account access can break sign-in or requests. Use only accounts you own.
