# Pi integration

Checked against official Pi documentation on 2026-09-26. The official repository is now `earendil-works/pi`; the former `badlogic/pi-mono` URLs redirect there.

- [Skills](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/skills.md): directory with `SKILL.md`, supported frontmatter, relative resources, progressive loading, explicit invocation, validation and reload.
- [CLI](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/cli.md): `--skill` loads a file or directory for one session.
- [Settings](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/settings.md#resources): persistent `skills` paths and their resolution.

From this repository root:

```sh
pi --skill ./skills/reverse-engineer-cli
```

Then invoke:

```text
/skill:reverse-engineer-cli Analyze /absolute/path/to/tool using /absolute/path/to/repository. Focus on configuration precedence and error semantics.
```

The existing `disable-model-invocation: true` policy is preserved. Explicit invocation loads the skill; text following it supplies the task. Use `/reload` after edits in an active Pi session and inspect diagnostics. Do not pass `--no-skills` when validating discovery across different installed versions.

For persistent discovery, install the repository as a [Pi package](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/packages.md). From the checkout root, `pi install .` records the checkout in your Pi settings and loads the five standalone skills in place through the root `package.json` manifest. Pi's `skills` setting also works. A project `.agents/skills/` directory loads only after the user trusts the project. Do not overwrite existing settings to install this skill. The repository's `skills/` directory by itself is not a standard project discovery location.

The skill uses ordinary files and Pi's built-in file/shell tools. It requires no extension, MCP server, custom hook, Codex metadata, or model-specific API. The analysis workflow is this skill's policy; Pi's official documentation defines packaging and loading, not reverse-engineering methodology.
