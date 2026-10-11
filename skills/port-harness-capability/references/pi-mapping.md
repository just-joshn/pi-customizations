# Pi-native mapping

## Inspect the target

Before you choose any API:

- Run `pi --version` and `pi --help`. Read the docs bundled with that install: run `dirname "$(readlink -f "$(command -v pi)")"`, then look in the package's `docs/` and `examples/` directories. Those docs, together with the installed `.d.ts` files, are authoritative. Blog posts and other harnesses are not.
- Check the existing Pi resources in the repo and in `~/.pi/agent/`, including extensions, skills, prompts, themes, packages, and settings. **Read them, but do not edit them.**
- Note the repo's package manager, runtime, `tsconfig`, lint, test commands, and module conventions.
- Look for existing implementations that already cover the behavior.
- Learn how activation, `/reload`, `pi install`, and removal work, and how project-local resources differ from user-global ones.

## Mechanisms

| Mechanism | Use it when the behavior needs | Primary docs |
|---|---|---|
| Extension (TypeScript) | runtime logic, tools, commands, lifecycle events, session state, UI, or deterministic enforcement | `docs/extensions.md`, `docs/tui.md` |
| Skill | on-demand procedural instructions, possibly with helper scripts | `docs/skills.md` |
| Prompt template | a reusable prompt the user invokes, with argument substitution | `docs/prompt-templates.md` |
| Theme | visual presentation | `docs/themes.md` |
| Package | several resources installed together, or npm/git distribution | `docs/packages.md` |
| Composition | behavior that spans these concerns. Use as few artifacts as possible. | — |

## Source concepts are hypotheses, not mappings

The table below gives a starting guess for each source concept. Confirm the guess against the installed docs before relying on it.

| Source concept | Likely Pi target | Validate |
|---|---|---|
| Hook (pre/post tool, session start, stop) | Extension event handler | That the event exists, when it fires, whether it can block or mutate, and what it is ordered against |
| Rule that only guides | Skill, `AGENTS.md` instruction, or prompt | Whether the model sees it at the right time |
| Rule that must hold | Extension enforcement, for example by blocking a tool call | That the event can actually deny the action |
| Slash command | Prompt template, or extension command if it runs logic | Name, argument parsing, help text |
| Custom tool or MCP tool | Extension tool | Schema, result shape, errors, cancellation |
| Subagent or agent definition | Skill that launches `pi -p`, or an extension | Isolation, context, how output returns |
| Plugin or marketplace bundle | Pi package | Manifest fields and install, update, and remove behavior |
| Settings or config | Extension config file or flags | Precedence, defaults, validation |

Never create an extension just because the source calls itself one. Never encode deterministic enforcement as prose. Never build a framework where Pi already supplies the mechanism. If a behavior truly cannot be built with supported mechanisms, record it as a gap. **Do not fork or patch Pi.**

## Development and distribution

- During development, load resources per session with `pi --skill <dir>`, `pi -e <extension>`, or `--prompt-template <path>`.
- Install with `pi install <path|npm|git>` only when the requirements call for it, and verify removal as well.
- Document setup, configuration, examples that actually run, and how to uninstall or disable the port.
