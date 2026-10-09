# Store secrets securely

Keep API keys and other credentials out of chat and ordinary files. After you save a secret, Grok Bot does not show the value again. A blank field later is not proof the secret was deleted.

## How should I add an API key or secret?

Use the **secure secret card** when a Bot asks for one. The field is masked. Choose **Save securely**. The card then says **Saved** and **Saved securely and kept private**. The value is not written into the chat.

You can also save a secret on the Bot itself. Open that Bot's **Secrets** section, choose **Add secret**, enter an environment variable name, a short description, and the value, then choose **Save secret**. The description is visible to the Bot. The value is not.

Don't paste secrets into chat, Shell, or ordinary files. Don't type them into a demonstration when you use **Teach a task**.

Secrets on a Bot are yours. On a [Team Bot](https://cursor.com/help/grok-bot/team-bots.md) you own, secrets are used in every teammate's chat, so only add keys you're happy for the whole team to use. A credential your company's setup scripts need, such as a license key for a tool installed on every team computer, is stored by a team admin as a [Team Secret](https://cursor.com/docs/grok-bot/teams.md#team-secrets) on the Enterprise dashboard instead. Those never reach your Bots directly.

## Why can't I see the secret value?

That is expected. Saved values are write-only.

- The secure secret card does not show the value after **Saved**. The footer says **Stored securely, never shown to your Bot**.
- **Secrets** lists the name and description only. It never shows the value again, including in Shell.
- To change a value, choose **Replace**, paste the new value, and choose **Replace value**. You cannot read the old value back.

If a page asked for the secret, a filled card says **Filled into the page. Secret values were never shown to your Bot.** If it says **Could not fill into the page**, the page may have moved. The value was still not shown to the Bot. Submit a new card if the Bot asks again.

If save fails, the form says **The secret was not saved. Try again.** If the list says **Something went wrong. Try again.**, choose **Try Again**. **No secrets yet.** means this Bot has no saved names, not that a value is hidden on the card.

## Did Update delete my secrets?

**Recover**, **Reset**, and computer updates remove installed apps and packages. A secret you typed into a file, a shell profile, or an installed tool on the computer can disappear with that. That is separate from **Secrets**.

If the name is still listed under **Secrets**, the value is still stored. Shell not printing it does not mean the secret was wiped. See [Grok Bot computer](https://cursor.com/help/grok-bot/computer-recovery.md) for what Update, Recover, and Reset keep.

If the name itself is gone and you did not choose **Remove**:

1. Fully quit Grok Bot and reopen it. On Mac, choose **Quit** from the menu bar, not just close the window.
2. Open the same Bot on another device signed into the same Cursor account.
3. If the list says **Something went wrong. Try again.**, choose **Try Again** before you add anything.

If the name is still missing on every device, add it again. Don't put it in a file to "keep a copy" on the computer. If names keep disappearing after you did not remove them, [contact support](https://cursor.com/help/grok-bot/get-help.md). Include your account email and a screenshot of **Secrets**. Don't send the secret value.

## Related

- [Connect plugins](https://cursor.com/help/grok-bot/connect-plugins.md)
- [Grok Bot computer](https://cursor.com/help/grok-bot/computer-recovery.md)
- [Grok Bot How Tos](https://cursor.com/help/grok-bot/how-to.md)
- [Get help](https://cursor.com/help/grok-bot/get-help.md)


---

## Sitemap

[Overview of all docs pages](/llms.txt)
