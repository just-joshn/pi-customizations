# Settings and notifications

Grok Bot settings cover app-wide and desktop-local behavior. Each Bot's profile and notification preference live in its conversation details. Open settings from the account menu or with Cmd+,.

Settings sections depend on your account and rollout, so some options below
may not appear for you.

## General

- **Account.** Sign in or out of the Cursor account Grok Bot uses. The account menu also shows the installed version and a link to the iOS app.
- **Appearance.** Follow System, Light, or Dark.
- **Bot.** The time zone [routines](https://cursor.com/help/grok-bot/routines.md#how-do-schedules-and-time-zones-work) use for schedules, and your Auto-review switch and rules, plus any team rules your admin requires. Until a desktop is listed under **Computer**, the **Bot** section also shows **Execution on Local Computer**. Grok Bot manages model selection, so there's no model picker.

Two of these settings deserve care. Execution on Local Computer controls whether Bots can run commands on the desktop in front of you; per-command approval is the default, and the setting applies to that desktop alone. Once desktops are listed under **Settings** > **Computer**, the setting is there for each one, labeled **Execution on this computer**. Auto-review rules shape which actions stop for your approval. When your admin enforces Auto-review for the team, the same table also shows locked team rules with `Required by your admin. You can't edit or delete this rule.` Members can add their own rules on top, but they only make behavior stricter; **Ask first** wins when rules conflict. If your admin turns enforcement off, you only see and use your own rules. Your personal rules are stored on the current desktop and synced to its Grok Bot computer, so another desktop installation needs its own. Read [Approvals and Auto Review](https://cursor.com/docs/grok-bot/security.md#approvals-and-auto-review) before changing either.

## Computer

### Route traffic through your desktop

In the **Network** section, turn on **Route traffic through this computer** to send your Grok Bot computer's web traffic through the current desktop. The route applies to new connections. Destinations see your desktop's IP address, and the Bot can reach networks available from that device.

![The Network section in Grok Bot's Computer settings, with the Route traffic through this computer toggle turned off](/docs-static/images/grok-bot/settings-network-light.png)

The setting applies to one desktop. If your Enterprise admin turns off **Allow Local Egress**, the toggle turns off and locks with `Disabled by your admin. You can't turn this on.` Any active route stops within five minutes. Your choice is preserved and takes effect again if the admin re-allows local egress.

For private network options and their tradeoffs, see [Connect to private networks](https://cursor.com/docs/grok-bot/private-networks.md).

## Plugins

Use **Marketplace** to discover plugins and packaged skills, and **Yours** to review installed plugins and private skills. An installed plugin may still need browser authentication, and individual plugin tools can be enabled or disabled. On the Teams plan and the Enterprise plan, team-provided plugins may be required or restricted by an admin. See [Connect plugins](https://cursor.com/help/grok-bot/connect-plugins.md).

## Usage and billing

**Usage & Billing** shows weekly included usage and on-demand usage for eligible accounts, and the account menu can show weekly usage at a glance. For how plans, weekly usage, and on-demand spend work, see [Plans and billing](https://cursor.com/help/grok-bot/plans.md).

## Team Setup

**Team Setup is Enterprise only.** When an Enterprise admin provides a managed setup, **Team Setup** shows it here so you can review or reinstall it. Admins configure manifests from the dashboard; see [Grok Bot for Teams and Enterprise](https://cursor.com/docs/grok-bot/teams.md#admin-controls).

## Updates

The update controls live in the **Updates** pane of settings, and the Grok Bot app and Grok Bot's computer update separately:

- **Check for Updates** and **Restart to Update** update the desktop app.
- **Update Grok Bot's Computer**, in the **Grok Bot's Computer** section, moves the cloud computer to the latest version. A software update only refreshes Grok Bot's software and keeps installed apps. A computer update rebuilds the computer, keeping files and logins but removing installed apps and packages. The text under **Update** says which kind is waiting.
- **Reset Grok Bot's Computer** is a last resort that rebuilds the computer from your last saved data, the same as Recover; if the computer can't be reached to save first, very recent changes don't come back.

![The Grok Bot's Computer section in Grok Bot's Updates settings, with Update and Reset buttons](/docs-static/images/grok-bot/settings-computer-light.png)

See [Work with Grok Bot](https://cursor.com/docs/grok-bot/work.md#update-recover-or-reset) for the least destructive recovery order.

## Per-Bot settings

Click the Bot's name at the top of the chat (**View conversation details**), then choose **Bot settings**, to edit one Bot's name, label, description, and notifications preference. Click the Bot's picture in the same panel to change its avatar. These belong to that Bot alone. See [Change a Bot's name, picture, and description](https://cursor.com/help/grok-bot/edit-bot.md).

## Attention states and notifications

The sidebar distinguishes Bots that need attention (a question, approval, or handoff), unread activity (a new result), and working status. Opening a conversation marks its current activity as read, and the Bot menu can mark a conversation read or unread manually.

Turn on **Notifications** in a Bot's settings to get a system or mobile notification when that Bot finishes or needs input. Group chats don't have the same per-Bot notification switch. Notifications are suppressed while Grok Bot is focused; the sidebar and dock badge still show unread activity. On iPhone, both the device permission and the Bot's notification setting must allow the notification, and push delivery is rolling out gradually.

## In-app errors

Errors appear above the composer under **Notifications**. Some notices include **Copy request ID** for support; copy and share the complete ID with [support](https://cursor.com/help/grok-bot/get-help.md). Clearing a notice removes the notification, not the underlying action or history.

## Related pages

- [Work with Grok Bot](https://cursor.com/docs/grok-bot/work.md)
- [Plans and billing](https://cursor.com/help/grok-bot/plans.md)
- [Grok Bot for Teams and Enterprise](https://cursor.com/docs/grok-bot/teams.md)
- [Grok Bot security](https://cursor.com/docs/grok-bot/security.md)
- [Delete your Grok Bot account](https://cursor.com/help/grok-bot/delete-account.md)


---

## Sitemap

[Overview of all docs pages](/llms.txt)
