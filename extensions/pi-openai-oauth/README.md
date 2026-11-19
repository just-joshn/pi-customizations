# pi-openai-oauth

Run Codex in [Pi](https://pi.dev) with the account you signed in to Codex with, such as your ChatGPT plan. The provider is built on [`@openai/codex-sdk`](https://learn.chatgpt.com/docs/codex-sdk) and follows the shape of Pi's `custom-provider-anthropic` example.

## Install

```sh
pi install npm:@justjoshn/pi-openai-oauth
```

## Sign in

The Codex SDK controls the local Codex agent, so it uses your Codex sign-in. Sign in through the Codex CLI first. Pi stores no OpenAI credentials for this provider.

## Use

Pick a model with `/model`:

| Model | What it runs |
| --- | --- |
| `openai-oauth/codex-default` | The default model in your Codex configuration. |
| `openai-oauth/gpt-6.1-sol` | GPT-6.1 Sol. It must be available to your signed-in account. |

## How it works

Each Pi request runs one Codex turn with `thread.run()`. Pi shows the turn's `finalResponse` as the reply.

- New threads carry the source label `pi`.
- A follow-up resumes the Codex thread that wrote the last reply and sends only the new messages. If the history changed, for example after a branch or a model switch, the provider starts a new thread with the whole conversation.
- Codex runs its own tools in its configured sandbox during the turn. Pi's tools are not passed to Codex, and the reply never contains Pi tool calls.

## Limits

The SDK surface this provider uses returns only a final text response. It does not stream partial text or report token usage. It does not take images or Pi's thinking levels. Usage and cost show as zero. The thread index lives in memory, so after a restart the first request starts a new thread with the whole conversation. Cancelling a request ends it in Pi, but the Codex turn may finish in the background.
