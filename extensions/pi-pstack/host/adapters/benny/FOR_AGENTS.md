# Set up dormant Benny for Pi

Read [the native setup instructions](./SKILL.md). This directory is the packaged setup adapter. It is outside Pi skill discovery. In an installed project pack, read `skills/setup-benny/SKILL.md` instead.

Benny runs two reviewed automations for a configured Slack issue channel. Triage reads a report, traces its likely cause, checks tracker duplicates, and posts one verdict in the original thread. Repro waits for that trusted verdict, respects human ownership, reproduces the symptom twice through the real UI, verifies existing fixes, and may prepare one bounded draft pull request.

The source coordinates stay immutable. Only the coordinator can post to Slack. Workers receive no Slack credentials or write actions. A source root message is forbidden. Configuration, feature maps, routing maps, and secrets stay outside the managed pack. Repro fails closed without the required control capabilities. Neither workflow merges or deploys.

Installation copies dormant files only. It does not commit, create a live automation, start a receiver, send a message, or enable traffic. Ask for the target repository only if the user has not already named it. Do not create or change routine definitions until the user explicitly asks.
