# pi-google-oauth-v2

Use a Google AI plan in Pi. The extension signs in with your Google account the way Google's Antigravity CLI does and sends requests to Code Assist, so they count against your plan's quota, not an API key.

## Sign in

1. Start Pi and run `/login`.
2. Select **Sign in with an account**, then **Google AI subscription**.
3. Sign in in the browser with the Google account that has your plan.

Pi shows the plan tier and the Code Assist project that Google reports. Pi stores the tokens in `~/.pi/agent/auth.json` and refreshes them when they are about to expire.

If Pi runs on a machine without a browser, open the **Code page** link on another machine, sign in, and paste the code that the page shows.

`pi auth login` does not work for this provider. That command loads only Pi's built-in providers, not extension providers.

## Pick a model

Run `/model` and pick a `google-oauth-v2` model. Pi asks Google for the models your plan serves and lists one entry per model family, such as `gemini-4-hydrogen` or `claude-sonnet-5-5`. Until the first refresh after sign-in, Pi lists `gemini-4-argon` and `gemini-3.8-flash`. Plan usage is not metered per token, so Pi shows no price.

Google serves each effort as its own model id, such as `gemini-4-hydrogen-high`. Pi's thinking level picks the id. Pi offers only the levels the family has, and no level sends `medium`. Google rejects a model it does not serve with its own error text, and Pi shows that text.

## Set a project

Most personal accounts need no project. If `/login` fails and asks for `GOOGLE_CLOUD_PROJECT`, set it to your Google Cloud project ID (the string, not the number) and run `/login` again:

```sh
GOOGLE_CLOUD_PROJECT=my-project-id pi
```

Pi reads the variable only during `/login`. To change the project later, run `/login` again.

## Plan support

Google's Antigravity documentation lists the Free, Google AI Pro, and Google AI Ultra plans. It does not list Google AI Plus. The extension does not block any plan. Google decides, and if it refuses your account, `/login` shows Google's message. If Google asks you to validate the account, `/login` shows the validation link. Validate the account in the browser, then run `/login` again.

## How it works

Google retired Gemini CLI's OAuth client for individual plans. The extension now reuses the Antigravity CLI's public OAuth client and calls the same Code Assist endpoint, `daily-cloudcode-pa.googleapis.com/v1internal`, with the `User-Agent` and request shape that the Antigravity CLI sends. Google accepts a request only when it carries that `User-Agent`. Google can restrict this client, change the header it checks, or retire the endpoint without notice. If sign-in fails with a message that the client is no longer supported, Google changed the gate.
