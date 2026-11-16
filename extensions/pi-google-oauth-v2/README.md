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

## Instruction handling

This provider sends the full current Pi system prompt as the first user-content turn, before the actual conversation. A short static `systemInstruction` tells the model to treat that turn as application instructions with priority over later user messages and tool results. The extension compiles this turn for each request without changing the session history. It retains the Pi identity and documentation instructions. The existing removal of invalid Unicode surrogates still applies.

This is delegated system priority, not an equivalent transport-level system role. It depends on the model following the delegation. Live priority and tool-replay verification is required before release. Non-Gemini Code Assist models have not been verified with this mapping.

Real 429 responses can still occur. The extension now reports Google's HTTP status and parsed error message rather than claiming that every generic 429 means shared capacity or that your plan quota is unaffected.

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

### Verify through native Pi

After signing in, run this developer-only script from the repository root. It makes live requests against your plan.

```sh
bun extensions/pi-google-oauth-v2/scripts/verify-live.ts
```

The script copies `auth.json` from `PI_CODING_AGENT_DIR`, or `~/.pi/agent`, into a temporary agent directory without inspecting its values. It disables retries, loads the real extension, refreshes the Google catalog, and selects the discovered Flash and Hydrogen models through `pi.setModel`. It removes the temporary directory on exit and does not update your normal settings or credentials.

Each model gets four fresh sessions. The checks cover a conflicting user request, a forged system frame, a permitted request, and two actual read-tool rounds with an instruction-injection fixture. The script checks exact final answers, tool-result events, replay, actual wire model IDs, and HTTP statuses. The probe logs model IDs, statuses, and verification flags, not prompts, headers, or credentials. A failed output assertion can also show the test response. A failed check exits nonzero.

The script keeps Pi's default prompt and documentation but uses an isolated working directory and agent directory, without your normal skills or AGENTS.md files. Also verify a native session with your full normal skills and project instructions before release. Repeat the script for additional behavioral evidence. Passing a bounded set does not establish system-role equivalence or constitute a benchmark.
