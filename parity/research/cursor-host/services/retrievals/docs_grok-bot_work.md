# Work with Grok Bot

Everything about working with Bots day to day: [creating and managing them](https://cursor.com/docs/grok-bot/work.md#bots), [messaging and collaborating](https://cursor.com/docs/grok-bot/work.md#messaging-and-collaboration), [the computer they share](https://cursor.com/docs/grok-bot/work.md#the-computer-and-apps), and [turning finished work into skills and routines](https://cursor.com/docs/grok-bot/work.md#skills-and-routines).

## Bots

A Bot is a durable AI teammate with a name, a job, its own conversation, and working context that develops over time. Create a separate Bot when the work has a distinct goal, set of tools, working style, approval boundary, or recurring schedule. Jobs like Talent Scout, Expense Manager, and Bug Reproduction give a Bot guidance and make its saved context reusable; a General Helper does neither. Describe the role in operational terms:

> Own the weekly account-health review. Pull product usage and support
> signals, flag evidence of churn or expansion, and produce a linked watch
> list for the customer-success team. Never contact a customer or change an
> account without approval.

### Create a Bot

1. Choose **New** in the sidebar, or press Cmd+N, then select **Create new Bot**.
2. Click the Bot's name at the top of the chat, then choose **Bot settings** to set the name, label, and description. Click the Bot's picture in the same panel to change its avatar. See [Change a Bot's name, picture, and description](https://cursor.com/help/grok-bot/edit-bot.md).
3. Send a real first task with a clear finish line; see [use cases](https://cursor.com/docs/grok-bot/use-cases.md) for starter prompts.

Your existing Bots can also suggest or create a focused Bot when a job should have a long-lived owner.

### Edit a Bot

Update the description when you discover a durable preference, boundary, or responsibility that should shape future work. Use the conversation for task-specific instructions, and the description for rules that should remain true:

- **Description.** "Never send external messages without approval."
- **Message.** "Draft follow-ups for these twelve accounts."

### Organize your roster

**Pin** active Bots to the top of the sidebar, and group them by project, client, or business with sections: right-click a Bot and choose **Move to new section**, or **Move to** once you have sections. Sections sync between desktop and iOS. **Hide from sidebar** removes a Bot from the main list without deleting its work or pausing its routines; restore it from **Hidden Bots** with **Show in sidebar**. On iPhone, **Duplicate** a Bot to reuse a role for a different scope, like one account-health Bot per region: the copy carries the profile, settings, enabled skills, routines, and avatar, but not conversation history, learned memory, or attachments, so rename it and give it the new scope before assigning work.

### Share a Bot

Share a public link when someone else should start from the same Bot. The link exposes the shared configuration (identity, description, skills, and routines), so remove API keys, internal URLs, and customer data first. The recipient adds a copy to their own account; they never get your computer, logins, or conversation history, and adding a shared Bot accepts the third-party bot terms shown at that point. To give your team one shared Bot to chat with instead of a copy each, publish a [Team Bot](https://cursor.com/help/grok-bot/team-bots.md).

On the Teams plan and the Enterprise plan, admins control whether members can
publish Bot templates publicly. See [template
sharing](https://cursor.com/docs/grok-bot/teams.md#admin-controls).

### Delete a Bot

Deleting a Bot removes its profile, conversation, and routines. Files and sign-ins on the shared computer aren't isolated per Bot and can remain there; clean them up separately. If you may need the work later, hide the Bot instead.

### What a Bot remembers

A Bot retains stable preferences, important facts, and summaries from its work, which lets it keep a role over time without replaying every prior message. Memory is not a substitute for an authoritative source: keep changing facts in the source system, ask the Bot to cite or reopen current data for consequential decisions, correct stale assumptions directly, and put safety boundaries in the description rather than in memory.

## Messaging and collaboration

Grok Bot is designed to feel like messaging a teammate. Keep requests natural, but make the outcome and the decision boundary explicit: what the Bot may change, and where it must stop for you.

### Message a Bot

In a conversation you can paste text, links, and images, attach files, reference a saved [skill](https://cursor.com/docs/grok-bot/work.md#skills-and-routines) with `/`, mention a Bot, group, routine, or plugin with `@`, reply to or react to a message, and send another instruction while work is in progress. The transcript shows tool activity, computer use, created files, questions, and approval requests alongside normal messages.

A direct message from you takes priority over background work and can redirect the current turn. Send "Stop now" when work should end immediately; stopping doesn't undo actions the Bot already completed.

### Attach files and links

Supported inputs include images, audio, video, PDFs, Office documents, CSV, JSON, YAML, source code, HTML, email files, and notebooks. Large, encrypted, damaged, or unusual files may not be readable; export an unusual format as PDF, CSV, plain text, or an image.

| Limit                             | Value      |
| --------------------------------- | ---------- |
| Attachments per message (desktop) | 6          |
| Documents, images, and audio      | 25 MB each |
| Video                             | 200 MB     |

Tell the Bot what each attachment is and how to use it:

> The PDF is the signed policy. The spreadsheet is this month's transactions.
> Reconcile the spreadsheet against the policy, cite the relevant policy
> section for every exception, and return a new spreadsheet plus a short
> summary. Don't modify the originals.

Paste a link when the Bot can reach the page from its computer or a plugin; if the page is private, [sign in through the computer](https://cursor.com/docs/grok-bot/work.md#take-over-for-sensitive-steps) or connect the plugin. Always check a link's destination before entering credentials or approving an external action.

### Group chats

Use a group when several Bots need one shared outcome and visible handoffs. Choose **New**, select two to six Bots, and describe the outcome and who owns the next step. Write normally to let the Bots decide who responds, type `@` to hand the request to one teammate, and save `@everyone` for group-wide updates. A useful kickoff assigns one owner per stage:

> @Researcher gather the source material and link every claim. @Writer turn
> the findings into a launch draft. @Reviewer check the draft against the
> sources and list only blocking issues. Don't publish anything.

Your messages in a group can include attachments. Bot-to-group handoff messages are text-only, so a Bot should send an image directly to another Bot when that teammate must inspect it.

### Hand work between Bots

A Bot can send an asynchronous message to another Bot, which wakes, handles the request, and can reply later; you see the handoff in the conversation. Handoffs work well when one Bot owns a source system and another owns the deliverable, or when a long-running job should continue without you coordinating every step. Ask for a single owner at each stage; parallel handoffs create duplicate work and noisy updates.

### Ask for reviewable results

Specify the artifact and its acceptance criteria: a document with source links, a spreadsheet with defined columns, a folder of screenshots and logs, or a draft that hasn't been sent. For consequential work, ask the Bot to separate facts found in source systems, assumptions, actions already completed, actions waiting for approval, and unresolved questions.

Strong results are independently reviewable: direct source links, screenshots with the relevant state visible, timestamps, a concise action log, and an explicit list of anything the Bot couldn't verify. Don't rely on a screenshot alone for fast-changing data. Generated files and links appear as cards you can preview, save, or answer with feedback; ask the Bot to revise the existing artifact instead of making disconnected copies.

Reply in a thread when feedback applies to one result or one approval request, and use reactions only for lightweight acknowledgement; a reaction alone shouldn't carry a safety-critical decision. Search and the command palette find prior messages, files, links, and routines across your Bots. Search availability can vary during rollout; if cross-conversation results aren't available, open the relevant Bot and use its conversation history.

## The computer and apps

Your Bots work from a persistent cloud computer with a browser, command line, and filesystem. Work continues while your laptop is closed, and files, sign-ins, and browser sessions persist between tasks.

Every Bot on your account uses the same computer: browser sessions, files, and command-line credentials are shared, and one Bot can continue from work another Bot saved. Each Bot gets its own screen, so several Bots can use browser and desktop tools in parallel (one computer-use task per screen at a time), but the screens are work surfaces, not security boundaries. Don't place a credential on the computer if another of your Bots shouldn't be able to use it. Between users, isolation is strict: each user's computer is dedicated and hardware-isolated. See [how users are isolated](https://cursor.com/docs/grok-bot/teams.md#how-users-are-isolated).

### Watch the computer

Click the computer preview in the right-hand panel of a conversation to open the computer and watch clicks, typing, navigation, and current status. You can leave the preview while work continues; closing the app doesn't stop cloud work.

### Take over for sensitive steps

The Bot hands you the computer for passwords, passkeys, two-factor codes, CAPTCHAs, payment or identity checks, and sites that require a human. Take control, complete only the blocked step, and tell the Bot to continue. The Bot doesn't type credentials and doesn't see your password, and the signed-in session persists for future tasks, shared across your Bots. Some sites expire sessions or re-verify; ask the Bot to pause and notify you rather than work around the check.

For a supported connection that presents a secure secret request, enter the value there: the field is masked, excluded from the transcript, and not shown to the model. Never paste passwords or one-time codes into ordinary chat. See [Store secrets securely](https://cursor.com/help/grok-bot/secrets.md).

### Connect plugins

Plugins give Bots a structured way to work with services like Gmail, Notion, and Slack, and are more reliable than clicking through a website when one exists. Open **Plugins** in the sidebar or follow an in-chat **Connect** card, then finish the provider login in your browser; setup steps and known issues are in [Connect plugins](https://cursor.com/help/grok-bot/connect-plugins.md).

- **Plugins are account-wide.** An installed plugin is available to every Bot you run. A teammate's [Team Bot](https://cursor.com/help/grok-bot/team-bots.md) asks before it uses your accounts.
- **Plugin logins stay off the computer.** OAuth tokens are held on Cursor's connector backend, and the Bot invokes tools without receiving them.
- **Team policy applies.** A plugin blocked by your team's connector policy shows **Disabled by team admin**. Blocking a plugin doesn't block that service's website. Closing that second path takes **Network Controls**, which is Enterprise only. See [network policy](https://cursor.com/docs/grok-bot/security.md#network-policy).

### Files and the workspace

The computer has a shared workspace at `/workspace`. Keep durable project files there in clear project folders. Files, browser state, and supported sign-ins survive normal computer updates and recovery; treat temporary directories, manually installed packages, and uncommitted application state as replaceable, and copy important results into the workspace or attach them to the conversation.

### Update, recover, or reset

The app and the computer update separately. When the computer is unreachable, work from the least destructive option first:

1. Retry from the error state, or reopen the conversation.
2. Restart the Grok Bot app and check for an app update.
3. Choose **Recover Grok Bot's Computer** when the unreachable state offers it.
4. Use **Update Grok Bot's Computer** to move to the latest version.
5. Use **Reset Grok Bot's Computer** only as a last resort.

A software update only refreshes Grok Bot's software and keeps installed apps. A computer update rebuilds the computer, keeping files and logins but removing installed apps and packages. Recover and Reset both rebuild the computer from your last saved data; if the computer can't be reached to save first, very recent changes don't come back. Conversations are stored outside the computer, so they survive even a reset. See [Grok Bot computer](https://cursor.com/help/grok-bot/computer-recovery.md).

### Your local computer is separate

The cloud computer is separate from the machine in front of you. A Bot runs commands on your local computer only under the local execution policy: per-command approval by default, settable to always allow, ask every time, or never. That policy is its own control, separate from the approvals that govern work on the cloud computer. See [local execution](https://cursor.com/docs/grok-bot/security.md#local-execution).

## Skills and routines

A skill is a reusable set of instructions for how to do a task. A routine tells one Bot when to run a workflow, on a schedule or after a supported event. Start with a one-time task, make it reliable, save the method as a skill, and only then automate it.

### Save a skill

Skills capture steps, decision rules, expected output, and safety boundaries, and are available across your Bots (a Bot may still need the relevant plugin or login). Ask directly:

> Save the process we used for this task as a skill called "Weekly account
> health". Include the source systems, risk definitions, output format, and
> the rule that customer contact always requires approval.

A useful skill states when to use it, the required inputs and access, the sequence of work, how to validate the result, what to return, and what requires approval. Type `/` in the composer to reference a skill. If a private skill doesn't appear in the `/` menu, enable it for the current Bot under **Settings** > **Plugins** > **Yours**.

### Teach a workflow by demonstration

Instead of describing every step, demonstrate a browser workflow once and let the Bot turn it into a draft skill. From a one-to-one conversation with the computer view open, choose **Teach a task**, describe the result, and perform the workflow. Teaching records visible computer interaction for up to ten minutes and doesn't record microphone audio; keep secrets out of the demonstration and use the secure secret request for credentials. The learned skill is a draft: add decision rules, failure handling, and approval boundaries, then test it on a safe input before scheduling.

Teach a task is rolling out gradually. If the control isn't visible, ask the
Bot to create a skill from written instructions and a completed task.

### Create a routine

Ask the Bot that should own the recurring job:

> Every weekday at 8:00 AM, run the "Daily customer risk" skill against the
> current account list. Post a linked watch list in this conversation. Don't
> contact customers. If the source data is unavailable, report the failure
> instead of using old data.

Confirm the owning Bot, the schedule and time zone, the input source, the expected result, the approval boundary, and what happens when a source is missing. Routines run in the cloud while your laptop is closed. Deleting a routine stops its future runs and can't be undone.

Cursor account integrations can also start a routine from an event, such as a Slack message or a GitHub notification; they're separate from the Slack or GitHub plugins. Define a narrow matching rule and a clear response, like "when a message in `#customer-escalations` contains a ticket link and the phrase 'needs repro', reproduce the issue in staging and post a repro pack in this conversation". Avoid broad listeners like "every new message", which create noise, consume usage, and act on irrelevant input.

### Test and manage routines

Use **Test** after creating or editing a routine, and review whether it selected current inputs, met the output format, kept a source trail, stopped at the intended approval point, and made failure states explicit.

A test run performs real work. It can navigate websites, change files, and
call connected tools. Use safe inputs and keep write actions behind
approval.

Create and change routines by asking the Bot in chat. To review them on desktop, click the Bot's name at the top of the chat, then choose **Tasks**. Open a routine to read its **Instruction** and **When to run**, and to **Pause**, **Resume**, **Test**, **Edit**, or delete it. On the phone, the Bot's profile lists its routines with **Run history**. After a long period away, Grok Bot may ask whether to keep routines running and pause them if you don't respond. For schedules, Slack triggers, and webhooks, see [Routines](https://cursor.com/help/grok-bot/routines.md).

Routines earn trust the same way people do: automate preparation before execution, keep sending, purchasing, deleting, publishing, and production changes behind approval, report missing or stale sources instead of working around them, and re-test after a website, plugin, or source format changes.

## Related pages

- [Routines](https://cursor.com/help/grok-bot/routines.md)
- [Get started with Grok Bot](https://cursor.com/docs/grok-bot/get-started.md)
- [Grok Bot use cases](https://cursor.com/docs/grok-bot/use-cases.md)
- [Settings and notifications](https://cursor.com/docs/grok-bot/settings.md)
- [Grok Bot for Teams and Enterprise](https://cursor.com/docs/grok-bot/teams.md)


---

## Sitemap

[Overview of all docs pages](/llms.txt)
