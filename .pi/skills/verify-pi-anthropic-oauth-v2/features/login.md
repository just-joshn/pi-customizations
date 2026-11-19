# Sign in and sign out

Users connect a Claude Pro or Max account to the `custom-anthropic` provider, or give it an API key, and can disconnect it without changing Pi's built-in Anthropic provider.

## Sub-features

- `login-picker`: `/login` → **Sign in with an account** lists **Custom Anthropic (Claude Pro/Max)**.
- `login-direct`: `/login custom-anthropic` opens the method menu for this provider only.
- `login-code-prompt`: choosing the account method shows a `https://claude.ai/oauth/authorize?...` link and `Paste the authorization code:`.
- `login-complete`: pasting the code Claude shows (`code#state`) stores an OAuth credential in the disposable profile.
- `login-api-key`: the menu's **Sign in with an API key** option stores a key instead.
- `logout`: `/logout` removes only this provider's credential.

## How to get to it (user POV)

- Run `/login`, choose **Sign in with an account**, then **Custom Anthropic (Claude Pro/Max)**.
- Run `/login custom-anthropic`, then choose **Sign in with an account** or **Sign in with an API key**.
- Run `/logout` and choose this provider after signing in.

## Driving it with verify.py and tmux

Preconditions: fresh `init` and passing doctor per journey. Completion needs a consenting user with a Claude subscription and browser access. Never borrow the parent session's auth.

- **Picker (zero network).** `"$V" drive "$E" --feature login-picker --step '/login' 'Sign in with an account' --step '' 'Custom Anthropic (Claude Pro/Max)'`. The provider row reads `Custom Anthropic (Claude Pro/Max) • not configured` in an empty profile.
- **Direct entry (zero network).** `"$V" drive "$E" --feature login-direct --step '/login custom-anthropic' 'Select authentication method for Custom Anthropic (Claude Pro/Max):' --step '' 'Paste the authorization code:'`. PKCE is local, so nothing is sent until a code is pasted. Require `network.jsonl` to hold only `observer-loaded` rows and scratch `agent/auth.json` to be absent or `{}`.
- **Complete.** Start `"$V" run "$E"` through `tmux_run` and repeat direct entry in `TARGET`. The user opens the link, signs in, and pastes the code themselves; never send it with `send-keys`. After Pi reports success, inspect only the stored provider ID, credential type `oauth`, and expiry. Then prove access with a real prompt (see [models](models.md)). Metadata alone is not login proof.
- **API key.** Choose **Sign in with an API key** and let the user enter a real key. Prove it with a real prompt. A fake key only proves the error path (see [requests](requests.md)).
- **Logout.** Send `/logout`, select this provider, and confirm. Require its credential to be absent, then send a prompt and require `No API key found for custom-anthropic.`

## Gotchas

- In Pi 1.5.2, `/login` opens an authentication-method menu before any provider list. Waiting for the provider label right after `/login` times out.
- The built-in provider also says Anthropic. Selecting `anthropic` is not extension proof; look for `Custom Anthropic` and `custom-anthropic`.
- The authorize URL holds a PKCE challenge and state. Redact shared captures, and never record tokens or copy auth files into evidence.
- A pasted bogus code sends a real token request to `console.anthropic.com`. Do not do that to prove the error path.
- Local cleanup removes this profile's login but does not revoke the upstream grant.
