# Connect plugins

Connect Gmail, Notion, Slack, and other services so agents can use them in chat.

## What are plugins?

Plugins let agents talk to external services. Plugin connections belong to the **same account** you used to sign in to Grok Bot.

## How do I add a plugin?

1. In Grok Bot, select **Plugins** on the sidebar, or follow an in-chat **Connect** card. In the Grok Bot mobile app, tap your avatar on the top left and select **Plugins**.
2. Browse or search for the plugin, then add it.
3. When Grok Bot asks you to **Authorize** or **Authenticate**, finish the provider login in your browser.
4. If Grok Bot shows **Waiting for authorization**, use **Reopen** so the browser tab comes back.
5. Confirm the plugin appears under **Installed**.

## Why does a plugin say "Disabled by team admin"?

If you use Grok Bot through a Cursor team, your Cursor team admin controls which marketplace plugins are available. If a plugin is disabled, ask your admin to enable it.

That Cursor control is separate from a company Google admin. A Google block uses the screens in the next section.

## What if Google says an admin needs to review Grok?

A company Google account can stop the connection before Gmail, Calendar, Drive, Docs, Sheets, or Slides finishes signing in. Grok Bot signs in to Google as **Grok**, not Cursor. The Google page decides the next step.

**Your admin needs to review Grok**

Grok is not approved for that Workspace yet. On the Google page, request access if that button is there. Wait for the admin to approve Grok before you try **Authorize** again.

An IT admin approves **Grok** in the Google Admin console:

1. Open **Security**, then **Access and data control**, then **API controls**.
2. Open **App access control**, then **Manage third-party app access**.
3. Add the app named **Grok**. If name search does not find it, use the client ID from the blocked page or the admin review email.
4. Set Grok to **Trusted** for the people who use Grok Bot.

That approval covers the Google plugins those people connect. It does not turn a Cursor marketplace plugin back on. A Cursor team admin does that from the **Disabled by team admin** control above.

**Access blocked**

Google refused the sign-in. A personal Gmail account does not need a company admin. A company account often hits this when Grok is not on the allowlist, or when the admin has blocked third-party apps.

Ask the Google admin to trust **Grok**, using the steps above. If the page still says access is blocked after that, [contact support](https://cursor.com/help/grok-bot/get-help.md) with the Google account email and a screenshot of the blocked page. Changing browsers or linking the plugin again does not clear a Google admin block.

## What can a plugin do?

A plugin uses the account you authorize. It can do only what that account can already do in that service. It cannot raise your access, and it cannot change sharing.

**Google Calendar**

The bot can read calendars you can see, create and update events, check free time, and respond to invitations on calendars you can edit.

It cannot change Google Meet settings, such as the waiting room or host controls. It also cannot add a Zoom link to an event. A Zoom link added from the Calendar website uses Google's Zoom add-on, and that add-on is not available to the plugin. Put the Zoom link in the event location or description yourself, or create the event in Calendar and ask the bot to update the other fields.

**Google Sheets**

Connecting Sheets lets the bot read and edit cells in spreadsheets the connected Google account can edit. A file shared as Viewer stays view-only. The plugin cannot change who has access.

Finding and opening files uses the **Google Drive** plugin. Drive can search and read files that account can open. Editing cell content uses **Google Sheets**.

**Slack**

The Slack plugin posts as the Slack user you connected, not as a separate bot that has to be invited. It can post only in channels that user can post in. It cannot post in a private channel that user is not in, or in a channel where that workspace blocks posting. To use another Slack workspace, connect that workspace. This is separate from a Slack message that starts a routine. See [Routines](https://cursor.com/help/grok-bot/routines.md#how-do-slack-triggers-work).

**Gmail**

Gmail can search and read mail, draft and send, and apply labels on the connected mailbox.

## Can I connect two Gmail accounts?

No. Gmail connects one mailbox at a time. To use a different Gmail mailbox, disconnect the current one and authorize the other. You cannot keep a personal mailbox and a work mailbox connected to Gmail at the same time.

An installed plugin is available to every bot on that Grok Bot account. Disconnect Gmail if a bot should not use that mailbox. A teammate's [Team Bot](https://cursor.com/help/grok-bot/team-bots.md) asks before it uses your accounts.

Some other plugins, like Notion, can connect a second account. See [How do I add a second account for the same plugin?](https://cursor.com/help/grok-bot/how-to.md#how-do-i-add-a-second-account-for-the-same-plugin)

## A plugin is added, but the Bot says it's missing. What do I do?

**Added** means the plugin is installed, not that you are signed in. Open the plugin and choose **Authorize** if it shows **Needs auth** or **Disconnected**. For a connect card that never shows up or does nothing, see [How do I reconnect a plugin?](https://cursor.com/help/grok-bot/how-to.md#how-do-i-reconnect-a-plugin)

## Why does connecting to Zoom fail with error 4700 during authorization?

This is a known issue, and our engineers are working on a fix. Zoom authorization from the Grok Bot desktop app currently fails with error 4700 (Invalid redirect), and no change on your end will resolve it.

There is no workaround for now. We will update this article once Zoom can be connected.

## Related

- [Store secrets securely](https://cursor.com/help/grok-bot/secrets.md)
- [Sign in to Grok Bot](https://cursor.com/help/grok-bot/sign-in.md)
- [Grok Bot How Tos](https://cursor.com/help/grok-bot/how-to.md)
- [Get help](https://cursor.com/help/grok-bot/get-help.md)


---

## Sitemap

[Overview of all docs pages](/llms.txt)
