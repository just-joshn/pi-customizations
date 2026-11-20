# The pstack guide

pstack is a set of skills, playbooks, and principles for Pi. You give `/skill:poteto-mode` a goal and a check that can pass or fail. It picks a playbook, runs the other skills as the steps need them, and returns the evidence.

1. [Set up pstack](./01-setup.md). Install the package and pick your models.
2. [Route work through `/skill:poteto-mode`](./02-poteto-mode.md). Write a prompt and see which playbook it matches.
3. [Understand the code](./03-understand.md). Run a read-only investigation, then `/skill:how`, `/skill:why`, `/skill:teach`, and `/skill:recall` before you edit.
4. [Design the change](./04-design.md). `/skill:architect`, `/skill:arena`, `/skill:swarm`, `/skill:interrogate`, prototypes, and plans.
5. [Build and clean the change](./05-build-and-clean.md). The build playbooks, `/skill:tdd`, `/skill:deslop`, `/skill:unslop`, and `/skill:no-comments`.
6. [Verify and ship](./06-verify-and-ship.md). Prove behavior on the real app, formally verify properties tests rarely reach, vet numbers with `/skill:benchmark-checklist`, then open a pull request and drive it to merged.
7. [Run work overnight](./07-overnight.md). The overnight contract, the decision log, and coordinators and scheduled runs.
8. [Steer with principle names](./08-principles.md). The 24 principles and how to cite them.
9. [Make it yours](./09-make-it-yours.md). A personal mode, `/skill:correct`, and how to test a skill change.
10. [Recipes and pitfalls](./10-recipes-and-pitfalls.md). Prompts to copy and mistakes to avoid.

Read the pages in order the first time. Each page stands alone after that.

When you cannot tell which skill fits, type [`/skill:poteto-help`](../../skills/poteto-help/SKILL.md) with your question:

```text
/skill:poteto-help which skill should i use to review this branch?
```

`/skill:poteto-help` answers, hands you a prompt to send, and links the skill or guide page the answer came from. It does not start the work, because a pstack run spends real tokens.

## Minimal prompt

Give the goal and a check that can pass or fail:

```text
/skill:poteto-mode the export writes duplicate rows when a retry lands mid-run. repro first, then fix and verify.
```

"repro first" and a checkable outcome are enough routing signal. `/skill:poteto-mode` matches the Bug fix playbook and copies its steps into `TODO.md`. It then calls the skills each step needs.

Next: [Set up pstack](./01-setup.md).
