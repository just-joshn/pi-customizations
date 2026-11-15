# pi-google-oauth-v2

Use a Google AI Plus, Pro, or Ultra plan in Pi. The extension signs in with your Google account and sends requests to Gemini Code Assist, so they count against your plan's quota, not an API key.

## Sign in

1. Start Pi and run `/login`.
2. Select **Sign in with an account**, then **Google AI subscription**.
3. Sign in in the browser with the Google account that has your plan.

Pi shows the plan tier and the Code Assist project that Google reports. Pi stores the tokens in `~/.pi/agent/auth.json` and refreshes them when they are about to expire.

If Pi runs on a machine without a browser, open the **Code page** link on another machine, sign in, and paste the code that the page shows.

`pi auth login` does not work for this provider. That command loads only Pi's built-in providers, not extension providers.

## Pick a model

Run `/model` and pick a `google-oauth-v2` model:

- `gemini-2.5-pro`
- `gemini-3.1-pro-preview`
- `gemini-3.5-flash`
- `gemini-3.8-flash`
- `gemini-3-flash`
- `gemini-3.1-flash-lite`
- `gemini-3.5-flash-lite`

Context windows, output limits, and thinking levels come from Pi's own Google model catalog.

## Set a project

Most personal accounts need no project. If `/login` fails and asks for `GOOGLE_CLOUD_PROJECT`, set it to your Google Cloud project ID (the string, not the number) and run `/login` again:

```sh
GOOGLE_CLOUD_PROJECT=my-project-id pi
```

Pi reads the variable only during `/login`. To change the project later, run `/login` again.

## Plan support

Gemini CLI's quota documentation lists Google AI Pro and Google AI Ultra for this sign-in. It says that Google AI Plus is not supported. The extension does not block any plan. Google decides, and if it refuses your account, `/login` shows Google's message. If Google asks you to validate the account, `/login` shows the validation link. Validate the account in the browser, then run `/login` again.

## How it works

The extension reuses Gemini CLI's public OAuth client (`packages/core/src/code_assist/oauth2.ts` in `google-gemini/gemini-cli`) and calls the same Code Assist endpoint, `cloudcode-pa.googleapis.com/v1internal`. That endpoint is not a public Google API, so Google can change it without notice.
