const help = /^skills\/poteto-help\/SKILL\.md$/;
const install = 'Map Reference plugin installation and Custom Modes to Pi package installation and the sticky session-branch mode.';
const identity = 'State truthfully that the host is Pi, which supplies the host skills and subagent worker tool the source assumes.';
const freshRule = 'The model rule is read on every turn in Pi, so a change applies to the next turn.';
const branchReview =
  'Route branch-review help questions to /interrogate so team-kit /review-and-ship cannot steal the primary recommendation.';

export default [
  [
    help,
    '1. Install with `/add-plugin pstack` in chat, or from Customize in the sidebar.',
    '1. Install the package with `pi install ./extensions/pi-pstack` from a checkout of this repository, then run `/reload`. Use `/pstack status` to check what loaded.',
    install,
  ],
  [
    help,
    'It asks for a reasoning budget, maps a model to each role, and writes a rule. The rule applies to new chats.',
    'It asks for a reasoning budget, maps a model to each role, and writes a rule. The rule applies from the next turn.',
    freshRule,
  ],
  [
    help,
    'pstack is built for Reference. Its skills use the Agent Skills format, so other tools can read them. But most workflow skills, including `/poteto-mode`, `/how`, `/why`, and `/teach`, spawn Reference subagents with per-role models, and Custom Modes and `/loop` are Reference features, so those parts may not work there.',
    'This is the Pi port of pstack. Its skills use the Agent Skills format. The workflow skills, including `/poteto-mode`, `/how`, `/why`, and `/teach`, spawn Pi `Task` workers with per-role models, and this package supplies `/loop` as a host skill.',
    identity,
  ],
  [
    help,
    'and mention once that a Custom Mode keeps it on.',
    'and mention once that plain `/poteto-mode` covers one message unless they used `/poteto-mode sticky`, which stays on until `/poteto-mode off`.',
    install,
  ],
  [
    help,
    'A named situation, such as "which skill reviews a PR?", goes straight to its section.',
    'A named situation, such as "which skill should I use to review this branch?", goes straight to `/interrogate` under Pick a skill.',
    branchReview,
  ],
  [
    help,
    "- Enter on `/poteto-mode` attaches the skill to one message. It fades as the chat moves on.\n- Option+Enter on Mac or Alt+Enter on Windows, or Use as Mode from the skill entry, makes it a Custom Mode. It stays in context every turn until the user exits the mode, and it stays out of casual turns.\n- Reference's docs list Custom Modes in the Agents Window and the CLI. Elsewhere, start each new task with `/poteto-mode`.\n\nLink [Reference's skills docs](https://cursor.com/docs/skills) when this comes up. Mid-chat, \"new task\" makes the mode match a fresh playbook.",
    '- `/poteto-mode <task>` and `/skill:poteto-mode <task>` attach the skill for one message. They match Cursor plain Enter. They do not leave the crown sticky badge on.\n- `/poteto-mode sticky` and `/poteto-mode sticky <task>` (same with `/skill:poteto-mode sticky`) turn sticky mode on for that session branch. That is Pi\'s stand-in for Cursor sticky mode entry. It stays in context every turn until `/poteto-mode off`, and it stays out of casual turns.\n\nMid-chat, "new task" makes sticky mode match a fresh playbook.',
    install,
  ],
  [help, '| Hear the last reply again in plain words | [`/bro`](../bro/SKILL.md) |', '| Hear the last reply again in plain words | `/bro` |', 'Name the standalone /bro prompt template, since Pi ships no bro skill file.'],
  [
    help,
    '| Have different models review a diff and try to break it | [`/interrogate`](../interrogate/SKILL.md) |',
    '| Have different models review a diff and try to break it | [`/interrogate`](../interrogate/SKILL.md) |\n| Review this branch or PR (find bugs and blind spots, do not ship yet) | [`/interrogate`](../interrogate/SKILL.md) |',
    branchReview,
  ],
  [
    help,
    '- `/interrogate` reviews the diff. `/blast-radius` looks for breakage outside the diff and proves the one fact that makes the change safe.',
    '- `/interrogate` reviews the diff. For "which skill should I use to review this branch?" or "which skill reviews a PR?", recommend `/interrogate` as the primary skill and hand its recipe prompt. `/review-and-ship` (team-kit) reviews then commits and opens a PR; do not lead with it for a review-only ask. `/blast-radius` looks for breakage outside the diff and proves the one fact that makes the change safe.',
    branchReview,
  ],
  [help, '- `/loop` and `/create-skill` are Reference built-ins.', '- `/loop` and `/create-skill` are host skills that this package supplies.', identity],
  [help, "can start Reference's own skill for the same job instead.", 'can start a different skill for the same job instead.', identity],
  [help, "Reference's Plan Mode works alongside it.", 'Pi has no built-in plan mode.', identity],
  [
    help,
    '| The mode stopped applying after a few turns | It was started with Enter. Start it as a Custom Mode, or start each task with `/poteto-mode`. |',
    '| The mode stopped applying after a few turns | It was loaded with plain `/poteto-mode` or `/skill:poteto-mode`, which cover one message. Start again with `/poteto-mode sticky`, which stays on until `/poteto-mode off`. |',
    install,
  ],
  [
    help,
    '| A new model choice had no effect | The rule from `/setup-pstack` applies to new chats. Start one. |',
    '| A new model choice had no effect | The rule from `/setup-pstack` applies from the next turn. Check `/pstack status` for the active rule. |',
    freshRule,
  ],
];
