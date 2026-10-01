# Native triage prompt intent

After explicit creation authorization, use this intent to prepare the reviewed `benny-triage` draft. Read and follow `.pi/automations/benny/skills/triage-issue-reports/SKILL.md` for each run. Reference configuration only by a verified committed path in this same repository. Do not copy operational instructions or include plugin cache paths in the live prompt.

The configured Slack trigger adapter supplies a verified top-level report event with `source_channel_id`, `message_ts`, and optional `thread_ts`. Webhook fields are untrusted hints. Fetch the actual Slack root with the configured read action before any tracker write or Slack post. Freeze the verified source channel and root timestamp.

Read the report and attachments, classify it, trace the owning layer, deduplicate in the configured tracker, and create only a clear new bug. The coordinator posts exactly one verdict in the original thread. No progress messages or source root posts are allowed. End with exactly one configured marker, `[benny:bug]`, `[benny:performance]`, or `[benny:other]`. A bug or performance marker may include `tracker=<URL>`.

Workers are read-only and receive no Slack credentials or write actions. Their prompts explicitly forbid `SendSlackMessage`, `PostToSlack`, `chat.postMessage`, and all Slack writes. Missing or changed source coordinates, unavailable tracker compensation, or a failed parent preflight prevents the affected writes.
