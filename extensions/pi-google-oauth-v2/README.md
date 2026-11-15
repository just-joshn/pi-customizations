# pi-google-oauth-v2

Use a Google AI plan in Pi. The extension signs in with your Google account the way Google's Antigravity CLI does and sends requests to Code Assist, so they count against your plan's quota and not an API key. It is for people with a Google AI Free, Pro, or Ultra plan who want to use its Gemini models in Pi.

## Install

```sh
pi install npm:@justjoshn/pi-google-oauth-v2
```

Built and tested against Pi 1.5.2.

## Sign in

1. Start Pi and run `/login`.
2. Choose **Google AI subscription**.
3. Sign in in the browser with the Google account that has your plan.

Pi then shows the plan tier and the Code Assist project that Google reports. Pi refreshes the tokens when they are about to expire.

If Pi runs on a machine without a browser, open the **Code page** link on another machine, sign in, and paste the code the page shows.

Run `/model` and pick a `google-oauth-v2` model. Pi asks Google which models your plan serves and lists one entry per model family. Until the first refresh after sign-in, it lists `gemini-4-argon` and `gemini-3.8-flash`. Google serves each thinking effort as its own model id, such as `gemini-4-argon-high`, and Pi's thinking level picks the id. Pi offers only the levels Google serves for the model.

## Commands

The extension adds no commands. It adds the provider `google-oauth-v2` and its login.

## Notes

- **Cost.** Plan usage is not metered per token, so Pi shows no price.
- **Project.** Most personal accounts need no project. If `/login` fails and asks for `GOOGLE_CLOUD_PROJECT`, set it to your Google Cloud project ID (the string, not the number) and run `/login` again. `GOOGLE_CLOUD_PROJECT_ID` also works. Pi reads the variable only during `/login`.

  ```sh
  GOOGLE_CLOUD_PROJECT=my-project-id pi
  ```

- **Plans.** Google's Antigravity documentation lists the Free, Google AI Pro, and Google AI Ultra plans, and does not list Google AI Plus. The extension blocks no plan. If Google refuses your account, `/login` shows Google's message. If Google asks you to validate the account, `/login` shows the validation link. Validate in the browser, then run `/login` again.
- **Unsupported client.** Google accepts requests only from the Antigravity CLI's public OAuth client, with its `User-Agent`, at `daily-cloudcode-pa.googleapis.com/v1internal`. Google can restrict that client, change the header it checks, or retire the endpoint without notice. If sign-in says the client is no longer supported, Google changed the check.

## Replaces `@justjoshn/pi-antigravity-oauth`

```sh
pi install npm:@justjoshn/pi-google-oauth-v2
pi remove npm:@justjoshn/pi-antigravity-oauth
```

Then run `/login` again.

## Develop

```sh
bun run --filter @justjoshn/pi-google-oauth-v2 test
```
