# Routines

A routine tells one Bot when to run a workflow. It can run on a schedule, or when something happens, such as a Slack message, a GitHub, Linear, Sentry, or PagerDuty event, an email, or a webhook call. Routines run in the cloud while your laptop is closed.

## How do I set up or change a routine?

Ask the Bot in chat. Say what it should do and when. For example: "Every weekday at 9:00 AM, summarize new support tickets in this chat." The Bot creates the routine, and it appears in the Bot's routines.

To change a routine on desktop, open it and choose **Edit**. Grok Bot starts a message to the Bot that begins "Edit your routine:" with the routine's name. Add what should change, then send it.

On the phone, open the Bot's profile and tap **Add routine** under **Routines**. Grok Bot starts a message that begins "Set up a routine to ". Finish the sentence and send it.

## Where do I see a Bot's routines?

On desktop:

1. Click the Bot's name at the top of the chat to open its details.
2. Choose **Tasks**. Routines are under **Routines**.

Each row shows the routine's name and when it runs, or **Paused**. Use the switch on the row to pause or resume it. If the Bot has no routines, you see **Ask in chat to set a routine**.

Click a routine to open it:

- **Instruction** is what the Bot does on each run.
- **When to run** lists the schedule and the events that start it.
- **Webhook** shows the URL and key, for a routine that a webhook call starts.

The buttons at the bottom are **Pause** or **Resume**, **Test**, **Edit**, and **Delete routine** (the trash icon). Deleting asks you to confirm. It stops future runs and can't be undone.

On the phone, open the Bot's profile and find **Routines**. Tap a routine to see **Active**, **Schedule**, **Next run**, **Instruction**, and **Run history**. Turn off **Active** to pause the routine. To delete one, swipe the routine's row.

## How do schedules and time zones work?

Schedules use the time zone in **Settings**, under **Bot**, labeled **Timezone**. **Auto-detect** follows this computer. Pick a zone when the routine should follow a different one, such as the office where the work belongs.

![The Bot section in Grok Bot's General settings, with the Timezone menu set to Auto-detect](/docs-static/images/grok-bot/settings-bot-section-light.png)

Ask for a schedule in plain words, like "every weekday at 8:00 AM" or "every 2 hours". Then open the routine and check **When to run**. It shows the saved schedule in words, so you can confirm it matches what you meant. If it doesn't, choose **Edit** and tell the Bot what to fix.

A new routine waits for its next scheduled time. It doesn't run when it's created. If you set up "every day at 8:00 AM" at 8:05, the first run is tomorrow at 8:00 AM. To try it right away, use **Test**.

## How do I test a routine?

Open the routine on desktop and choose **Test**. The button says **Running…** until the run finishes. The result shows up in the Bot's chat.

A test does real work. It can change files and use connected plugins. Use a safe input. If the test can't start, you see **Couldn't start a test run**, or a message that explains why.

Some routines don't show **Test**. They still run on their schedule or trigger.

## What should I change if usage drops quickly?

Start with how often your routines run. Each run spends usage, so a routine that runs often spends more than one that runs rarely. An hourly schedule, a short interval, or a Slack trigger on a busy channel can use a week of usage in a day.

If **Weekly usage** is falling faster than you expect, pause routines you don't need. Then ask the Bot to widen schedules and narrow Slack triggers before you raise a plan or an on-demand limit. A routine that never runs doesn't spend usage. **Test** does, because it performs the work.

See [Plans and billing](https://cursor.com/help/grok-bot/plans.md) for weekly usage and the on-demand monthly limit.

## How do Slack triggers work?

A Slack trigger is part of a routine, not the Slack plugin. The plugin lets a Bot post and read as the Slack user you connected. A trigger starts the routine when something happens in Slack. Connect Slack on the Cursor account that owns the Bot before you rely on it. See [Connect plugins](https://cursor.com/help/grok-bot/connect-plugins.md#what-can-a-plugin-do).

Ask the Bot for the trigger you want. A routine can start when the Bot is mentioned, when a word or phrase is mentioned, when you react to a message, or on any message. It can watch one channel or all of Slack. **When to run** shows the trigger in words, such as a phrase and a channel.

Keep the channel and phrase narrow. A trigger on any message in a busy channel runs often and spends usage on messages that don't need the Bot. Only new activity counts. Messages from before the trigger existed don't start a run.

## Where do the webhook URL and key live, and what does a 200 mean?

Ask the Bot to add a webhook trigger to the routine. Then open the routine on desktop. The **Webhook** section shows three fields:

- **POST to** is the URL.
- **key** is the secret. Senders include it as `Authorization: Bearer <key>`.
- **header** is that full header, ready to copy.

Click a field to copy it. Send an HTTP POST to that URL with the header. You can send a JSON body. The Bot receives that body with the routine instruction.

A response of **200** means Grok Bot accepted the call and started a run. It does not mean the Bot has finished the instruction. Check the Bot's chat for the result. Any other response means a run did not start. Confirm the routine isn't paused and that the request uses the current key.

## Why hasn't my routine run?

Check these first:

- The routine isn't **Paused**. On the phone, **Active** is on.
- **When to run** shows the schedule or trigger you expect, in the right time zone.
- A new schedule waits for its next time. Use **Test** to run it now.
- For Slack, the message is new, in the channel the trigger watches, and matches its phrase.
- For a webhook, the call returned **200** and used the current key.

On the phone, **Run history** shows each recent run as **Running**, **Succeeded**, or **Failed**. A failed run shows its reason. **No runs yet** means nothing has started the routine yet.

## Related

- [Work with Grok Bot](https://cursor.com/docs/grok-bot/work.md#skills-and-routines)
- [Grok Bot How Tos](https://cursor.com/help/grok-bot/how-to.md)
- [Plans and billing](https://cursor.com/help/grok-bot/plans.md)
- [Connect plugins](https://cursor.com/help/grok-bot/connect-plugins.md)
- [Grok Bot on mobile](https://cursor.com/help/grok-bot/mobile.md)
- [Get help](https://cursor.com/help/grok-bot/get-help.md)


---

## Sitemap

[Overview of all docs pages](/llms.txt)
